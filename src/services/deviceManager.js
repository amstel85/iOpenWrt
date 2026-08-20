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
    const cmd = `if uci -q get wireless.guest2g.ssid >/dev/null 2>&1; then echo "on:$(uci -q get wireless.guest2g.disabled 2>/dev/null || echo 0)"; else echo missing; fi`;
    const devices = apDevices(db);
    const settled = await Promise.allSettled(devices.map(d =>
        executeCommand(d.ip, d.username, buildAuth(d), cmd, d.port || 22, 15000)
    ));
    const perDevice = settled.map((r, i) => {
        const d = devices[i];
        if (r.status === 'fulfilled') {
            const t = r.value.trim();
            return { id: d.id, name: d.name, hasGuest: t.startsWith('on:'), enabled: t === 'on:0' };
        }
        return { id: d.id, name: d.name, hasGuest: false, enabled: false, error: r.reason.message };
    });
    const withGuest = perDevice.filter(d => d.hasGuest);
    // The switch shows one state for the whole fleet: "on" only when every guest-capable AP agrees.
    return { enabled: withGuest.length > 0 && withGuest.every(d => d.enabled), configured: withGuest.length > 0, devices: perDevice };
}

module.exports = { checkDeviceStatus, startStatusMonitor, performGlobalSync, rebootDevice, setGuestNetwork, getGuestStatus };
