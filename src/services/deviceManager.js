const { executeCommand } = require('./sshService');

/**
 * Execute a command on multiple routers in parallel with a concurrency limit.
 * 
 * @param {Array<Object>} routers - List of router objects { ip, username, auth }
 * @param {string} cmd - Command to execute
 * @param {number} concurrencyLimit - Maximum number of concurrent SSH connections
 * @returns {Promise<Array<Object>>} Array of results { ip, output, error }
 */
async function executeOnMultiple(routers, cmd, concurrencyLimit = 5) {
    const results = [];
    let currentIndex = 0;

    async function worker() {
        while (currentIndex < routers.length) {
            const index = currentIndex++;
            const router = routers[index];
            try {
                const output = await executeCommand(router.ip, router.username, router.auth, cmd);
                results[index] = { ip: router.ip, output, error: null };
            } catch (error) {
                results[index] = { ip: router.ip, output: null, error: error.message };
            }
        }
    }

    const workers = [];
    const actualConcurrency = Math.min(concurrencyLimit, routers.length);
    for (let i = 0; i < actualConcurrency; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}

const { getDeviceStats } = require('./deviceStats');
const { getManufacturer } = require('./ouiService');

/**
 * Perform a global sync of all devices, aggregating leases to resolve AP clients
 */
async function performGlobalSync(db) {
    const devices = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key FROM devices').all();
    const allDeviceStats = [];
    const globalLeaseMap = new Map(); // MAC -> { ip, name }

    // 1. Fetch stats from all devices in parallel
    const promises = devices.map(async (device) => {
        try {
            const stats = await getDeviceStats(device);
            allDeviceStats.push({ deviceId: device.id, deviceName: device.name, stats });

            // Collect leases for global resolution
            if (stats.raw_leases) {
                stats.raw_leases.forEach(lease => {
                    globalLeaseMap.set(lease.mac, { ip: lease.ip, name: lease.name });
                });
            }
            // Also collect ARP info as fallback
            if (stats.raw_arp) {
                Object.entries(stats.raw_arp).forEach(([mac, ip]) => {
                    if (!globalLeaseMap.has(mac)) {
                        globalLeaseMap.set(mac, { ip, name: 'Unknown' });
                    }
                });
            }
        } catch (error) {
            console.error(`Sync failed for ${device.name}:`, error.message);
            db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(device.id);
        }
    });

    await Promise.allSettled(promises);

    // 2. Enrich and update each device
    for (const { deviceId, deviceName, stats } of allDeviceStats) {
        const enrichedClients = stats.wifi_macs.map(wifiClient => {
            const globalInfo = globalLeaseMap.get(wifiClient.mac) || { ip: '?.?.?.?', name: 'Wireless Client' };
            return {
                mac: wifiClient.mac,
                ip: globalInfo.ip,
                name: globalInfo.name,
                rssi: wifiClient.rssi,
                manufacturer: getManufacturer(wifiClient.mac),
                type: 'wireless'
            };
        });

        // Also add wired clients if this router has local leases that aren't wireless
        if (stats.raw_leases) {
            stats.raw_leases.forEach(lease => {
                const isWireless = stats.wifi_macs.some(w => w.mac === lease.mac);
                if (!isWireless) {
                    enrichedClients.push({
                        mac: lease.mac,
                        ip: lease.ip,
                        name: lease.name,
                        rssi: null,
                        manufacturer: getManufacturer(lease.mac),
                        type: 'wired'
                    });
                }
            });
        }

        db.prepare(`
            UPDATE devices 
            SET status = 'online', 
                last_seen = CURRENT_TIMESTAMP,
                client_count = ?,
                clients_json = ?,
                essid = ?,
                mesh_id = ?
            WHERE id = ?
        `).run(enrichedClients.length, JSON.stringify(enrichedClients), stats.essid || null, stats.mesh_id || null, deviceId);
    }

    console.log(`Global sync completed at ${new Date().toISOString()}`);
}

/**
 * Check a single device's status (Used during Add Device)
 */
async function checkDeviceStatus(db, device) {
    try {
        await getDeviceStats(device);
        db.prepare("UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(device.id);
        // Trigger a global sync shortly after adding a device to populate clients
        setTimeout(() => performGlobalSync(db), 1000);
        return true;
    } catch (error) {
        db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(device.id);
        return false;
    }
}

/**
 * Background monitor to check all devices every 30 seconds
 */
function startStatusMonitor(db) {
    // Initial sync
    performGlobalSync(db);

    setInterval(async () => {
        await performGlobalSync(db);
    }, 30000); // 30 seconds
}

async function rebootDevice(db, id) {
    const device = db.prepare('SELECT ip, username, auth_type, password, private_key FROM devices WHERE id = ?').get(id);
    if (!device) throw new Error("Device not found");

    const auth = device.auth_type === 'password' ? { password: device.password } : { privateKey: device.private_key };
    const { executeCommand } = require('./sshService');

    console.log(`Sending reboot command to ${device.ip}`);
    return await executeCommand(device.ip, device.username, auth, 'reboot');
}

module.exports = { executeOnMultiple, checkDeviceStatus, startStatusMonitor, performGlobalSync, rebootDevice };
