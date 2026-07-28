const { executeCommand } = require('./sshService');
const { buildAuth } = require('./cryptoService');

/**
 * Fleet intelligence: look at all the OpenWrt units together instead of one at a time.
 *
 * Answers the questions that only make sense across a fleet of APs sharing SSIDs with 802.11r:
 *   - is every unit on the same firmware, or has one drifted behind?
 *   - is the roaming domain consistent (same mobility_domain, same encryption)?
 *   - do any 2.4 GHz radios share a channel (interference)?
 *   - how many package updates are waiting, across everything?
 *
 * Collection follows the one-SSH-call rule: a single batched read-only script per device.
 * Aggregation (analyzeFleet) is pure and unit-tested.
 */

// ONE read-only script per device. Guarded so it always exits 0.
const FLEET_CMD = [
    'printf "\\n---REL---\\n"; cat /etc/openwrt_release 2>/dev/null',
    'printf "\\n---KERNEL---\\n"; uname -r 2>/dev/null',
    'printf "\\n---RADIO---\\n"; for i in 0 1 2 3; do b=$(uci -q get wireless.radio$i.band); c=$(uci -q get wireless.radio$i.channel); [ -n "$b" ] && echo "radio$i $b ch$c"; done',
    'printf "\\n---IFACE---\\n"; i=0; while uci -q get wireless.@wifi-iface[$i] >/dev/null 2>&1; do s=$(uci -q get wireless.@wifi-iface[$i].ssid); e=$(uci -q get wireless.@wifi-iface[$i].encryption); m=$(uci -q get wireless.@wifi-iface[$i].mobility_domain); [ -n "$s" ] && echo "$s enc=$e md=${m:-none}"; i=$((i+1)); done',
    'printf "\\n---CLIENTS---\\n"; iwinfo 2>/dev/null | grep ESSID | cut -d" " -f1 | while read w; do iwinfo $w assoclist 2>/dev/null | grep -oiE "^([0-9a-f]{2}:){5}[0-9a-f]{2}"; done | wc -l',
    'printf "\\n---DONE---\\n"',
].join('\n');

function section(raw, name) {
    const m = raw.match(new RegExp(`---${name}---\\n([\\s\\S]*?)(?=\\n---|$)`));
    return m ? m[1].trim() : '';
}

/** Parse one device's raw fleet probe into a structured record. */
function parseFleetProbe(raw, device) {
    const rel = section(raw, 'REL');
    const grab = (k) => { const m = rel.match(new RegExp(`${k}='([^']*)'`)); return m ? m[1] : null; };

    const radios = section(raw, 'RADIO').split('\n').filter(Boolean).map((l) => {
        const m = l.match(/radio\d+\s+(\w+)\s+ch(\S+)/);
        return m ? { band: m[1], channel: m[2] } : null;
    }).filter(Boolean);

    const ifaces = section(raw, 'IFACE').split('\n').filter(Boolean).map((l) => {
        const m = l.match(/^(.+?)\s+enc=(\S*)\s+md=(\S+)$/);
        return m ? { ssid: m[1], encryption: m[2] || 'none', mobility_domain: m[3] === 'none' ? null : m[3] } : null;
    }).filter(Boolean);

    const clients = parseInt(section(raw, 'CLIENTS'));

    return {
        id: device.id,
        name: device.name,
        ip: device.ip,
        release: grab('DISTRIB_RELEASE'),
        revision: grab('DISTRIB_REVISION'),
        kernel: section(raw, 'KERNEL') || null,
        radios,
        ssids: ifaces,
        mobility_domains: [...new Set(ifaces.map((i) => i.mobility_domain).filter(Boolean))],
        client_count: isNaN(clients) ? null : clients,
        reachable: true,
    };
}

/**
 * Pure aggregation over the per-device records. No I/O — this is the tested core.
 * @param {Array} units - parseFleetProbe results (reachable) + {reachable:false} stubs for failures
 * @returns {{ summary, firmware, roaming, channels, issues }}
 */
function analyzeFleet(units) {
    const live = units.filter((u) => u.reachable);
    const issues = [];

    // --- firmware drift ---
    const releases = [...new Set(live.map((u) => u.release).filter(Boolean))];
    const firmwareConsistent = releases.length <= 1;
    if (releases.length > 1) {
        issues.push({
            severity: 'warning',
            kind: 'firmware_drift',
            detail: `Units are on different firmware releases: ${releases.join(', ')}. Flash the laggards to match.`,
        });
    }

    // --- roaming consistency (802.11r) ---
    const allMd = [...new Set(live.flatMap((u) => u.mobility_domains))];
    const roamingUnits = live.filter((u) => u.mobility_domains.length > 0);
    const roamingConsistent = allMd.length <= 1;
    if (allMd.length > 1) {
        issues.push({
            severity: 'warning',
            kind: 'roaming_mismatch',
            detail: `802.11r mobility_domain is not the same everywhere (${allMd.join(', ')}). Fast roaming only works between units that share it.`,
        });
    }

    // --- SSID/encryption consistency for shared SSIDs ---
    const ssidEnc = {};
    for (const u of live) {
        for (const s of u.ssids) {
            (ssidEnc[s.ssid] = ssidEnc[s.ssid] || new Set()).add(s.encryption);
        }
    }
    for (const [ssid, encs] of Object.entries(ssidEnc)) {
        if (encs.size > 1) {
            issues.push({
                severity: 'warning',
                kind: 'encryption_mismatch',
                detail: `SSID "${ssid}" uses different encryption on different units (${[...encs].join(', ')}). Clients may fail to roam.`,
            });
        }
    }

    // --- 2.4 GHz channel conflicts (only 1/6/11 are non-overlapping) ---
    const band24 = live.flatMap((u) => u.radios.filter((r) => r.band === '2g').map((r) => ({ unit: u.name, ch: r.channel })));
    const chCount = {};
    band24.forEach((r) => { chCount[r.ch] = (chCount[r.ch] || 0) + 1; });
    const conflicts = Object.entries(chCount).filter(([, n]) => n > 1);
    if (conflicts.length) {
        conflicts.forEach(([ch]) => {
            const on = band24.filter((r) => r.ch === ch).map((r) => r.unit);
            issues.push({
                severity: 'info',
                kind: 'channel_conflict',
                detail: `2.4 GHz channel ${ch} is used by more than one unit (${on.join(', ')}). On 2.4 GHz only 1/6/11 don't overlap.`,
            });
        });
    }

    const unreachable = units.filter((u) => !u.reachable);
    unreachable.forEach((u) => issues.push({
        severity: 'warning', kind: 'unreachable',
        detail: `${u.name} (${u.ip}) did not answer — its firmware and roaming can't be checked.`,
    }));

    return {
        summary: {
            total: units.length,
            reachable: live.length,
            clients: live.reduce((s, u) => s + (u.client_count || 0), 0),
            firmware: releases.length === 1 ? releases[0] : (releases.length ? 'mixed' : 'unknown'),
            firmware_consistent: firmwareConsistent,
            roaming_consistent: roamingConsistent,
            roaming_domain: allMd.length === 1 ? allMd[0] : (allMd.length ? 'mixed' : null),
            issue_count: issues.length,
            healthy: issues.filter((i) => i.severity === 'warning').length === 0,
        },
        units: live,
        issues,
    };
}

/** Collect one device (never throws — returns an unreachable stub on failure). */
async function probeOne(device) {
    try {
        const raw = await executeCommand(device.ip, device.username, buildAuth(device), FLEET_CMD, device.port || 22, 20000);
        return parseFleetProbe(raw, device);
    } catch (e) {
        return { id: device.id, name: device.name, ip: device.ip, reachable: false, error: e.message };
    }
}

/** Build the full fleet view from the device rows. */
async function getFleetOverview(devices) {
    const units = await Promise.all(devices.map(probeOne));
    return analyzeFleet(units);
}

module.exports = { getFleetOverview, analyzeFleet, parseFleetProbe }; // last two exported for tests
