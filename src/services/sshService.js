const { Client } = require('ssh2');

/**
 * Execute a command on a remote router via SSH
 * @param {string} ip - The IP address of the router
 * @param {string} username - SSH username
 * @param {object} auth - Authentication options
 * @param {string} cmd - The command to execute
 * @param {number} port - SSH port (default 22)
 * @returns {Promise<string>} The output of the command
 */
function executeCommand(ip, username, auth, cmd, port = 22) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.exec(cmd, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                let output = '';
                let errorOutput = '';

                stream.on('close', (code, signal) => {
                    conn.end();
                    if (code !== 0) {
                        return reject(new Error(`Command exited with code ${code}. Error: ${errorOutput}`));
                    }
                    resolve(output.trim());
                }).on('data', (data) => {
                    output += data;
                }).stderr.on('data', (data) => {
                    errorOutput += data;
                });
            });
        }).on('error', (err) => {
            reject(new Error(`SSH connection error to ${ip}:${port}: ${err.message}`));
        });

        // Use a default timeout of 10s so it doesn't hang forever
        conn.connect({
            host: ip,
            port: port,
            username: username,
            ...auth,
            readyTimeout: 10000
        });
    });
}

module.exports = { executeCommand };
