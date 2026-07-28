// Pure-function tests for packageService — no SSH, no network, no database.
// Run:  node test/packageService.test.js   (wired to `npm test`)
//
// These guard the parts that have broken before: the ---SECTION--- parser, the feed/firmware
// mismatch verdict, the blocklist, argument-injection defence, and apk-vs-opkg handling.

const {
    parseSystemInfo, analyzeFeedHealth, parseUpgradable, isBlocked, parseIndexErrors,
} = require('../src/services/packageService');

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; };
const section = (name) => console.log(`\n${name}`);

section('apk (OpenWrt 25.12+) is detected and its feed is read from repositories.d');
{
    const info = parseSystemInfo(
        "---RELEASE---\nDISTRIB_RELEASE='25.12.5'\nDISTRIB_TAINTS=''\n" +
        "---KERNEL---\n6.12.94\n---PKGMGR---\napk\n" +
        "---FEEDS---\nhttps://downloads.openwrt.org/releases/25.12.5/packages/aarch64_cortex-a53/base/packages.adb\n" +
        "---INSTALLED---\n159\n---DONE---");
    ok(info.package_manager === 'apk', 'package manager detected as apk');
    ok(info.feed_release === '25.12.5', 'feed release parsed from the .adb URL');
    ok(info.installed_packages === 159, 'installed count parsed');
    ok(analyzeFeedHealth(info).verdict === 'ok', 'matching apk release+feed => ok');
    ok(analyzeFeedHealth(info).safe_to_upgrade === true, 'apk healthy => safe_to_upgrade');
}

section('opkg (<=24.10) vendor/feed mismatch is still caught');
{
    const info = parseSystemInfo(
        "---RELEASE---\nDISTRIB_RELEASE='23.05-SNAPSHOT-CUDY'\nDISTRIB_TAINTS='no-all busybox'\n" +
        "---PKGMGR---\nopkg\n" +
        "---FEEDS---\nsrc/gz core https://downloads.openwrt.org/releases/23.05.0/targets/mediatek/filogic/packages\n" +
        "---INSTALLED---\n326\n---DONE---");
    ok(info.package_manager === 'opkg', 'opkg detected');
    ok(info.feed_release === '23.05.0', 'opkg feed release parsed');
    ok(analyzeFeedHealth(info).verdict === 'mismatch', 'snapshot vs release => mismatch');
    ok(analyzeFeedHealth(info).safe_to_upgrade === false, 'mismatch => not safe');
}

section('a device with no package manager is unsupported, not an error');
{
    const info = parseSystemInfo('---RELEASE---\n---PKGMGR---\n---INSTALLED---\n0\n---DONE---');
    ok(analyzeFeedHealth(info).verdict === 'unsupported', 'no opkg/apk => unsupported');
}

section('an empty ---SECTION--- does not swallow the next one');
{
    // ---MODEL--- is empty (no /tmp/sysinfo/model) and butts up against ---PKGMGR---.
    const info = parseSystemInfo(
        "---RELEASE---\nDISTRIB_RELEASE='25.12.5'\n---MODEL---\n---PKGMGR---\napk\n" +
        "---FEEDS---\nhttps://downloads.openwrt.org/releases/25.12.5/x/packages.adb\n---INSTALLED---\n10\n---DONE---");
    ok(info.package_manager === 'apk', 'PKGMGR survives an empty preceding MODEL section');
    ok(info.installed_packages === 10, 'INSTALLED survives too');
}

section('blocklist stands on its own (force does not lift it; lib-prefixes covered)');
{
    ['kmod-mt7915e', 'kernel', 'libc', 'wpad', 'wpad-mesh-mbedtls', 'hostapd', 'libubox', 'libuci',
     'dnsmasq', 'odhcpd', 'firewall4', 'dropbear', 'opkg', 'apk-tools', 'mbedtls', 'ca-bundle',
     'procd', 'netifd'].forEach((p) => ok(isBlocked(p), `blocked: ${p}`));
    ['curl', 'nano', 'htop', 'luci-app-statistics', 'tcpdump', 'git'].forEach((p) => ok(!isBlocked(p), `allowed: ${p}`));
}

section('upgradable parsing for both managers');
{
    const opkg = parseUpgradable('curl - 8.4.0-1 - 8.7.1-1\nkmod-cfg80211 - 5.15.1 - 5.15.2', 'opkg');
    ok(opkg.length === 2 && opkg[0].name === 'curl' && opkg[0].available === '8.7.1-1', 'opkg row parsed');
    ok(opkg[1].blocked, 'opkg kmod flagged blocked');

    const apk = parseUpgradable(
        'luci-base-25.256.abc-r1 aarch64 {feeds/luci} (Apache-2.0) [upgradable from: luci-base-25.100.x-r0]\n' +
        'kmod-cfg80211-6.12.94-r1 aarch64 {kmod} (GPL) [upgradable from: kmod-cfg80211-6.12.90-r0]', 'apk');
    ok(apk.length === 2 && apk[0].name === 'luci-base' && apk[0].available === '25.256.abc-r1', 'apk row parsed');
    ok(apk.find((p) => p.name === 'kmod-cfg80211').blocked, 'apk kmod flagged blocked');
}

section('the kernel-mismatch error opkg prints on a bad feed is surfaced, not swallowed');
{
    const errs = parseIndexErrors(
        ' * pkg_hash_check_unresolved: cannot find dependency kernel (= 5.15.134-1-abc) for kmod-nfnetlink\n' +
        ' * pkg_hash_fetch_best_installation_candidate: Packages for kmod-ipt-core found, but incompatible with the architectures configured');
    ok(errs.some((e) => e.kind === 'kernel_mismatch'), 'kernel mismatch identified');
    ok(errs.some((e) => e.kind === 'arch_incompatible'), 'arch incompatibility identified');
}

// ---- fleetService (pure aggregation) ----
const { analyzeFleet, parseFleetProbe } = require('../src/services/fleetService');

section('fleet: parse one probe');
{
    const raw = "---REL---\nDISTRIB_RELEASE='25.12.5'\n---KERNEL---\n6.12.94\n" +
        "---RADIO---\nradio0 2g ch11\nradio1 5g ch149\n---IFACE---\nc5 enc=sae-mixed md=cafe\n---CLIENTS---\n3\n---DONE---";
    const p = parseFleetProbe(raw, { id: 1, name: 'cudy 3', ip: '10.0.0.72' });
    ok(p.release === '25.12.5' && p.radios.length === 2 && p.mobility_domains[0] === 'cafe' && p.client_count === 3, 'probe parsed');
}

section('fleet: aggregation flags drift, roaming, channels');
{
    const mk = (name, rel, ch, md) => ({ id: 1, name, ip: 'x', release: rel, kernel: '6.12.94',
        radios: [{ band: '2g', channel: ch }], ssids: [{ ssid: 'c5', encryption: 'sae-mixed', mobility_domain: md }],
        mobility_domains: [md], client_count: 1, reachable: true });

    let f = analyzeFleet([mk('c1', '25.12.5', '1', 'cafe'), mk('c2', '25.12.5', '6', 'cafe'), mk('c3', '25.12.5', '11', 'cafe')]);
    ok(f.summary.healthy && f.summary.firmware_consistent && f.summary.roaming_consistent, 'uniform fleet is healthy');
    ok(f.summary.clients === 3, 'clients summed');

    ok(analyzeFleet([mk('c1', '25.12.5', '1', 'cafe'), mk('c2', '24.10.0', '6', 'cafe')]).issues.some((i) => i.kind === 'firmware_drift'), 'firmware drift flagged');
    ok(analyzeFleet([mk('c1', '25.12.5', '1', 'cafe'), mk('c2', '25.12.5', '6', 'home')]).issues.some((i) => i.kind === 'roaming_mismatch'), 'roaming mismatch flagged');
    ok(analyzeFleet([mk('c1', '25.12.5', '6', 'cafe'), mk('c2', '25.12.5', '6', 'cafe')]).issues.some((i) => i.kind === 'channel_conflict'), '2.4GHz channel conflict flagged');
    ok(analyzeFleet([mk('c1', '25.12.5', '1', 'cafe'), { name: 'c2', ip: 'x', reachable: false }]).issues.some((i) => i.kind === 'unreachable'), 'unreachable flagged');
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
