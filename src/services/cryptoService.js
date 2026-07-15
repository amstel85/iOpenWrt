const crypto = require('crypto');
const { getOrCreate, secretPath } = require('./secretService');

/**
 * Encryption at rest for router SSH credentials.
 *
 * Threat model: the SQLite file gets copied off the box — a backup, an appdata snapshot, a shared
 * Unraid share. It does NOT protect against an attacker who already has both the DB and the key
 * file next to it; that is not solvable without a passphrase the user types on every boot.
 *
 * Values are stored as `enc:v1:<iv>:<tag>:<ciphertext>` (all base64). Anything without the `enc:`
 * prefix is treated as legacy plaintext and returned as-is, so decryption keeps working while
 * rows are migrated.
 */

const PREFIX = 'enc:v1:';

function key() {
    // Hex from secretService -> 32 raw bytes for AES-256.
    return Buffer.from(getOrCreate('credential_key'), 'hex').subarray(0, 32);
}

/**
 * @param {string|null} plain
 * @returns {string|null} encrypted blob, or the input unchanged if null/empty/already encrypted
 */
function encrypt(plain) {
    if (plain === null || plain === undefined || plain === '') return plain;
    if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain; // already encrypted

    const iv = crypto.randomBytes(12); // 96-bit nonce, the GCM standard
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * @param {string|null} stored
 * @returns {string|null} plaintext. Legacy unencrypted values pass through untouched.
 */
function decrypt(stored) {
    if (stored === null || stored === undefined || stored === '') return stored;
    if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // legacy plaintext

    try {
        const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return decipher.update(Buffer.from(ctB64, 'base64'), undefined, 'utf8') + decipher.final('utf8');
    } catch (e) {
        // Wrong/rotated key, or a corrupted row. Returning null makes the SSH attempt fail with a
        // clear auth error instead of silently sending ciphertext as the password.
        console.error('[CRYPTO] Failed to decrypt a stored credential:', e.message);
        return null;
    }
}

/**
 * Build the ssh2 auth object for a device row, decrypting whichever credential it uses.
 * Every SSH call site must go through this rather than reading device.password directly.
 * @param {{auth_type: string, password?: string, private_key?: string}} device
 */
function buildAuth(device) {
    const stored = device.auth_type === 'password' ? device.password : device.private_key;
    const plain = decrypt(stored);

    // decrypt() returns null only when an enc:v1: value failed to authenticate — i.e. the key is
    // wrong or the row is corrupt. Handing null to ssh2 would surface as a generic "auth failed",
    // sending whoever debugs it hunting for a bad router password. Name the real cause.
    if (plain === null && typeof stored === 'string' && stored.startsWith(PREFIX)) {
        throw new Error(
            `Stored credential for this device could not be decrypted. ${secretPath} is missing, ` +
            `or is not the file this credential was encrypted with. Restore it from backup, or ` +
            `re-enter the device's credentials.`
        );
    }

    return device.auth_type === 'password' ? { password: plain } : { privateKey: plain };
}

/**
 * One-time migration: encrypt any rows still holding plaintext credentials.
 * Safe to run on every boot — already-encrypted values are skipped.
 */
function migratePlaintextCredentials(db) {
    const rows = db.prepare('SELECT id, password, private_key FROM devices').all();
    const update = db.prepare('UPDATE devices SET password = ?, private_key = ? WHERE id = ?');
    let migrated = 0;

    const run = db.transaction(() => {
        for (const row of rows) {
            const needsPw = row.password && !row.password.startsWith(PREFIX);
            const needsKey = row.private_key && !row.private_key.startsWith(PREFIX);
            if (!needsPw && !needsKey) continue;

            update.run(
                needsPw ? encrypt(row.password) : row.password,
                needsKey ? encrypt(row.private_key) : row.private_key,
                row.id
            );
            migrated++;
        }
    });
    run();

    if (migrated > 0) console.log(`[CRYPTO] Encrypted credentials for ${migrated} device(s) at rest.`);
}

module.exports = { encrypt, decrypt, buildAuth, migratePlaintextCredentials };
