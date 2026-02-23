const axios = require('axios');
const https = require('https');

// Create an HTTPS agent that ignores self-signed certificate errors (common on OpenWrt routers)
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

/**
 * Service to connect to the ubus REST API on OpenWrt routers.
 * Requires `uhttpd-mod-ubus` or similar packages on the router.
 */

/**
 * Authenticate with the ubus API and get a session token
 * 
 * @param {string} ip - Router IP
 * @param {string} username - User (usually 'root')
 * @param {string} password - Password
 * @returns {Promise<string>} Session token
 */
async function getUbusToken(ip, username, password) {
    const url = `http://${ip}/ubus`;
    const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "call",
        params: [
            "00000000000000000000000000000000",
            "session",
            "login",
            { username, password }
        ]
    };

    try {
        const response = await axios.post(url, payload, { httpsAgent, timeout: 5000 });
        if (response.data && response.data.result && response.data.result.length > 1) {
            const resultData = response.data.result[1];
            if (resultData && resultData.ubus_rpc_session) {
                return resultData.ubus_rpc_session;
            }
        }
        throw new Error("Invalid login response from ubus");
    } catch (err) {
        // Fallback to https if http fails
        if (url.startsWith('http://')) {
            const httpsUrl = `https://${ip}/ubus`;
            try {
                const httpsResponse = await axios.post(httpsUrl, payload, { httpsAgent, timeout: 5000 });
                if (httpsResponse.data && httpsResponse.data.result && httpsResponse.data.result.length > 1) {
                    const resultData = httpsResponse.data.result[1];
                    if (resultData && resultData.ubus_rpc_session) {
                        return resultData.ubus_rpc_session;
                    }
                }
            } catch (fallbackErr) {
                throw new Error(`Failed to connect to ubus API (HTTP and HTTPS): ${fallbackErr.message}`);
            }
        }
        throw new Error(`Failed to connect to ubus API: ${err.message}`);
    }
}

/**
 * Call a ubus method
 * 
 * @param {string} ip - Router IP
 * @param {string} token - Session token
 * @param {string} path - ubus path (e.g. 'iwinfo')
 * @param {string} method - method name (e.g. 'assoclist')
 * @param {Object} args - Arguments to pass to the method
 * @returns {Promise<Object>} The result data
 */
async function callUbusMethod(ip, token, path, method, args = {}) {
    // We default to HTTP since we handled the https fallback in token generation if needed, 
    // but ideally we should track which protocol succeeded. Assuming HTTP for simplicity here, 
    // you might want to enhance this to remember protocol.
    const url = `http://${ip}/ubus`;
    const payload = {
        jsonrpc: "2.0",
        id: 2,
        method: "call",
        params: [
            token,
            path,
            method,
            args
        ]
    };

    try {
        const response = await axios.post(url, payload, { httpsAgent, timeout: 5000 });
        if (response.data && response.data.result && response.data.result.length > 1) {
            return response.data.result[1];
        }
        return null;
    } catch (err) {
        // Try https fallback
        if (url.startsWith('http://')) {
            const httpsUrl = `https://${ip}/ubus`;
            try {
                const httpsResponse = await axios.post(httpsUrl, payload, { httpsAgent, timeout: 5000 });
                if (httpsResponse.data && httpsResponse.data.result && httpsResponse.data.result.length > 1) {
                    return httpsResponse.data.result[1];
                }
            } catch (fallbackErr) {
                throw new Error(`Ubus generic call failed (HTTP and HTTPS): ${fallbackErr.message}`);
            }
        }
        throw new Error(`Ubus call failed: ${err.message}`);
    }
}

/**
 * Convenience method: Login and get assoclist for a given device
 */
async function getAssocList(ip, username, password, device = 'phy0-ap0') {
    const token = await getUbusToken(ip, username, password);
    const result = await callUbusMethod(ip, token, 'iwinfo', 'assoclist', { device });
    return result;
}


module.exports = {
    getUbusToken,
    callUbusMethod,
    getAssocList
};
