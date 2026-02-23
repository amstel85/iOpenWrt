const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'iopenwrt.db');

// Open DB
const db = new Database(dbPath, { verbose: null });

// Initialize Schema
function initDb() {
    db.pragma('journal_mode = WAL'); // Better concurrency

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ip TEXT UNIQUE NOT NULL,
            username TEXT DEFAULT 'root',
            password TEXT,
            private_key TEXT,
            auth_type TEXT CHECK(auth_type IN ('password', 'key')) DEFAULT 'password',
            status TEXT DEFAULT 'offline',
            last_seen DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS config_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            action TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
    `);

    console.log("Database initialized at", dbPath);
}

// Automatically init DB on module load
initDb();

module.exports = db;
