require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const path = require('path');

fastify.register(cors, {
    origin: '*', // For dev, allow all. In production restrict to frontend URL or serve static
    methods: ['GET', 'POST', 'PUT', 'DELETE']
});

// Serve static frontend files
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'frontend/dist'),
    prefix: '/',
});

// Require Controllers
const authController = require('./src/controllers/authController');
const deviceController = require('./src/controllers/deviceController');
const clientController = require('./src/controllers/clientController');

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
    this.log.error(error);
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

// Setup Auth Routes
// These defaults are public since they are for initial setup and login
fastify.post('/api/auth/setup', authController.setupUser);
fastify.post('/api/auth/login', authController.login);

// Setup Device Routes (Protected by verifyToken middleware)
fastify.register(async function (protectedRoutes) {
    protectedRoutes.addHook('preHandler', authController.verifyToken);

    protectedRoutes.get('/api/devices', deviceController.getAll);
    protectedRoutes.get('/api/devices/:id', deviceController.getById);
    protectedRoutes.get('/api/devices/:id/stats', deviceController.getStats);
    protectedRoutes.post('/api/devices', deviceController.add);
    protectedRoutes.put('/api/devices/:id', deviceController.update);
    protectedRoutes.delete('/api/devices/:id', deviceController.remove);
    protectedRoutes.post('/api/network/sync', deviceController.syncAll);
    protectedRoutes.post('/api/devices/:id/reboot', deviceController.reboot);

    // Client Registry
    protectedRoutes.post('/api/clients/register', clientController.register);
});

// For React Router: Redirect all non-API GET requests to index.html
fastify.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        reply.sendFile('index.html');
    } else {
        reply.status(404).send({ error: 'Not Found' });
    }
});

// Start Server
const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`OpenWrt Controller running at http://localhost:${port}`);

        // Start Background Ping Service
        const db = require('./src/db');
        const { startStatusMonitor } = require('./src/services/deviceManager');
        startStatusMonitor(db);

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
