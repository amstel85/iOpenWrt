/**
 * Simple OUI lookup service to identify device manufacturers.
 */

const OUI_MAP = {
    '00:05:02': 'Apple',
    '00:03:93': 'Apple',
    '3c:22:fb': 'Apple',
    'd8:a2:5e': 'Apple',
    'fc:fc:48': 'Apple',
    '28:cf:da': 'Apple',
    '00:1c:b3': 'Apple',
    'f4:5c:89': 'Apple',
    '00:15:ad': 'VMware',
    '00:0c:29': 'VMware',
    '00:50:56': 'VMware',
    'b4:21:c7': 'Samsung',
    'f0:25:b7': 'Samsung',
    '38:aa:3c': 'Samsung',
    'b0:70:2d': 'Samsung',
    '64:16:66': 'Samsung',
    'dc:2c:26': 'Samsung',
    'ac:5a:f0': 'Samsung',
    '1c:5a:3e': 'Samsung',
    '00:1a:11': 'Google',
    '3c:5a:b4': 'Google',
    'd8:0d:17': 'Google',
    '00:ec:0a': 'Xiaomi',
    '64:90:c1': 'Xiaomi',
    '98:2c:be': 'Xiaomi',
    '00:1d:d9': 'Microsoft',
    '24:4b:fe': 'Microsoft',
    '44:37:e6': 'Microsoft',
    '00:e0:4c': 'Realtek',
    '00:1e:10': 'Shenzhen',
    '00:26:37': 'Shenzhen',
    'ec:fa:bc': 'Espressif (IoT)',
    '24:b2:de': 'Espressif (IoT)',
    '30:ae:a4': 'Espressif (IoT)',
    '4c:11:ae': 'Espressif (IoT)',
    '80:7d:3a': 'Espressif (IoT)',
    'a4:cf:12': 'Espressif (IoT)',
    '84:0d:8e': 'TP-Link',
    '50:c7:bf': 'TP-Link',
    '00:31:92': 'TP-Link',
    'e8:48:b8': 'TP-Link',
    'b0:4e:26': 'TP-Link',
    'c0:25:a5': 'Dell',
    'd4:81:d7': 'Dell',
    '14:b3:1f': 'Dell',
    'b8:2a:72': 'Dell',
    '00:21:70': 'HP',
    '3c:d9:2b': 'HP',
    'd8:9d:67': 'HP'
};

function getManufacturer(mac) {
    if (!mac) return 'Unknown';
    const oui = mac.substring(0, 8).toLowerCase();
    return OUI_MAP[oui] || 'Generic Device';
}

module.exports = { getManufacturer };
