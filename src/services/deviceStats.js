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
        echo "---LEASES---"
        ${device.is_gateway ? 'cat /tmp/dhcp.leases 2>/dev/null || cat /var/lib/misc/dnsmasq.leases 2>/dev/null || cat /tmp/var/lib/misc/dnsmasq.leases 2>/dev/null || ip neigh show 2>/dev/null' : 'cat /tmp/dhcp.leases 2>/dev/null'}
        echo "---ARP---"
        cat /proc/net/arp 2>/dev/null
        echo "---WIFI---"
        iwinfo 2>/dev/null | grep ESSID | cut -d" " -f1 | while read iface; do iwinfo $iface assoclist 2>/dev/null; done
        echo "---NEIGH---"
        ip neigh show 2>/dev/null
        echo "---DHCP_CONF---"
        cat /etc/config/dhcp 2>/dev/null
        echo "---WIFI_INFO_DETAIL---"
        iwinfo 2>/dev/null | grep ESSID | cut -d" " -f1 | while read iface; do echo "IFACE: $iface"; iwinfo $iface info 2>/dev/null; done
    `;

    try {
        const rawOutput = await executeCommand(device.ip, device.username, auth, cmd, device.port || 22);
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
        wifi_clients: 0,
        clients: []
    };

    let leases = [];
    let arp = {};
    let dhcp_hosts = {}; // map mac -> name
    let wifiMacs = [];
    const clientMap = new Map();

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
        else if (section === 'LEASES') {
            content.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                // dnsmasq format: timestamp mac ip name client_id (optional)
                if (parts.length >= 4 && parts[1].includes(':')) {
                    leases.push({ mac: parts[1].toLowerCase(), ip: parts[2], name: parts[3] !== '*' ? parts[3] : 'Unknown' });
                }
                // ip neigh format: 10.0.0.X dev br-lan lladdr mac STALE
                else if (parts.length >= 5 && parts.includes('lladdr')) {
                    const mac = parts[parts.indexOf('lladdr') + 1];
                    if (mac && mac.includes(':')) {
                        leases.push({ mac: mac.toLowerCase(), ip: parts[0], name: 'Unknown' });
                    }
                }
            });
        }
        else if (section === 'ARP') {
            content.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4 && parts[3].includes(':')) {
                    const mac = parts[3].toLowerCase();
                    const ip = parts[0];
                    // Prioritize IPv4 (simple check for dots)
                    if (ip.includes('.')) {
                        arp[mac] = ip;
                    } else if (!arp[mac]) {
                        arp[mac] = ip;
                    }
                }
            });
        }
        else if (section === 'WIFI') {
            const lines = content.split('\n');
            lines.forEach(line => {
                const macMatch = line.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
                if (macMatch) {
                    const mac = macMatch[0].toLowerCase();
                    wifiMacs.push(mac);
                    const rssiMatch = line.match(/-\d+/);
                    const rssi = rssiMatch ? parseInt(rssiMatch[0]) : null;

                    clientMap.set(mac, {
                        mac,
                        rssi,
                        type: 'wireless'
                    });
                }
            });
            stats.wifi_clients = wifiMacs.length;
        }
        else if (section === 'NEIGH') {
            content.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5) {
                    const ip = parts[0];
                    const macIndex = parts.indexOf('lladdr');
                    if (macIndex !== -1 && parts[macIndex + 1]) {
                        const mac = parts[macIndex + 1].toLowerCase();
                        // Prioritize IPv4
                        if (ip.includes('.')) {
                            arp[mac] = ip;
                        } else if (!arp[mac]) {
                            arp[mac] = ip;
                        }
                    }
                }
            });
        }
        else if (section === 'DHCP_CONF') {
            // Parse uci-style config host
            const hostBlocks = content.split('config host');
            hostBlocks.forEach(block => {
                const macMatch = block.match(/option mac\s+'([^']+)'/) || block.match(/option mac\s+"([^"]+)"/);
                const nameMatch = block.match(/option name\s+'([^']+)'/) || block.match(/option name\s+"([^"]+)"/);
                if (macMatch && nameMatch) {
                    const macs = macMatch[1].toLowerCase().split(' ');
                    macs.forEach(mac => {
                        dhcp_hosts[mac] = nameMatch[1];
                    });
                }
            });
        }
        else if (section === 'WIFI_INFO_DETAIL') {
            const lines = content.split('\n');
            lines.forEach(line => {
                const essidMatch = line.match(/ESSID: "([^"]+)"/);
                const meshMatch = line.match(/Mesh ID: "([^"]+)"/);
                const modeMatch = line.match(/Mode: ([^ \t\n\r]+)/);
                if (essidMatch) stats.essid = essidMatch[1];
                if (meshMatch) stats.mesh_id = meshMatch[1];
                if (modeMatch) stats.wifi_mode = modeMatch[1];
            });
        }
    }

    stats.raw_leases = leases;
    stats.raw_arp = arp;
    stats.dhcp_hosts = dhcp_hosts;
    stats.wifi_macs = Array.from(clientMap.values());

    return stats;
}

module.exports = { getDeviceStats, parseStats };
