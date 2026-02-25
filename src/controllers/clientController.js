const db = require('../db');

const clientController = {
    register: async (request, reply) => {
        const { mac, name } = request.body;

        if (!mac || !name) {
            return reply.status(400).send({ error: "MAC and name are required" });
        }

        try {
            const stmt = db.prepare(`
                INSERT INTO client_registry (mac, custom_name, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(mac) DO UPDATE SET 
                    custom_name = excluded.custom_name,
                    updated_at = CURRENT_TIMESTAMP
            `);
            stmt.run(mac.toLowerCase(), name);
            return { success: true };
        } catch (error) {
            console.error(error);
            return reply.status(500).send({ error: "Failed to register client name" });
        }
    }
};

module.exports = clientController;
