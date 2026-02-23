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

/**
 * Check a single device's status and update the DB with stats and client info
 */
async function checkDeviceStatus(db, device) {
    try {
        const stats = await getDeviceStats(device);

        db.prepare(`
            UPDATE devices 
            SET status = 'online', 
                last_seen = CURRENT_TIMESTAMP,
                client_count = ?,
                clients_json = ?
            WHERE id = ?
        `).run(stats.clients.length, JSON.stringify(stats.clients), device.id);

        return true;
    } catch (error) {
        console.error(`Failed to connect to device ${device.ip} (${device.name}):`, error.message);
        db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(device.id);
        return false;
    }
}

/**
 * Background monitor to check all devices every 60 seconds
 */
function startStatusMonitor(db) {
    setInterval(async () => {
        const devices = db.prepare('SELECT id, ip, username, auth_type, password, private_key FROM devices').all();
        for (const device of devices) {
            await checkDeviceStatus(db, device);
        }
    }, 60000); // 1 minute
}

module.exports = { executeOnMultiple, checkDeviceStatus, startStatusMonitor };
