const { Client } = require('ssh2');

/**
 * Execute a command on a remote router via SSH
 * @param {string} ip - The IP address of the router
 * @param {string} username - SSH username
 * @param {object} auth - Authentication options
 * @param {string} cmd - The command to execute
 * @param {number} port - SSH port (default 22)
 * @param {number} execTimeoutMs - Cap on how long the command itself may run once connected.
 *   readyTimeout only bounds the handshake; without this a hung command holds the connection (and
 *   the HTTP request behind it) open indefinitely. Package operations need far longer than stats.
 * @returns {Promise<string>} The output of the command
 */
function executeCommand(ip, username, auth, cmd, port = 22, execTimeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let timer = null;
        let settled = false;

        const done = (fn, arg) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try { conn.end(); } catch (e) { /* already gone */ }
            fn(arg);
        };

        conn.on('ready', () => {
            timer = setTimeout(() => {
                // destroy(), not end(): end() waits for a graceful exchange the peer may never make.
                try { conn.destroy(); } catch (e) { /* ignore */ }
                done(reject, new Error(`Command timed out after ${execTimeoutMs}ms on ${ip}:${port}. It may still be running on the device.`));
            }, execTimeoutMs);

            conn.exec(cmd, (err, stream) => {
                if (err) return done(reject, err);

                let output = '';
                let errorOutput = '';

                stream.on('close', (code, signal) => {
                    if (code !== 0) {
                        return done(reject, new Error(`Command exited with code ${code}. Error: ${errorOutput}`));
                    }
                    done(resolve, output.trim());
                }).on('data', (data) => {
                    output += data;
                }).stderr.on('data', (data) => {
                    errorOutput += data;
                });
            });
        }).on('error', (err) => {
            done(reject, new Error(`SSH connection error to ${ip}:${port}: ${err.message}`));
        });

        conn.connect({
            host: ip,
            port: port,
            username: username,
            ...auth,
            readyTimeout: 10000,
            // Long opkg runs are silent for minutes; without keepalives a NAT or firewall can drop
            // an idle channel and SIGHUP opkg mid-write.
            keepaliveInterval: 15000,
            keepaliveCountMax: 8,
        });
    });
}

/**
 * Like executeCommand but binary-safe: collects stdout as a Buffer (not a lossy UTF-8 string) and
 * can feed a Buffer to the command's stdin. Needed for config backups — `base64` is not present on
 * these OpenWrt builds, so we stream the raw tarball out (cat) and back in (cat > file) instead.
 * @param {Buffer} [opts.input] - bytes to write to the remote command's stdin, then close it.
 * @returns {Promise<Buffer>} stdout bytes.
 */
function executeCommandRaw(ip, username, auth, cmd, { port = 22, execTimeoutMs = 60000, input = null } = {}) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let timer = null;
        let settled = false;
        const done = (fn, arg) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try { conn.end(); } catch (e) { /* already gone */ }
            fn(arg);
        };

        conn.on('ready', () => {
            timer = setTimeout(() => {
                try { conn.destroy(); } catch (e) { /* ignore */ }
                done(reject, new Error(`Command timed out after ${execTimeoutMs}ms on ${ip}:${port}.`));
            }, execTimeoutMs);

            conn.exec(cmd, (err, stream) => {
                if (err) return done(reject, err);
                const chunks = [];
                let errorOutput = '';
                stream.on('close', (code) => {
                    if (code !== 0) {
                        return done(reject, new Error(`Command exited with code ${code}. Error: ${errorOutput}`));
                    }
                    done(resolve, Buffer.concat(chunks));
                }).on('data', (data) => {
                    chunks.push(data);
                }).stderr.on('data', (data) => {
                    errorOutput += data;
                });
                if (input) stream.end(input); // push binary to stdin, then EOF
            });
        }).on('error', (err) => {
            done(reject, new Error(`SSH connection error to ${ip}:${port}: ${err.message}`));
        });

        conn.connect({
            host: ip,
            port: port,
            username: username,
            ...auth,
            readyTimeout: 10000,
            keepaliveInterval: 15000,
            keepaliveCountMax: 8,
        });
    });
}

module.exports = { executeCommand, executeCommandRaw };
