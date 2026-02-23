const { executeCommand } = require('./sshService');

/**
 * Fetch real-time metrics from a single OpenWrt device via SSH.
 */
async function getDeviceStats(device) {
    const auth = device.auth_type === 'password' ? { password: device.password } : { privateKey: device.private_key };

    // We run a combined command to get all info at once for speed
    // 1. uptime (load average)
    // 2. free -m (memory)
    // 3. ifconfig br-lan or eth0 (basic rx/tx)
    // 4. iwinfo assoclist (wifi clients if available)

    const cmd = `
        echo "---UPTIME---"
        cat /proc/uptime
        echo "---LOAD---"
        cat /proc/loadavg
        echo "---MEM---"
        cat /proc/meminfo
        echo "---NET---"
        ifconfig br-lan 2>/dev/null || ifconfig eth0 2>/dev/null
        echo "---WIFI---"
        iwinfo 2>/dev/null | grep ESSID | cut -d" " -f1 | while read iface; do iwinfo $iface assoclist 2>/dev/null; done
    `;

    try {
        const rawOutput = await executeCommand(device.ip, device.username, auth, cmd);
        return parseStats(rawOutput);
    } catch (error) {
        throw new Error(`Failed to fetch stats: ${error.message}`);
    }
}

function parseStats(raw) {
    const sections = raw.split('---');
    const stats = {
        uptime: 0,
        load: { '1m': 0, '5m': 0, '15m': 0 },
        memory: { total: 0, free: 0, used: 0, percent: 0 },
        network: { rx_bytes: 0, tx_bytes: 0 },
        wifi_clients: 0
    };

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        const content = (sections[i + 1] || '').trim();

        if (section === 'UPTIME') {
            stats.uptime = parseFloat(content.split(' ')[0]) || 0;
        }
        else if (section === 'LOAD') {
            const parts = content.split(' ');
            stats.load = { '1m': parts[0], '5m': parts[1], '15m': parts[2] };
        }
        else if (section === 'MEM') {
            let memTotal = 0, memFree = 0, buffers = 0, cached = 0;
            const lines = content.split('\n');
            lines.forEach(line => {
                if (line.startsWith('MemTotal:')) memTotal = parseInt(line.replace(/[^0-9]/g, ''));
                if (line.startsWith('MemFree:')) memFree = parseInt(line.replace(/[^0-9]/g, ''));
                if (line.startsWith('Buffers:')) buffers = parseInt(line.replace(/[^0-9]/g, ''));
                if (line.startsWith('Cached:')) cached = parseInt(line.replace(/[^0-9]/g, ''));
            });
            const used = memTotal - memFree - buffers - cached;
            stats.memory = {
                total: memTotal,
                free: memFree + buffers + cached,
                used: used,
                percent: memTotal > 0 ? Math.round((used / memTotal) * 100) : 0
            };
        }
        else if (section === 'NET') {
            const rxMatch = content.match(/RX bytes:(\d+)/);
            const txMatch = content.match(/TX bytes:(\d+)/);
            // Alternate format for newer ifconfig
            const rxPacketsMatch = content.match(/RX packets \d+  bytes (\d+)/);
            const txPacketsMatch = content.match(/TX packets \d+  bytes (\d+)/);

            stats.network.rx_bytes = parseInt(rxMatch ? rxMatch[1] : (rxPacketsMatch ? rxPacketsMatch[1] : 0));
            stats.network.tx_bytes = parseInt(txMatch ? txMatch[1] : (txPacketsMatch ? txPacketsMatch[1] : 0));
        }
        else if (section === 'WIFI') {
            const macMatches = content.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/g);
            stats.wifi_clients = macMatches ? macMatches.length : 0;
        }
    }

    return stats;
}

module.exports = { getDeviceStats, parseStats };
