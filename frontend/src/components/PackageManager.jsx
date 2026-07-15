import { useState, useEffect, useCallback } from 'react';
import { Package, ShieldAlert, RefreshCw, Download, CheckCircle2, XCircle, Info, Lock } from 'lucide-react';
import api from '../api';

/**
 * Package management panel.
 *
 * Deliberately not an "Upgrade All" button. On OpenWrt, mass upgrading packages is a known way to
 * brick a router, so the flow here is: show what is installed -> tell the user whether upgrades can
 * be trusted at all on this firmware -> let them pick individual packages -> refuse the dangerous
 * ones outright. The backend enforces every one of these rules; the UI only mirrors them.
 */
const PackageManager = ({ deviceId, deviceName }) => {
    const [info, setInfo] = useState(null);
    const [updates, setUpdates] = useState(null);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    // One SSH round-trip; not polled, unlike the stats above.
    const loadInfo = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/devices/${deviceId}/system`);
            setInfo(res.data);
            setError(null);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not read system info from this device.');
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        setInfo(null); setUpdates(null); setSelected([]); setResult(null);
        loadInfo();
    }, [loadInfo]);

    const checkUpdates = async () => {
        setChecking(true); setResult(null); setError(null);
        try {
            const res = await api.get(`/devices/${deviceId}/updates`);
            setUpdates(res.data);
            setInfo(res.data);
            setSelected([]);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to check for updates.');
        } finally {
            setChecking(false);
        }
    };

    const upgrade = async () => {
        const names = selected.join(', ');
        if (!window.confirm(
            `Upgrade ${selected.length} package(s) on ${deviceName}?\n\n${names}\n\n` +
            `This writes to the router's flash. If it loses power mid-install the device may not boot.`
        )) return;

        setUpgrading(true); setResult(null); setError(null);
        try {
            const res = await api.post(`/devices/${deviceId}/upgrade`, { packages: selected });
            setSelected([]);
            // checkUpdates() clears `result` as part of its own reset, and React batches that with
            // anything set before it — so the outcome of a flash write must be set AFTER the
            // refresh, or the panel never renders it and a failed upgrade looks like a clean one.
            await checkUpdates();
            setResult(res.data);
        } catch (err) {
            if (!err.response) {
                // No HTTP response: we lost the server, not the router. opkg may still be writing.
                setError('Lost contact with the controller while the upgrade was running. It may still be in progress on the router — do NOT power-cycle or reboot it. Re-check updates in a minute.');
            } else {
                setError(err.response?.data?.error || 'Upgrade failed.');
            }
        } finally {
            setUpgrading(false);
        }
    };

    const toggle = (name) => setSelected((s) => s.includes(name) ? s.filter((n) => n !== name) : [...s, name]);

    const mb = (kb) => kb === null || kb === undefined ? '?' : `${(kb / 1024).toFixed(1)} MB`;

    if (loading) {
        return (
            <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100 flex items-center text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Reading system info…
            </div>
        );
    }

    if (error && !info) {
        return (
            <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
                <div className="flex items-center text-gray-900 font-bold mb-2"><Package className="w-5 h-5 mr-2 text-gray-400" />Packages</div>
                <p className="text-sm text-red-600">{error}</p>
            </div>
        );
    }

    const health = info?.health || {};
    const unsupported = health.verdict === 'unsupported';
    const upgradable = updates?.upgradable || [];
    const allowed = upgradable.filter((p) => !p.blocked);
    const blocked = upgradable.filter((p) => p.blocked);

    return (
        <div className="col-span-1 sm:col-span-2 lg:col-span-4 bg-white rounded-2xl shadow-sm p-5 md:p-8 border border-gray-100">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-50">
                <div className="flex items-center">
                    <Package className="w-5 h-5 text-indigo-500 mr-2" />
                    <h3 className="text-lg font-bold text-gray-900 tracking-tight">Firmware &amp; Packages</h3>
                </div>
                {!unsupported && (
                    <button
                        onClick={checkUpdates}
                        disabled={checking || upgrading}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all ${checking || upgrading
                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'}`}
                    >
                        {checking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        <span>{checking ? 'Checking…' : 'Check for Updates'}</span>
                    </button>
                )}
            </div>

            {/* System facts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                    ['Firmware', info?.release || '—'],
                    ['Kernel', info?.kernel || '—'],
                    ['Model', info?.model || '—'],
                    ['Free space', info?.overlay_kb_free !== null ? `${mb(info?.overlay_kb_free)} / ${mb(info?.overlay_kb_total)}` : '—'],
                ].map(([label, value]) => (
                    <div key={label}>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="text-sm font-bold text-gray-800 mt-1 truncate" title={value}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Health verdict — the whole point of this panel */}
            {unsupported ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-start">
                    <Info className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-bold text-gray-700">Package management not available</p>
                        <p className="text-sm text-gray-500 mt-1">{health.reasons?.[0]}</p>
                    </div>
                </div>
            ) : health.verdict === 'mismatch' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-start">
                        <ShieldAlert className="w-5 h-5 text-amber-500 mr-3 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-amber-900">Package upgrades are unsafe on this firmware</p>
                            <ul className="mt-2 space-y-1">
                                {health.reasons?.map((r, i) => (
                                    <li key={i} className="text-sm text-amber-800">• {r}</li>
                                ))}
                            </ul>
                            <p className="text-xs text-amber-700 mt-3 leading-relaxed">
                                You can still see what the feed offers, but upgrading is blocked. The way to fix this properly is
                                to flash an official OpenWrt release for this model — then the feeds match the firmware and
                                packages can be upgraded safely.
                            </p>
                        </div>
                    </div>
                </div>
            ) : health.verdict === 'ok' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" />
                    <p className="text-sm text-emerald-800 font-medium">
                        Firmware matches its package feed ({info.feed_release}). Selected upgrades are allowed.
                    </p>
                </div>
            ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center">
                    <Info className="w-4 h-4 text-gray-400 mr-2" />
                    <p className="text-sm text-gray-600">{health.reasons?.[0] || 'Feed status unknown.'}</p>
                </div>
            )}

            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

            {/* Upgrade result */}
            {result && (
                <div className={`mt-4 rounded-xl p-4 border ${result.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center mb-2">
                        {result.success
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" />
                            : <XCircle className="w-4 h-4 text-red-500 mr-2" />}
                        <p className={`text-sm font-bold ${result.success ? 'text-emerald-900' : 'text-red-900'}`}>
                            {result.success ? 'Upgrade completed' : `Upgrade failed (exit ${result.exit_code})`}
                        </p>
                    </div>
                    <pre className="text-[11px] text-gray-600 bg-white/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{result.output}</pre>
                </div>
            )}

            {/* Upgradable list */}
            {updates && !unsupported && (
                <div className="mt-6">
                    {upgradable.length === 0 ? (
                        <p className="text-sm text-gray-500">
                            The feed reports nothing to upgrade. ({info.installed_packages} packages installed.)
                        </p>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                    {upgradable.length} upgradable · {blocked.length} protected
                                </p>
                                {allowed.length > 0 && health.safe_to_upgrade && (
                                    <button
                                        onClick={upgrade}
                                        disabled={selected.length === 0 || upgrading}
                                        className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all ${selected.length === 0 || upgrading
                                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
                                    >
                                        {upgrading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                        <span>{upgrading ? 'Upgrading…' : `Upgrade ${selected.length} selected`}</span>
                                    </button>
                                )}
                            </div>

                            <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-96 overflow-y-auto">
                                {upgradable.map((p) => (
                                    <label
                                        key={p.name}
                                        title={p.blocked ? p.reason : undefined}
                                        className={`flex items-center px-4 py-3 ${p.blocked || !health.safe_to_upgrade
                                            ? 'bg-gray-50/50 cursor-not-allowed'
                                            : 'hover:bg-indigo-50/40 cursor-pointer'}`}
                                    >
                                        <input
                                            type="checkbox"
                                            disabled={p.blocked || !health.safe_to_upgrade}
                                            checked={selected.includes(p.name)}
                                            onChange={() => toggle(p.name)}
                                            className="mr-3 rounded border-gray-300 disabled:opacity-40"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center">
                                                <span className={`text-sm font-bold truncate ${p.blocked ? 'text-gray-400' : 'text-gray-800'}`}>{p.name}</span>
                                                {p.blocked && (
                                                    <span className="ml-2 flex items-center text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">
                                                        <Lock className="w-3 h-3 mr-1" />PROTECTED
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-gray-400 font-mono truncate">{p.current} → {p.available}</p>
                                            {p.blocked && <p className="text-[11px] text-amber-700 mt-1">{p.reason}</p>}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </>
                    )}
                    <p className="text-[11px] text-gray-400 mt-3">
                        Checked {new Date(updates.checked_at).toLocaleTimeString()} · Kernel modules and base system packages are
                        never upgradable from here — they are tied to the exact firmware build and must come from a full
                        firmware image (sysupgrade).
                    </p>
                </div>
            )}
        </div>
    );
};

export default PackageManager;
