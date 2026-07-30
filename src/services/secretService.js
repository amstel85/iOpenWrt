const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Persistent server secrets.
 *
 * Historically JWT_SECRET fell back to a literal hardcoded in this (public) repo, so every
 * deployment that never set it signed tokens with a key anyone could read. Failing hard on a
 * missing secret would break existing installs on update, so instead we generate one on first
 * run and persist it next to the database.
 *
 * An explicit JWT_SECRET env var always wins.
 */

const dataDir = path.join(__dirname, '..', '..', 'data');
const secretPath = process.env.SECRET_PATH || path.join(dataDir, '.secrets.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    } catch (e) {
        // ONLY a genuinely absent file means "first run". Every other error — a truncated write, a
        // zero-byte file, bad permissions, a half-restored backup — must abort.
        //
        // Treating those as first run would mint a new credential_key and persist it over the
        // damaged one, silently making every stored router credential undecryptable forever. There
        // is no other copy of that key. Crash-looping with a clear message is strictly better than
        // booting once and destroying it.
        if (e.code === 'ENOENT') return {};
        throw new Error(
            `Refusing to start: ${secretPath} exists but could not be read (${e.message}).\n` +
            `This file holds the key that decrypts your routers' stored SSH credentials. Generating ` +
            `a new one would make them permanently unreadable, so startup is aborted instead.\n` +
            `Fix: restore this file from backup. If you have no backup, delete it and re-enter each ` +
            `router's credentials in the UI.`
        );
    }
}

function persist(secrets) {
    // Write to the directory we actually write into — not a hardcoded one, or a SECRET_PATH
    // override pointing elsewhere would fail.
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });

    // Atomic replace: write a temp file, then rename. A bare writeFileSync truncates first, so a
    // crash or a full disk mid-write leaves a corrupt file — exactly the case load() now refuses
    // to boot on. rename(2) is atomic within a filesystem.
    // 0600: the file holds the token-signing key and the credential-encryption key.
    const tmp = `${secretPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(tmp, 0o600); // enforce even where the mode arg is ignored
    } catch (e) { /* best effort on exotic filesystems */ }
    fs.renameSync(tmp, secretPath);
}

/**
 * Get a named secret, generating and persisting it on first use.
 * @param {string} name - key within the secrets file
 * @param {string} [envVar] - env var that overrides the stored value
 * @returns {string} hex secret
 */
function getOrCreate(name, envVar, bytes = 32) {
    if (envVar && process.env[envVar]) return process.env[envVar];

    const secrets = load();
    if (!secrets[name]) {
        secrets[name] = crypto.randomBytes(bytes).toString('hex');
        persist(secrets);
        console.log(`[SECRETS] Generated a new ${name} and stored it in ${secretPath}`);
    }
    return secrets[name];
}

module.exports = { getOrCreate, secretPath };
