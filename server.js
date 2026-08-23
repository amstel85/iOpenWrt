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
    protectedRoutes.get('/api/network/guest', deviceController.getGuest);
    protectedRoutes.post('/api/network/guest', deviceController.setGuest);
    protectedRoutes.post('/api/network/guest/config', deviceController.setGuestConfig);
    protectedRoutes.post('/api/network/guest/create', deviceController.createGuest);
    protectedRoutes.get('/api/network/usteer', deviceController.getUsteer);
    protectedRoutes.post('/api/network/usteer', deviceController.setUsteer);
    protectedRoutes.post('/api/devices/:id/reboot', deviceController.reboot);

    // Config backups
    protectedRoutes.get('/api/backups', deviceController.listBackups);
    protectedRoutes.post('/api/backups/run', deviceController.runBackups);
    protectedRoutes.get('/api/backups/:deviceId/:file', deviceController.downloadBackup);
    protectedRoutes.post('/api/backups/:deviceId/:file/restore', deviceController.restoreBackup);

    // Fleet intelligence
    protectedRoutes.get('/api/fleet', deviceController.getFleet);

    // Package management
    protectedRoutes.get('/api/devices/:id/system', deviceController.getSystemInfo);
    protectedRoutes.get('/api/devices/:id/updates', deviceController.checkUpdates);
    protectedRoutes.post('/api/devices/:id/upgrade', deviceController.upgradePackages);

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
        const port = process.env.PORT || 8780;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`OpenWrt Controller running at http://localhost:${port}`);

        // Start Background Ping Service.
        // DISABLE_MONITOR=1 boots the API without it: no SSH to routers, no subnet sweep. Use this
        // when running locally against real devices you don't want to touch.
        if (process.env.DISABLE_MONITOR === '1') {
            console.log('DISABLE_MONITOR=1 — background sync and subnet sweep are OFF.');
        } else {
            const db = require('./src/db');
            const { startStatusMonitor } = require('./src/services/deviceManager');
            startStatusMonitor(db);
        }

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
