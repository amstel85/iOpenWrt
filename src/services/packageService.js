const { executeCommand } = require('./sshService');
const { buildAuth } = require('./cryptoService');

/**
 * Package management for OpenWrt devices.
 *
 * Read the safety notes before changing anything here. On OpenWrt, mass package upgrade is NOT the
 * equivalent of `apt upgrade` — it is a well-known way to brick a router, and the official docs
 * advise against it. Three reasons this module is as paranoid as it is:
 *
 *  1. Kernel modules pin an exact kernel build. A kmod from a feed built against a different kernel
 *     revision will not load; upgrading kmod-cfg80211 across builds takes wifi down permanently.
 *  2. Flash is small. Filling the overlay mid-upgrade can leave the device unbootable.
 *  3. Vendor firmware (and snapshots) often ship feeds that do not match the installed build, so
 *     opkg's own "upgradable" list is unreliable — some entries are silent downgrades.
 *
 * So: we surface information freely, and gate mutation hard.
 */

// Packages we refuse to touch regardless of what opkg claims.
//
// This list is the last line of defence and must stand on its own. Do NOT thin it out on the
// reasoning that analyzeFeedHealth() already blocks upgrades on a given device — that gate opens
// the moment a device runs a matching official release, and `force` bypasses it entirely. Every
// entry here is something that, if replaced with a build that doesn't match the running system,
// costs the user their radios, their network, their SSH access, or their boot.
//
// Note the `lib` prefixes: an earlier version had /^ubox$/ and /^uci$/, which matched neither
// libubox nor libuci — the actual shared libraries that everything on OpenWrt links against.
const BLOCKED_PATTERNS = [
    // Kernel and modules: pinned to an exact kernel version AND build hash.
    /^kmod-/, /^kernel$/, /^kernel-/, /^linux-/,

    // C library and toolchain runtime: every binary links these.
    /^libc$/, /^libgcc/, /^musl/, /^uclibc/, /^librt$/, /^libpthread$/, /^libstdcpp/,

    // Boot, init, config and network plumbing.
    /^base-files$/, /^busybox$/, /^procd/, /^ubox$/, /^libubox/, /^ubus/, /^libubus/,
    /^uci$/, /^libuci/, /^ucode$/, /^libucode/, /^netifd$/, /^rpcd/, /^libnl-tiny/,
    /^fstools$/, /^mtd$/, /^urandom-seed$/, /^urngd$/, /^swconfig$/, /^cgi-io$/,

    // Wireless stack: wpad/hostapd IS the authenticator. Replacing it across builds drops every
    // client and can leave the radios down with no way back in over wifi.
    /^wpad/, /^hostapd/, /^wpa-supplicant/, /^iw$/, /^iwinfo$/, /^libiwinfo/, /^wireless-regdb$/,
    /^mac80211/, /^.*-firmware$/, /^firmware/,

    // Remote access: this is the SSH server we are connected over.
    /^dropbear$/, /^openssh-server/,

    // The package manager replacing itself mid-run.
    /^opkg$/, /^apk$/, /^apk-tools/,

    // Network services the LAN depends on. Upgrading dnsmasq mid-flight drops DHCP for every
    // client; firewall/nftables can cut the box off the network entirely.
    /^dnsmasq/, /^odhcpd/, /^odhcp6c$/, /^firewall/, /^nftables/, /^iptables/, /^ip6tables/,
    /^ppp/, /^netifd/,

    // TLS: break these and the router can no longer fetch packages to repair itself.
    /^libustream/, /^mbedtls$/, /^libmbedtls/, /^openssl/, /^libopenssl/, /^wolfssl/,
    /^libwolfssl/, /^ca-bundle$/, /^ca-certificates$/,

    // LuCI core — the fallback UI if this tool breaks.
    /^luci-base$/, /^uhttpd/,
];

// Package names are interpolated into a shell command AND passed to opkg as arguments. A name must
// therefore start with an alphanumeric: a leading '-' would be read by opkg as a FLAG, not a
// package (e.g. "--force-overwrite" would sail through a naive character-class check).
const PACKAGE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;

// Keep an explicit headroom margin: opkg needs room for the download plus the unpacked files,
// and a full overlay during install is exactly the brick scenario.
const MIN_FREE_KB_AFTER_UPGRADE = 2048; // 2 MB

function isBlocked(pkg) {
    return BLOCKED_PATTERNS.some((re) => re.test(pkg));
}

/**
 * One batched read-only probe. Mirrors the ---SECTION--- convention used by deviceStats.js.
 * Every line is guarded so the script always exits 0 — a non-zero exit would make
 * executeCommand reject and fail the whole device.
 *
 * Markers are emitted with a LEADING newline (printf '\n---X---\n'), not a bare echo. Files on
 * these devices are not guaranteed to end in a newline — /etc/opkg/distfeeds.conf famously does
 * not — and `cat` of such a file leaves the cursor mid-line, so the next marker gets glued onto
 * the end of the previous output ("...aarch64/telephony---INSTALLED---") and is never recognised
 * as a marker. That silently swallowed the section after it.
 */
const INFO_CMD = [
    'printf "\\n---RELEASE---\\n"; cat /etc/openwrt_release 2>/dev/null',
    'printf "\\n---KERNEL---\\n"; uname -r 2>/dev/null',
    'printf "\\n---MODEL---\\n"; cat /tmp/sysinfo/model 2>/dev/null',
    'printf "\\n---PKGMGR---\\n"; command -v opkg >/dev/null 2>&1 && echo opkg; command -v apk >/dev/null 2>&1 && echo apk',
    'printf "\\n---SPACE---\\n"; df -k /overlay 2>/dev/null || df -k / 2>/dev/null',
    // opkg (<=24.10) keeps feeds in distfeeds.conf; apk (25.12+) keeps them in repositories.d/.
    'printf "\\n---FEEDS---\\n"; cat /etc/opkg/distfeeds.conf 2>/dev/null; cat /etc/apk/repositories 2>/dev/null; cat /etc/apk/repositories.d/*.list 2>/dev/null',
    'printf "\\n---INSTALLED---\\n"; (opkg list-installed 2>/dev/null || apk list --installed 2>/dev/null) | wc -l',
    'printf "\\n---DONE---\\n"',
].join('\n');

function parseSystemInfo(raw) {
    const info = {
        release: null, revision: null, target: null, arch: null, taints: null,
        kernel: null, model: null, package_manager: 'none',
        overlay_kb_total: null, overlay_kb_free: null,
        feed_release: null, installed_packages: null,
    };

    // Scan line by line rather than one regex per section. A per-section regex needs a preceding
    // newline to spot the next marker, so an EMPTY section (e.g. ---MODEL--- on a device with no
    // /tmp/sysinfo/model, immediately followed by ---PKGMGR---) swallows the following header and
    // reports the next section's body as its own content.
    const sections = {};
    let current = null;
    for (const line of raw.split('\n')) {
        const marker = line.match(/^---([A-Z_]+)---$/);
        if (marker) {
            current = marker[1];
            sections[current] = [];
        } else if (current) {
            sections[current].push(line);
        }
    }
    const section = (name) => (sections[name] || []).join('\n').trim();

    const rel = section('RELEASE');
    const grab = (key) => {
        const m = rel.match(new RegExp(`${key}='([^']*)'`));
        return m ? m[1] : null;
    };
    info.release = grab('DISTRIB_RELEASE');
    info.revision = grab('DISTRIB_REVISION');
    info.target = grab('DISTRIB_TARGET');
    info.arch = grab('DISTRIB_ARCH');
    info.taints = grab('DISTRIB_TAINTS');

    info.kernel = section('KERNEL') || null;
    info.model = section('MODEL') || null;

    const mgr = section('PKGMGR');
    info.package_manager = mgr.includes('opkg') ? 'opkg' : mgr.includes('apk') ? 'apk' : 'none';

    // df -k: skip the header, take the first data row with numbers.
    for (const line of section('SPACE').split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 4 && /^\d+$/.test(p[1]) && /^\d+$/.test(p[3])) {
            info.overlay_kb_total = parseInt(p[1]);
            info.overlay_kb_free = parseInt(p[3]);
            break;
        }
    }

    // The release the configured feeds actually serve, e.g. .../releases/23.05.0/...
    const feedMatch = section('FEEDS').match(/releases\/([0-9]+\.[0-9]+\.[0-9]+)\//);
    if (feedMatch) info.feed_release = feedMatch[1];
    else if (/\/snapshots?\//.test(section('FEEDS'))) info.feed_release = 'snapshot';

    const count = parseInt(section('INSTALLED'));
    info.installed_packages = isNaN(count) ? null : count;

    return info;
}

/**
 * Decide whether package upgrades can be trusted on this device.
 *
 * The case that motivated this: a Cudy vendor build reporting `23.05-SNAPSHOT-CUDY` with kernel
 * 5.15.158, while /etc/opkg/distfeeds.conf points at the official 23.05.0 release, whose kmods pin
 * kernel 5.15.134. opkg will happily list "upgrades" that are really cross-build downgrades.
 *
 * @returns {{verdict: 'ok'|'mismatch'|'unsupported'|'unknown', reasons: string[], safe_to_upgrade: boolean}}
 */
function analyzeFeedHealth(info) {
    const reasons = [];

    if (info.package_manager === 'none') {
        return {
            verdict: 'unsupported',
            reasons: ['This device has no opkg or apk — it is not running OpenWrt, so package management does not apply.'],
            safe_to_upgrade: false,
        };
    }

    if (!info.release || !info.feed_release) {
        return {
            verdict: 'unknown',
            reasons: ['Could not determine the installed release or the configured feed release.'],
            safe_to_upgrade: false,
        };
    }

    const installedIsSnapshot = /snapshot/i.test(info.release);
    const feedIsSnapshot = info.feed_release === 'snapshot';
    // A tagged install should match its feed exactly: "23.05.5" installed vs "23.05.5" feed.
    const installedTag = (info.release || '').match(/^([0-9]+\.[0-9]+\.[0-9]+)$/);

    if (installedIsSnapshot && feedIsSnapshot) {
        // Both snapshot: not a cross-release mismatch, but snapshots are rebuilt continuously, so
        // the feed drifts ahead of whatever is flashed. kmods go stale within days.
        reasons.push(`Both the firmware and the feeds are snapshots (${info.release}). Snapshot feeds are rebuilt continuously, so packages there are built against a newer kernel than the one installed and can fail to load.`);
    } else if (installedIsSnapshot) {
        reasons.push(`Installed firmware is a snapshot build (${info.release}), not a tagged release. Feeds are built for tagged releases and will not match it.`);
    } else if (installedTag && feedIsSnapshot) {
        // A tagged install pointed at snapshot feeds: everything there is from a different branch.
        reasons.push(`Installed release ${installedTag[1]} is a tagged release, but the feeds point at snapshots — a different branch entirely, built against a different kernel.`);
    }

    if (info.taints) {
        reasons.push(`Firmware reports taints (${info.taints}), meaning it was built with non-standard options. Stock packages may not be compatible.`);
    }

    if (installedTag && !feedIsSnapshot && installedTag[1] !== info.feed_release) {
        reasons.push(`Installed release ${installedTag[1]} does not match the configured feed release ${info.feed_release}.`);
    }
    if (!installedTag && !installedIsSnapshot && !feedIsSnapshot) {
        reasons.push(`Feeds point at release ${info.feed_release}, but the installed build is "${info.release}" — these are different builds.`);
    }

    return reasons.length
        ? { verdict: 'mismatch', reasons, safe_to_upgrade: false }
        : { verdict: 'ok', reasons: [], safe_to_upgrade: true };
}

function parseUpgradable(raw, manager) {
    const out = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let name, current, next;
        if (manager === 'opkg') {
            // "pkgname - 1.2.3-1 - 1.2.4-1"
            const m = t.match(/^(\S+)\s+-\s+(\S+)\s+-\s+(\S+)$/);
            if (!m) continue;
            [, name, current, next] = m;
        } else {
            // apk (25.12+). The first token is "<name>-<version>", e.g.
            //   luci-base-25.256.abc-r1 aarch64 {feeds/luci} (Apache-2.0) [upgradable from: luci-base-25.100.x-r0]
            // Split name from version at the last "-<digit...>" run (versions start with a digit).
            const head = t.split(/\s+/)[0];
            const vm = head.match(/^(.+)-(\d[^\s]*)$/);
            if (!vm) continue;
            name = vm[1];
            next = vm[2];
            // The current version is only present if apk prints the "[upgradable from: ...]" note.
            const from = t.match(/\[upgradable from:\s*\S+?-(\d[^\s\]]*)\]/);
            current = from ? from[1] : '(installed)';
        }
        out.push({ name, current, available: next, blocked: isBlocked(name), reason: isBlocked(name) ? blockReason(name) : null });
    }
    return out;
}

function blockReason(pkg) {
    if (/^kmod-|^kernel/.test(pkg)) return 'Kernel module — pinned to the exact running kernel version and build hash. Installing one built against a different kernel takes the radios or the network down.';
    if (/^libc$|^musl|^uclibc|^libgcc|^libstdcpp/.test(pkg)) return 'Core C library — every binary on the device links against it.';
    if (/^wpad|^hostapd|^wpa-supplicant|^mac80211|-firmware$/.test(pkg)) return 'Wireless authenticator/driver — replacing it across builds drops every client and can leave the radios down.';
    if (/^dropbear|^openssh-server/.test(pkg)) return 'This is the SSH server this tool connects over — replacing it mid-session can lock you out.';
    if (/^opkg$|^apk/.test(pkg)) return 'The package manager cannot safely replace itself mid-run.';
    if (/^dnsmasq|^odhcpd|^firewall|^nftables|^iptables/.test(pkg)) return 'Core network service — upgrading it out of band drops DHCP or firewalling for the whole LAN.';
    if (/^libustream|mbedtls|openssl|wolfssl|^ca-/.test(pkg)) return 'TLS stack — if this breaks, the router can no longer download packages to repair itself.';
    if (/^libubox|^libuci|^ubus|^procd|^netifd|^rpcd/.test(pkg)) return 'Core system plumbing — init, config and network management all depend on it.';
    return 'Base system package — upgrading it out of band can leave the device unbootable.';
}

// How long each operation may take. `opkg update` fetches several indexes over a slow WAN; an
// upgrade unpacks to flash. Both are far slower than a stats poll, and both are worse to cut off
// halfway than to wait for.
const TIMEOUT_INFO_MS = 20000;
const TIMEOUT_UPDATE_MS = 120000;
const TIMEOUT_UPGRADE_MS = 600000;

/** Read-only. Safe to call on any device, including non-OpenWrt ones. */
async function getSystemInfo(device) {
    const raw = await executeCommand(device.ip, device.username, buildAuth(device), INFO_CMD, device.port || 22, TIMEOUT_INFO_MS);
    const info = parseSystemInfo(raw);
    return { ...info, health: analyzeFeedHealth(info) };
}

/**
 * Refresh package lists and report what claims to be upgradable.
 * `opkg update` only writes indexes to /var/opkg-lists (tmpfs) — it does not modify the system.
 */
async function checkUpdates(device) {
    const info = await getSystemInfo(device);
    if (info.package_manager === 'none') {
        return { ...info, upgradable: [], index_errors: [], checked_at: new Date().toISOString() };
    }

    // Capture `update`'s exit code rather than sending it to /dev/null: "nothing to upgrade" and
    // "the index refresh failed" look identical downstream, and only one of them is good news.
    // stderr is folded into stdout because opkg reports real problems on both.
    const cmd = info.package_manager === 'opkg'
        ? 'opkg update >/dev/null 2>&1; printf "\\n---UPDEXIT---\\n$?\\n"; printf "\\n---UPGRADABLE---\\n"; opkg list-upgradable 2>&1; printf "\\n---DONE---\\n"; true'
        : 'apk update >/dev/null 2>&1; printf "\\n---UPDEXIT---\\n$?\\n"; printf "\\n---UPGRADABLE---\\n"; apk list --upgradable 2>&1; printf "\\n---DONE---\\n"; true';

    const raw = await executeCommand(device.ip, device.username, buildAuth(device), cmd, device.port || 22, TIMEOUT_UPDATE_MS);
    const body = (raw.match(/---UPGRADABLE---\n([\s\S]*?)(?=\n---DONE---|$)/) || [, ''])[1];
    const updExit = parseInt((raw.match(/---UPDEXIT---\n(\d+)/) || [, '-1'])[1]);

    const index_errors = parseIndexErrors(body);
    if (updExit !== 0) {
        index_errors.unshift({
            kind: 'update_failed',
            detail: `Refreshing the package index failed (exit ${updExit}). The router may have no internet access, or the feed URLs may be unreachable. The list below is stale or empty as a result.`,
        });
    }

    return {
        ...info,
        upgradable: parseUpgradable(body, info.package_manager),
        index_errors,
        update_exit: updExit,
        checked_at: new Date().toISOString(),
    };
}

/**
 * Turn opkg's "Collected errors:" noise into something a human can act on.
 *
 * This matters more than it looks. On a firmware/feed mismatch, `opkg list-upgradable` prints
 * nothing but errors — every kmod in the feed depends on a kernel build that isn't installed —
 * and exits 0. Since none of those lines parse as "name - old - new", a naive parser reports a
 * confident "nothing to upgrade" while opkg is actually telling you its dependency graph is
 * broken. That is the difference between "you're up to date" and "this feed cannot be used".
 */
function parseIndexErrors(raw) {
    const errors = [];
    const kernelDeps = new Set();
    let archIncompatible = 0;

    for (const line of raw.split('\n')) {
        const kmod = line.match(/cannot find dependency kernel \(= ([^)]+)\) for (\S+)/);
        if (kmod) {
            kernelDeps.add(kmod[1]);
            continue;
        }
        if (/incompatible with the architectures configured/.test(line)) {
            archIncompatible++;
        }
    }

    if (kernelDeps.size) {
        const want = [...kernelDeps][0];
        errors.push({
            kind: 'kernel_mismatch',
            detail: `The feed's kernel modules require kernel ${want}, which is not what this device is running. Every kmod in the feed is therefore unusable here, and opkg cannot resolve its dependency graph. This is the concrete proof of the firmware/feed mismatch above.`,
        });
    }
    if (archIncompatible) {
        errors.push({
            kind: 'arch_incompatible',
            detail: `${archIncompatible} package(s) in the feed were built for a different architecture than this device.`,
        });
    }
    return errors;
}

/**
 * Upgrade an explicit list of packages. Never upgrades everything, never picks packages itself.
 *
 * @param {object} device - device row (credentials still encrypted)
 * @param {string[]} packages - exact package names the user selected
 * @param {boolean} force - override the feed-mismatch refusal. Does NOT override the blocklist.
 */
async function upgradePackages(device, packages, force = false) {
    if (!Array.isArray(packages) || packages.length === 0) {
        throw new Error('No packages selected.');
    }

    const invalid = packages.filter((p) => typeof p !== 'string' || !PACKAGE_NAME_RE.test(p));
    if (invalid.length) {
        throw new Error(`Invalid package name(s): ${invalid.map(String).join(', ')}`);
    }

    // The blocklist is absolute — `force` does not lift it.
    const blocked = packages.filter(isBlocked);
    if (blocked.length) {
        throw new Error(`Refusing to upgrade protected package(s): ${blocked.join(', ')}. ${blockReason(blocked[0])}`);
    }

    const info = await getSystemInfo(device);
    if (info.package_manager === 'none') {
        throw new Error('This device has no package manager — it is not running OpenWrt.');
    }
    if (!info.health.safe_to_upgrade && !force) {
        throw new Error(`Refusing to upgrade: ${info.health.reasons.join(' ')} Pass force=true only if you understand the risk and can reflash this device.`);
    }
    if (info.overlay_kb_free !== null && info.overlay_kb_free < MIN_FREE_KB_AFTER_UPGRADE) {
        throw new Error(`Only ${Math.round(info.overlay_kb_free / 1024)} MB free on the overlay. Refusing to upgrade — filling the overlay mid-install can leave the device unbootable.`);
    }

    const auth = buildAuth(device);
    const port = device.port || 22;
    const list = packages.join(' ');
    const isOpkg = info.package_manager === 'opkg';

    // Refresh indexes FIRST and check that it worked. Upgrading against a stale or half-fetched
    // index is how you install a package built for a different release. The old code sent this to
    // /dev/null and carried on regardless.
    const updRaw = await executeCommand(
        device.ip, device.username, auth,
        `${isOpkg ? 'opkg update' : 'apk update'} >/dev/null 2>&1; echo "---UPD:$?---"; true`,
        port, TIMEOUT_UPDATE_MS
    );
    const updExit = parseInt((updRaw.match(/---UPD:(\d+)---/) || [, '-1'])[1]);
    if (updExit !== 0) {
        throw new Error(`Refusing to upgrade: refreshing the package index failed (exit ${updExit}). The router may have no internet access, or the feed URLs may be unreachable.`);
    }

    // Ask the package manager what it would ACTUALLY touch. Upgrading one package can drag in
    // dependencies — including a kmod or libc — so the blocklist must be applied to the resolved
    // set, not just to what the user ticked.
    if (isOpkg) {
        const dryRaw = await executeCommand(
            device.ip, device.username, auth,
            `opkg --noaction upgrade -- ${list} 2>&1; echo "---DRY:$?---"; true`,
            port, TIMEOUT_UPDATE_MS
        );
        const affected = parseAffectedPackages(dryRaw);
        const collateral = affected.filter((p) => isBlocked(p) && !packages.includes(p));
        if (collateral.length) {
            throw new Error(
                `Refusing to upgrade: doing this would also pull in protected package(s): ${collateral.join(', ')}. ` +
                `${blockReason(collateral[0])} Upgrade these from a full firmware image instead.`
            );
        }
    }

    // `--` stops opkg parsing anything after it as a flag: defence in depth behind PACKAGE_NAME_RE.
    const cmd = isOpkg
        ? `echo "---OUT---"; opkg upgrade -- ${list} 2>&1; echo "---EXIT:$?---"; true`
        : `echo "---OUT---"; apk upgrade -- ${list} 2>&1; echo "---EXIT:$?---"; true`;

    // executeCommand rejects on non-zero exit, so the trailing `true` keeps the script itself at 0
    // and lets us report the real status instead of losing the output to a rejection.
    const raw = await executeCommand(device.ip, device.username, auth, cmd, port, TIMEOUT_UPGRADE_MS);
    const output = ((raw.match(/---OUT---\n([\s\S]*?)(?=\n---EXIT:|$)/) || [, raw])[1] || '').trim();
    const exitCode = parseInt((raw.match(/---EXIT:(\d+)---/) || [, '-1'])[1]);

    // opkg is known to exit 0 while printing failures. Treat the output as authoritative too.
    const errorMarker = /\*\*\* Failed|Collected errors:|cannot satisfy|unresolved|No space left|resize failed/i.test(output);

    return {
        success: exitCode === 0 && !errorMarker,
        exit_code: exitCode,
        output,
        packages,
        warning: exitCode === 0 && errorMarker
            ? 'The package manager exited successfully but reported errors — read the output carefully.'
            : undefined,
    };
}

/**
 * Pull package names out of `opkg --noaction upgrade` output, which prints lines like:
 *   Upgrading curl on root from 8.4.0-1 to 8.7.1-1...
 *   Installing libcurl4 (8.7.1-1) to root...
 *   Removing obsolete file ...
 */
function parseAffectedPackages(raw) {
    const names = new Set();
    for (const line of raw.split('\n')) {
        const m = line.match(/^\s*(?:Upgrading|Installing|Downgrading|Removing)\s+([a-zA-Z0-9][a-zA-Z0-9._+-]*)\b/);
        if (m) names.add(m[1]);
    }
    return [...names];
}

module.exports = {
    getSystemInfo, checkUpdates, upgradePackages,
    parseSystemInfo, analyzeFeedHealth, parseUpgradable, isBlocked, parseAffectedPackages, parseIndexErrors, // exported for tests
};
