const db = require('../db');
const { checkDeviceStatus } = require('../services/deviceManager');
const { getDeviceStats } = require('../services/deviceStats');

const deviceController = {
    getAll: async (request, reply) => {
        // Return devices (omit sensitive fields like keys/passwords for safety)
        const devices = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at, is_gateway, essid, mesh_id, port, last_error FROM devices').all();
        return devices;
    },

    getById: async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at, is_gateway, essid, mesh_id, port, last_error FROM devices WHERE id = ?').get(id);
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
            const info = stmt.run(name, ip, username, auth_type, password, private_key, request.body.is_gateway ? 1 : 0, validPort);

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
            password !== undefined ? password : null,
            private_key !== undefined ? private_key : null,
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
    }
};

module.exports = deviceController;
