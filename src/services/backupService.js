const fs = require('fs');
const path = require('path');
const { executeCommandRaw } = require('./sshService');
const { buildAuth } = require('./cryptoService');

// Backups live alongside the SQLite DB, i.e. inside the mapped `data` volume on Unraid, so they
// survive container updates and land in the appdata backup — the whole point of storing them here
// rather than on the routers themselves.
const DATA_DIR = process.env.DB_PATH
    ? path.dirname(path.resolve(process.env.DB_PATH))
    : path.join(__dirname, '..', '..', 'data');
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');

const KEEP_PER_DEVICE = 10;
const OVERDUE_MS = 23 * 60 * 60 * 1000;   // a scheduled tick only backs up if the newest is older

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function deviceDir(id) { return path.join(BACKUP_ROOT, String(id)); }

// Filesystem- and sort-friendly timestamp: lexical order == chronological order.
function stamp() {
    return new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '') + 'Z';
}

function listForDevice(id) {
    const dir = deviceDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.tar.gz'))
        .map(f => {
            const st = fs.statSync(path.join(dir, f));
            return { file: f, size: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => b.file.localeCompare(a.file));   // newest first
}

function rotate(id) {
    for (const old of listForDevice(id).slice(KEEP_PER_DEVICE)) {
        try { fs.unlinkSync(path.join(deviceDir(id), old.file)); } catch (e) { /* ignore */ }
    }
}

async function backupOne(device) {
    // `sysupgrade -b` writes the config archive; we `cat` it back as raw bytes over a binary-safe
    // stream (base64 is not present on these builds). All three must succeed (&&) or the non-zero
    // exit is a failed backup we surface.
    const cmd = 'sysupgrade -b /tmp/iob.tar.gz >/dev/null 2>&1 && cat /tmp/iob.tar.gz && rm -f /tmp/iob.tar.gz';
    const buf = await executeCommandRaw(device.ip, device.username, buildAuth(device), cmd, { port: device.port || 22, execTimeoutMs: 30000 });
    if (buf.length < 100) throw new Error('backup archive suspiciously small');
    ensureDir(deviceDir(device.id));
    const file = `${stamp()}.tar.gz`;
    fs.writeFileSync(path.join(deviceDir(device.id), file), buf);
    rotate(device.id);
    return { file, size: buf.length };
}

async function runBackups(db) {
    ensureDir(BACKUP_ROOT);
    const devices = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port FROM devices').all();
    const settled = await Promise.allSettled(devices.map(d =>
        backupOne(d).then(r => ({ id: d.id, name: d.name, ok: true, ...r }))));
    return settled.map((r, i) => r.status === 'fulfilled' ? r.value
        : { id: devices[i].id, name: devices[i].name, ok: false, error: r.reason.message });
}

function listBackups(db) {
    const devices = db.prepare('SELECT id, name, ip, is_gateway FROM devices ORDER BY is_gateway DESC, id ASC').all();
    return devices.map(d => ({ id: d.id, name: d.name, ip: d.ip, is_gateway: d.is_gateway, backups: listForDevice(d.id) }));
}

// Only a bare <timestamp>.tar.gz basename inside the device's own folder — never an escape via "..".
function resolveBackup(id, file) {
    if (typeof file !== 'string' || file.includes('/') || file.includes('..') || !/^[\w.\-]+\.tar\.gz$/.test(file)) return null;
    const p = path.join(deviceDir(id), file);
    return fs.existsSync(p) ? p : null;
}

async function restoreBackup(db, id, file) {
    const p = resolveBackup(id, file);
    if (!p) throw new Error('backup not found');
    const device = db.prepare('SELECT id, name, ip, username, auth_type, password, private_key, port FROM devices WHERE id = ?').get(id);
    if (!device) throw new Error('device not found');
    const data = fs.readFileSync(p);
    // Stream the archive to the device's stdin (cat > file), validate it (gzip -t), then fire the
    // restore DETACHED (setsid) so the reboot it triggers doesn't race the SSH channel closing: the
    // command returns RESTORE_STARTED and the device reboots ~2s later. A corrupt archive fails
    // gzip -t and never reaches sysupgrade.
    const cmd =
        `cat > /tmp/iorestore.tar.gz; ` +
        `if gzip -t /tmp/iorestore.tar.gz 2>/dev/null; then ` +
        `setsid sh -c 'sleep 2; sysupgrade -r /tmp/iorestore.tar.gz' >/dev/null 2>&1 & echo RESTORE_STARTED; ` +
        `else echo BAD_ARCHIVE; fi`;
    const out = (await executeCommandRaw(device.ip, device.username, buildAuth(device), cmd, { port: device.port || 22, execTimeoutMs: 30000, input: data })).toString();
    if (!out.includes('RESTORE_STARTED')) throw new Error('restore did not start on device: ' + out.trim());
    return { success: true, rebooting: true };
}

let backupTimer = null;
function newestBackupMtime(db) {
    const times = listBackups(db).flatMap(d => d.backups.map(b => Date.parse(b.mtime)));
    return times.length ? Math.max(...times) : 0;
}
async function maybeBackup(db) {
    try {
        if (Date.now() - newestBackupMtime(db) >= OVERDUE_MS) {
            console.log('[BACKUP] scheduled config backup starting...');
            const r = await runBackups(db);
            console.log(`[BACKUP] done: ${r.filter(x => x.ok).length}/${r.length} devices ok`);
        }
    } catch (e) { console.error('[BACKUP] scheduled run failed:', e.message); }
}
function scheduleBackups(db) {
    if (backupTimer) return;
    // First check shortly after boot (once routers are reachable), then hourly. maybeBackup only
    // actually runs when the newest archive is >23h old, so frequent container restarts don't spam.
    setTimeout(() => maybeBackup(db), 60 * 1000);
    backupTimer = setInterval(() => maybeBackup(db), 60 * 60 * 1000);
}

module.exports = { runBackups, listBackups, resolveBackup, restoreBackup, scheduleBackups, BACKUP_ROOT };
