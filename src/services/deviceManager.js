const { executeCommand } = require('./sshService');
const fs = require('fs');
const dns = require('dns').promises;
const { exec } = require('child_process');
const { getDeviceStats } = require('./deviceStats');
const { getManufacturer } = require('./ouiService');
const { buildAuth } = require('./cryptoService');

/**
 * Get internal ARP table from the controller host
 */
async function getLocalArp() {
    try {
        const data = fs.readFileSync('/proc/net/arp', 'utf8');
        const arp = {};
        data.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4 && parts[3].includes(':')) {
                const ip = parts[0];
                const mac = parts[3].toLowerCase();
                if (ip.includes('.')) arp[mac] = ip;
            }
        });
        return arp;
    } catch (e) {
        return {};
    }
}

/**
 * Perform a background sweep of the subnet
 */
async function sweepSubnet(db) {
    // Which /24 to sweep for host discovery. Prefer an explicit SUBNET (e.g. "192.168.1"),
    // otherwise derive it from the gateway device's IP so it works on any LAN with no config,
    // and only fall back to 10.0.0 if neither is available.
    let base = process.env.SUBNET;
    if (!base && db) {
        try {
            const row = db.prepare("SELECT ip FROM devices WHERE is_gateway = 1 ORDER BY id LIMIT 1").get()
                || db.prepare("SELECT ip FROM devices ORDER BY id LIMIT 1").get();
            if (row && row.ip && row.ip.includes('.')) base = row.ip.split('.').slice(0, 3).join('.');
        } catch (e) { /* fall through to the default */ }
    }
    base = base || '10.0.0';
    console.log(`[DISCOVERY] Starting active subnet sweep on ${base}.0/24...`);
    const pings = [];
    for (let i = 1; i <= 254; i++) {
        pings.push(new Promise((resolve) => {
            exec(`ping -c 1 -W 1 ${base}.${i}`, (err) => resolve());
        }));
    }
    await Promise.all(pings);
    console.log(`[DISCOVERY] Subnet sweep completed.`);
}

async function resolveHostname(ip) {
    if (!ip || ip === '?.?.?.?' || ip.includes(':')) return null;
    try {
        const names = await dns.reverse(ip);
        return names && names.length > 0 ? names[0].split('.')[0] : null;
    } catch (e) {
        return null;
    }
}

/**
 * Perform a global sync of all devices
 */
async function performGlobalSync(db) {
    const devices = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, is_gateway, port FROM devices').all();
    const allDeviceStats = [];
    const globalLeaseMap = new Map();

    const registry = db.prepare('SELECT mac, custom_name FROM client_registry').all();
    const registryMap = new Map(registry.map(r => [r.mac, r.custom_name]));

    const localArp = await getLocalArp();
    Object.entries(localArp).forEach(([mac, ip]) => {
        globalLeaseMap.set(mac, { ip, name: 'Unknown' });
    });

    const promises = devices.map(async (device) => {
        try {
            const stats = await getDeviceStats(device);
            allDeviceStats.push({ deviceId: device.id, deviceName: device.name, stats, is_gateway: device.is_gateway });
            db.prepare("UPDATE devices SET last_error = NULL WHERE id = ?").run(device.id);

            if (stats.raw_leases) {
                stats.raw_leases.forEach(lease => {
                    const existing = globalLeaseMap.get(lease.mac);
                    const shouldUpdate = !existing || device.is_gateway || existing.name === 'Unknown';
                    if (shouldUpdate) {
                        globalLeaseMap.set(lease.mac, {
                            ip: (existing && existing.ip.includes('.') && !lease.ip.includes('.')) ? existing.ip : lease.ip,
                            name: lease.name
                        });
                    }
                });
            }

            if (stats.dhcp_hosts) {
                Object.entries(stats.dhcp_hosts).forEach(([mac, name]) => {
                    const existing = globalLeaseMap.get(mac);
                    if (!existing || existing.name === 'Unknown') {
                        globalLeaseMap.set(mac, { ip: existing ? existing.ip : '?.?.?.?', name });
                    }
                });
            }

            if (stats.raw_arp) {
                Object.entries(stats.raw_arp).forEach(([mac, ip]) => {
                    const existing = globalLeaseMap.get(mac);
                    const isBetterIP = ip.includes('.') && (!existing || existing.ip === '?.?.?.?');
                    if (!existing || isBetterIP) {
                        globalLeaseMap.set(mac, { ip, name: existing ? existing.name : 'Unknown' });
                    }
                });
            }
        } catch (error) {
            console.error(`[SYNC] Failed for ${device.name}: ${error.message}`);
            // Alert only on the online -> offline transition, not every 30s while it stays down.
            const prev = db.prepare('SELECT status FROM devices WHERE id = ?').get(device.id);
            if (prev?.status === 'online') {
                const { sendTelegramAlert } = require('./telegramService');
                sendTelegramAlert(`🔴 *Router Offline*\n${device.name} (${device.ip}) stopped responding.\n\`${error.message}\``);
            }
            db.prepare("UPDATE devices SET status = 'offline', last_error = ? WHERE id = ?").run(error.message, device.id);
        }
    });

    await Promise.allSettled(promises);

    for (const { deviceId, deviceName, stats } of allDeviceStats) {
        const prevDevice = db.prepare('SELECT clients_json, status FROM devices WHERE id = ?').get(deviceId);
        const prevClients = prevDevice?.clients_json ? JSON.parse(prevDevice.clients_json) : [];
        const prevMacs = new Set(prevClients.map(c => c.mac));

        // Recovered: offline -> online transition (mirror of the offline alert above).
        if (prevDevice?.status === 'offline') {
            const { sendTelegramAlert } = require('./telegramService');
            sendTelegramAlert(`🟢 *Router Back Online*\n${deviceName} is responding again.`);
        }

        const enrichedClients = await Promise.all(stats.wifi_macs.map(async wifiClient => {
            const globalInfo = globalLeaseMap.get(wifiClient.mac) || { ip: '?.?.?.?', name: 'Unknown' };
            if (globalInfo.name === 'Unknown') {
                const dnsName = await resolveHostname(globalInfo.ip);
                if (dnsName) globalInfo.name = dnsName;
            }

            const persistentName = registryMap.get(wifiClient.mac);
            const manufacturer = getManufacturer(wifiClient.mac);
            let finalName = persistentName || globalInfo.name;
            if (finalName === 'Unknown' || !finalName) {
                finalName = manufacturer !== 'Unknown' ? `${manufacturer} Device` : 'Unknown Device';
            }

            const client = {
                mac: wifiClient.mac,
                ip: globalInfo.ip,
                name: finalName,
                rssi: wifiClient.rssi,
                manufacturer: manufacturer,
                routerName: deviceName,
                type: 'wireless'
            };

            if (prevDevice?.status === 'online' && !prevMacs.has(client.mac)) {
                const { sendTelegramAlert } = require('./telegramService');
                sendTelegramAlert(`🆕 *New Client Connected*\nDevice: ${client.name}\nMAC: \`${client.mac}\`\nRouter: ${deviceName}`);
            }
            return client;
        }));

        db.prepare(`
            UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP, client_count = ?, clients_json = ?, essid = ?, mesh_id = ?, wifi_mode = ?
            WHERE id = ?
        `).run(enrichedClients.length, JSON.stringify(enrichedClients), stats.essid || null, stats.mesh_id || null, stats.wifi_mode || null, deviceId);
    }
    console.log(`Global sync completed.`);
}

async function checkDeviceStatus(db, device) {
    try {
        await getDeviceStats(device);
        db.prepare("UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?").run(device.id);
        setTimeout(() => performGlobalSync(db), 1000);
        return { success: true };
    } catch (error) {
        db.prepare("UPDATE devices SET status = 'offline', last_error = ? WHERE id = ?").run(error.message, device.id);
        return { success: false, error: error.message };
    }
}

function startStatusMonitor(db) {
    performGlobalSync(db);
    sweepSubnet(db);
    setInterval(() => performGlobalSync(db), 30000);
    setInterval(() => sweepSubnet(db), 300000);
    require('./backupService').scheduleBackups(db);   // daily config backups into the data volume
}

async function rebootDevice(db, id) {
    const device = db.prepare('SELECT ip, username, auth_type, password, private_key, port FROM devices WHERE id = ?').get(id);
    if (!device) throw new Error("Device not found");
    return await executeCommand(device.ip, device.username, buildAuth(device), 'reboot', device.port || 22);
}

// The guest SSID lives on the AP units (is_gateway = 0), not the gateway. We only ever flip the
// `disabled` flag on the pre-built guest wifi-ifaces and `wifi reload` — never create or reshape
// the network — so this cannot touch the isolated-subnet/firewall config the guest network relies
// on. An AP without a guest iface is skipped (NO_GUEST), not treated as an error.
function apDevices(db) {
    return db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port FROM devices WHERE is_gateway = 0').all();
}

async function setGuestNetwork(db, enabled) {
    const disabled = enabled ? '0' : '1';
    const cmd = `if uci -q get wireless.guest2g.ssid >/dev/null 2>&1; then ` +
        `uci set wireless.guest2g.disabled='${disabled}'; ` +
        `uci -q get wireless.guest5g.ssid >/dev/null 2>&1 && uci set wireless.guest5g.disabled='${disabled}'; ` +
        `uci commit wireless; wifi reload; echo OK; else echo NO_GUEST; fi`;
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 30000)
    ));
    return settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') {
            return { id: d.id, name: d.name, ok: r.value.includes('OK'), skipped: r.value.includes('NO_GUEST') };
        }
        return { id: d.id, name: d.name, ok: false, error: r.reason.message };
    });
}

async function getGuestStatus(db) {
    const cmd = `if uci -q get wireless.guest2g.ssid >/dev/null 2>&1; then echo "state:$(uci -q get wireless.guest2g.disabled 2>/dev/null || echo 0)"; echo "ssid:$(uci -q get wireless.guest2g.ssid)"; else echo missing; fi`;
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 15000)
    ));
    const perDevice = settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') {
            const lines = r.value.split('\n').map(s => s.trim());
            const stateLine = lines.find(l => l.startsWith('state:'));
            const ssidLine = lines.find(l => l.startsWith('ssid:'));
            return { id: d.id, name: d.name, hasGuest: !!stateLine, enabled: stateLine === 'state:0', ssid: ssidLine ? ssidLine.slice(5) : null };
        }
        return { id: d.id, name: d.name, hasGuest: false, enabled: false, error: r.reason.message };
    });
    const withGuest = perDevice.filter(d => d.hasGuest);
    // The switch shows one state for the whole fleet: "on" only when every guest-capable AP agrees.
    return {
        enabled: withGuest.length > 0 && withGuest.every(d => d.enabled),
        configured: withGuest.length > 0,
        ssid: withGuest.map(d => d.ssid).find(s => s) || null,
        devices: perDevice
    };
}

// Reject SSID/passphrase outside a safe printable set (no quotes or shell metacharacters) so that
// single-quoting them into the uci commands below is injection-proof.
function validateGuest(ssid, key) {
    if (typeof ssid !== 'string' || !/^[A-Za-z0-9 ._-]{1,32}$/.test(ssid)) {
        throw new Error('SSID must be 1-32 characters: letters, digits, space, . _ -');
    }
    if (typeof key !== 'string' || !/^[A-Za-z0-9 ._\-!@#%^&*()+=]{8,63}$/.test(key)) {
        throw new Error('Password must be 8-63 characters (letters, digits, and . _ - ! @ # % ^ & * ( ) + =)');
    }
}

// Update just the SSID + passphrase of an existing guest network across the APs.
async function setGuestConfig(db, ssid, key) {
    validateGuest(ssid, key);
    const cmd = `if uci -q get wireless.guest2g.ssid >/dev/null 2>&1; then ` +
        `uci set wireless.guest2g.ssid='${ssid}'; uci set wireless.guest2g.key='${key}'; ` +
        `uci -q get wireless.guest5g.ssid >/dev/null 2>&1 && { uci set wireless.guest5g.ssid='${ssid}'; uci set wireless.guest5g.key='${key}'; }; ` +
        `uci commit wireless; wifi reload; echo OK; else echo NO_GUEST; fi`;
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 30000)));
    return settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') return { id: d.id, name: d.name, ok: r.value.includes('OK'), skipped: r.value.includes('NO_GUEST') };
        return { id: d.id, name: d.name, ok: false, error: r.reason.message };
    });
}

// Build the full isolated guest network on one AP from scratch (idempotent — clears any prior guest
// config first). Per-AP /24 in 172.16.<lan-last-octet>.0/24 — a range home LANs almost never use, so
// it stays disjoint from the user's LAN (which is typically 10.x or 192.168.x); aborts (NO_LAN_IP)
// rather than writing a malformed address if the LAN has no static ipaddr. Own DHCP, a firewall zone
// that masquerades to the internet but REJECTs every RFC1918 range, client isolation. ssid/key are
// pre-validated and single-quoted. Shell `$` are literal here (plain strings, not template literals).
function buildCreateGuestCmd(ssid, key) {
    return [
        'OCT=$(uci get network.lan.ipaddr 2>/dev/null | cut -d. -f4); case "$OCT" in ""|*[!0-9]*) echo NO_LAN_IP; exit 1;; esac; GW="172.16.$OCT.1"',
        'for s in network.guest network.br_guest dhcp.guest wireless.guest2g wireless.guest5g firewall.guest firewall.guest2lan firewall.guest_dhcp firewall.guest_dns firewall.guest_block_lan; do uci -q delete "$s"; done',
        'uci set network.br_guest=device; uci set network.br_guest.name=br-guest; uci set network.br_guest.type=bridge',
        'uci set network.guest=interface; uci set network.guest.device=br-guest; uci set network.guest.proto=static; uci set network.guest.ipaddr="$GW"; uci set network.guest.netmask=255.255.255.0',
        'uci set dhcp.guest=dhcp; uci set dhcp.guest.interface=guest; uci set dhcp.guest.start=100; uci set dhcp.guest.limit=150; uci set dhcp.guest.leasetime=4h; uci set dhcp.guest.dhcpv4=server',
        "uci set wireless.guest2g=wifi-iface; uci set wireless.guest2g.device=radio0; uci set wireless.guest2g.mode=ap; uci set wireless.guest2g.network=guest; uci set wireless.guest2g.encryption=psk2; uci set wireless.guest2g.isolate=1; uci set wireless.guest2g.disabled=0; uci set wireless.guest2g.ssid='" + ssid + "'; uci set wireless.guest2g.key='" + key + "'",
        "uci set wireless.guest5g=wifi-iface; uci set wireless.guest5g.device=radio1; uci set wireless.guest5g.mode=ap; uci set wireless.guest5g.network=guest; uci set wireless.guest5g.encryption=psk2; uci set wireless.guest5g.isolate=1; uci set wireless.guest5g.disabled=0; uci set wireless.guest5g.ssid='" + ssid + "'; uci set wireless.guest5g.key='" + key + "'",
        'uci set firewall.guest=zone; uci set firewall.guest.name=guest; uci set firewall.guest.network=guest; uci set firewall.guest.input=REJECT; uci set firewall.guest.output=ACCEPT; uci set firewall.guest.forward=REJECT',
        'uci set firewall.guest2lan=forwarding; uci set firewall.guest2lan.src=guest; uci set firewall.guest2lan.dest=lan',
        'i=0; while [ -n "$(uci -q get firewall.@zone[$i].name)" ]; do [ "$(uci -q get firewall.@zone[$i].name)" = "lan" ] && { uci set firewall.@zone[$i].masq=1; break; }; i=$((i+1)); done',
        'uci set firewall.guest_dhcp=rule; uci set firewall.guest_dhcp.name=Allow-guest-DHCP; uci set firewall.guest_dhcp.src=guest; uci set firewall.guest_dhcp.proto=udp; uci set firewall.guest_dhcp.dest_port=67; uci set firewall.guest_dhcp.target=ACCEPT',
        'uci set firewall.guest_dns=rule; uci set firewall.guest_dns.name=Allow-guest-DNS; uci set firewall.guest_dns.src=guest; uci add_list firewall.guest_dns.proto=tcp; uci add_list firewall.guest_dns.proto=udp; uci set firewall.guest_dns.dest_port=53; uci set firewall.guest_dns.target=ACCEPT',
        'uci set firewall.guest_block_lan=rule; uci set firewall.guest_block_lan.name=Block-guest-to-private; uci set firewall.guest_block_lan.src=guest; uci set firewall.guest_block_lan.dest=lan; uci set firewall.guest_block_lan.proto=all; uci add_list firewall.guest_block_lan.dest_ip=10.0.0.0/8; uci add_list firewall.guest_block_lan.dest_ip=172.16.0.0/12; uci add_list firewall.guest_block_lan.dest_ip=192.168.0.0/16; uci set firewall.guest_block_lan.target=REJECT',
        'uci commit',
        '/etc/init.d/network reload; sleep 3; /etc/init.d/dnsmasq restart 2>/dev/null; /etc/init.d/firewall reload >/dev/null 2>&1; wifi reload',
        'echo GUEST_CREATED'
    ].join('\n');
}

async function createGuestNetwork(db, ssid, key) {
    validateGuest(ssid, key);
    const cmd = buildCreateGuestCmd(ssid, key);
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 60000)));
    return settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') return { id: d.id, name: d.name, ok: r.value.includes('GUEST_CREATED') };
        return { id: d.id, name: d.name, ok: false, error: r.reason.message };
    });
}

// --- usteer (band/AP steering) on/off across the APs ---
async function getUsteerStatus(db) {
    const cmd = 'if [ -f /etc/init.d/usteer ]; then /etc/init.d/usteer enabled 2>/dev/null && pgrep usteer >/dev/null 2>&1 && echo on || echo off; else echo notinstalled; fi';
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 15000)));
    const per = settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') {
            const t = r.value.trim();
            return { id: d.id, name: d.name, installed: t !== 'notinstalled', enabled: t === 'on' };
        }
        return { id: d.id, name: d.name, installed: false, enabled: false, error: r.reason.message };
    });
    const withUsteer = per.filter(x => x.installed);
    return { enabled: withUsteer.length > 0 && withUsteer.every(x => x.enabled), installed: withUsteer.length > 0, devices: per };
}

async function setUsteer(db, enabled) {
    const cmd = enabled
        ? '[ -f /etc/init.d/usteer ] && { /etc/init.d/usteer enable; /etc/init.d/usteer restart; echo OK; } || echo NO_USTEER'
        : '[ -f /etc/init.d/usteer ] && { /etc/init.d/usteer stop; /etc/init.d/usteer disable; echo OK; } || echo NO_USTEER';
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 20000)));
    return settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') return { id: d.id, name: d.name, ok: r.value.includes('OK'), skipped: r.value.includes('NO_USTEER') };
        return { id: d.id, name: d.name, ok: false, error: r.reason.message };
    });
}

module.exports = { checkDeviceStatus, startStatusMonitor, performGlobalSync, rebootDevice, setGuestNetwork, getGuestStatus, setGuestConfig, createGuestNetwork, getUsteerStatus, setUsteer };
