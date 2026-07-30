const db = require('../db');
const { checkDeviceStatus } = require('../services/deviceManager');
const { getDeviceStats } = require('../services/deviceStats');
const { encrypt } = require('../services/cryptoService');

// Credential-bearing row for SSH calls. Values stay encrypted here; cryptoService.buildAuth
// decrypts them at the call site.
function getDeviceForSsh(id) {
    return db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port FROM devices WHERE id = ?').get(id);
}

const deviceController = {
    getAll: async (request, reply) => {
        // Return devices (omit sensitive fields like keys/passwords for safety)
        // Gateway first, then by insertion order — the DHCP/gateway node is the logical root of
        // the list, not whatever happened to be added first.
        const devices = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at, is_gateway, essid, mesh_id, wifi_mode, port, last_error FROM devices ORDER BY is_gateway DESC, id ASC').all();
        return devices;
    },

    getById: async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at, is_gateway, essid, mesh_id, wifi_mode, port, last_error FROM devices WHERE id = ?').get(id);
        if (!device) {
            return reply.status(404).send({ error: "Device not found" });
        }
        return device;
    },

    getStats: async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port FROM devices WHERE id = ?').get(id);
        if (!device) {
            return reply.status(404).send({ error: "Device not found" });
        }

        try {
            const stats = await getDeviceStats(device);
            return stats;
        } catch (error) {
            // Log it but don't crash, return generic error
            console.error(error);
            return reply.status(502).send({ error: "Failed to connect to device for stats" });
        }
    },

    add: async (request, reply) => {
        const { name, ip, username = 'root', auth_type, password, private_key, port } = request.body;
        const validPort = parseInt(port) || 22;
        try {
            const stmt = db.prepare(`
                INSERT INTO devices (name, ip, username, auth_type, password, private_key, is_gateway, port)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(name, ip, username, auth_type, encrypt(password), encrypt(private_key), request.body.is_gateway ? 1 : 0, validPort);

            // Fetch the inserted device and check its connection immediately
            const newDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid);
            const isOnline = await checkDeviceStatus(db, newDevice);

            return { success: true, deviceId: info.lastInsertRowid, status: isOnline ? 'online' : 'offline' };
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return reply.status(400).send({ error: "A device with this IP already exists" });
            }
            throw err;
        }
    },

    update: async (request, reply) => {
        const { id } = request.params;
        const { name, ip, username, auth_type, password, private_key, port } = request.body;

        const stmt = db.prepare(`
            UPDATE devices 
            SET name = COALESCE(?, name),
                ip = COALESCE(?, ip),
                username = COALESCE(?, username),
                auth_type = COALESCE(?, auth_type),
                password = COALESCE(?, password),
                private_key = COALESCE(?, private_key),
                is_gateway = COALESCE(?, is_gateway),
                port = COALESCE(?, port)
            WHERE id = ?
        `);

        // If another device is set as gateway, it could be tricky. 
        // For now just update this one.
        const isGatewayVal = request.body.is_gateway !== undefined ? (request.body.is_gateway ? 1 : 0) : null;
        const portVal = (port !== undefined && port !== null && !isNaN(parseInt(port))) ? parseInt(port) : null;

        const info = stmt.run(
            name !== undefined ? name : null,
            ip !== undefined ? ip : null,
            username !== undefined ? username : null,
            auth_type !== undefined ? auth_type : null,
            password !== undefined ? encrypt(password) : null,
            private_key !== undefined ? encrypt(private_key) : null,
            isGatewayVal,
            portVal,
            id
        );

        if (info.changes === 0) {
            return reply.status(404).send({ error: "Device not found" });
        }
        return { success: true };
    },

    remove: async (request, reply) => {
        const { id } = request.params;
        const info = db.prepare('DELETE FROM devices WHERE id = ?').run(id);

        if (info.changes === 0) {
            return reply.status(404).send({ error: "Device not found" });
        }
        return { success: true };
    },

    syncAll: async (request, reply) => {
        const { performGlobalSync } = require('../services/deviceManager');
        await performGlobalSync(db);
        return { success: true };
    },

    reboot: async (request, reply) => {
        const { id } = request.params;
        const { rebootDevice } = require('../services/deviceManager');
        try {
            await rebootDevice(db, id);
            return { success: true };
        } catch (error) {
            console.error(`Reboot failed for device ${id}:`, error);
            return reply.status(500).send({ error: "Failed to send reboot command" });
        }
    },

    // --- Package management ---

    // Read-only firmware/system info, including whether package upgrades can be trusted here.
    getSystemInfo: async (request, reply) => {
        const device = getDeviceForSsh(request.params.id);
        if (!device) return reply.status(404).send({ error: "Device not found" });
        try {
            return await require('../services/packageService').getSystemInfo(device);
        } catch (error) {
            return reply.status(502).send({ error: "Failed to read system info", message: error.message });
        }
    },

    // Refreshes package indexes (tmpfs only) and lists what claims to be upgradable.
    checkUpdates: async (request, reply) => {
        const device = getDeviceForSsh(request.params.id);
        if (!device) return reply.status(404).send({ error: "Device not found" });
        try {
            return await require('../services/packageService').checkUpdates(device);
        } catch (error) {
            return reply.status(502).send({ error: "Failed to check for updates", message: error.message });
        }
    },

    // Fleet intelligence: all AP units viewed together (firmware drift, roaming, channels).
    // On-demand SSH to each — a deliberate user action, so the one-call-per-device probe is fine.
    getFleet: async (request, reply) => {
        // Include the gateway too (it should appear in the fleet), but fleetService keeps the
        // AP-only consistency checks (roaming/channels/firmware) from being skewed by it.
        const devices = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port, is_gateway FROM devices ORDER BY is_gateway DESC, id ASC').all();
        try {
            return await require('../services/fleetService').getFleetOverview(devices);
        } catch (error) {
            return reply.status(502).send({ error: "Failed to build fleet overview", message: error.message });
        }
    },

    // Upgrades ONLY the explicitly named packages. See packageService for why this is so guarded.
    upgradePackages: async (request, reply) => {
        const device = getDeviceForSsh(request.params.id);
        if (!device) return reply.status(404).send({ error: "Device not found" });

        const { packages, force } = request.body || {};
        try {
            const result = await require('../services/packageService').upgradePackages(device, packages, force === true);
            return result;
        } catch (error) {
            // These are deliberate refusals (blocklist, feed mismatch, low space) as well as SSH
            // failures — 400 so the UI can show the reason verbatim instead of a generic 500.
            return reply.status(400).send({ error: error.message });
        }
    }
};

module.exports = deviceController;
