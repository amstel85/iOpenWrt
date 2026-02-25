const { executeCommand } = require('./sshService');
const fs = require('fs');
const dns = require('dns').promises;
const { exec } = require('child_process');
const { getDeviceStats } = require('./deviceStats');
const { getManufacturer } = require('./ouiService');

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
async function sweepSubnet() {
    console.log(`[DISCOVERY] Starting active subnet sweep...`);
    const base = '10.0.0';
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
            db.prepare("UPDATE devices SET status = 'offline', last_error = ? WHERE id = ?").run(error.message, device.id);
        }
    });

    await Promise.allSettled(promises);

    for (const { deviceId, deviceName, stats } of allDeviceStats) {
        const prevDevice = db.prepare('SELECT clients_json, status FROM devices WHERE id = ?').get(deviceId);
        const prevClients = prevDevice?.clients_json ? JSON.parse(prevDevice.clients_json) : [];
        const prevMacs = new Set(prevClients.map(c => c.mac));

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
    sweepSubnet();
    setInterval(() => performGlobalSync(db), 30000);
    setInterval(() => sweepSubnet(), 300000);
}

async function rebootDevice(db, id) {
    const device = db.prepare('SELECT ip, username, auth_type, password, private_key, port FROM devices WHERE id = ?').get(id);
    if (!device) throw new Error("Device not found");
    const auth = device.auth_type === 'password' ? { password: device.password } : { privateKey: device.private_key };
    return await executeCommand(device.ip, device.username, auth, 'reboot', device.port || 22);
}

module.exports = { checkDeviceStatus, startStatusMonitor, performGlobalSync, rebootDevice };
