const jwt = require('jsonwebtoken');
const { getOrCreate } = require('../services/secretService');

// Generated and persisted to data/ on first run; JWT_SECRET overrides it.
// Never fall back to a literal here — this repo is public.
const JWT_SECRET = getOrCreate('jwt_secret', 'JWT_SECRET');

const authController = {
    // Setup route is no longer needed since we use ENV variables
    setupUser: async (request, reply) => {
        return reply.status(403).send({ error: "Setup is disabled. Use frontend_user and frontend_password in .env file." });
    },

    login: async (request, reply) => {
        const { username, password } = request.body;

        const envUser = process.env.frontend_user;
        const envPass = process.env.frontend_password;

        if (!envUser || !envPass) {
            return reply.status(500).send({ error: "Backend missing frontend_user or frontend_password in .env" });
        }

        if (username !== envUser || password !== envPass) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign({ id: 1, username: envUser }, JWT_SECRET, { expiresIn: '12h' });
        return { token };
    },

    // Fastify Middleware hook to verify JWT
    verifyToken: async (request, reply) => {
        try {
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new Error("Missing or invalid token");
            }

            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            request.user = decoded; // Attach user to request
        } catch (err) {
            // Must return the reply: that is what short-circuits the route handler from an async
            // hook. Without it, auth only holds because Fastify internally checks reply.sent.
            return reply.status(401).send({ error: 'Unauthorized', message: err.message });
        }
    }
};

module.exports = authController;
