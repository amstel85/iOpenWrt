const db = require('../db');
const { checkDeviceStatus } = require('../services/deviceManager');
const { getDeviceStats } = require('../services/deviceStats');

const deviceController = {
    getAll: async (request, reply) => {
        // Return devices (omit sensitive fields like keys/passwords for safety)
        const devices = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at FROM devices').all();
        return devices;
    },

    getById: async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT id, name, ip, username, auth_type, status, client_count, clients_json, last_seen, created_at FROM devices WHERE id = ?').get(id);
        if (!device) {
            return reply.status(404).send({ error: "Device not found" });
        }
        return device;
    },

    getStats: async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key FROM devices WHERE id = ?').get(id);
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
        const { name, ip, username = 'root', auth_type, password, private_key } = request.body;

        if (!name || !ip) {
            return reply.status(400).send({ error: "Name and IP are required" });
        }
        if (auth_type === 'password' && !password) {
            return reply.status(400).send({ error: "Password is required when auth_type is password" });
        }
        if (auth_type === 'key' && !private_key) {
            return reply.status(400).send({ error: "Private key is required when auth_type is key" });
        }

        try {
            const stmt = db.prepare(`
                INSERT INTO devices (name, ip, username, auth_type, password, private_key)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(name, ip, username, auth_type, password, private_key);

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
        const { name, ip, username, auth_type, password, private_key } = request.body;

        // Simple approach: update all provided fields
        // In a strict API, you'd build the query dynamically based on what was provided.
        const stmt = db.prepare(`
            UPDATE devices 
            SET name = COALESCE(?, name),
                ip = COALESCE(?, ip),
                username = COALESCE(?, username),
                auth_type = COALESCE(?, auth_type),
                password = COALESCE(?, password),
                private_key = COALESCE(?, private_key)
            WHERE id = ?
        `);

        const info = stmt.run(name, ip, username, auth_type, password, private_key, id);

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
    }
};

module.exports = deviceController;
