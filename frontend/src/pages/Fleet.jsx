import { useState, useEffect, useCallback } from 'react';
import { Network, RefreshCw, ShieldCheck, ShieldAlert, Radio, Users, Cpu, AlertTriangle, Info } from 'lucide-react';
import api from '../api';

/**
 * Fleet view — all the AP units together. Answers the questions that only make sense across a
 * fleet: is everyone on the same firmware, is 802.11r consistent, do any 2.4 GHz radios collide.
 * Backed by /api/fleet, which SSHes each unit once on demand.
 */
const Fleet = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/fleet');
            setData(res.data);
            setError(null);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not build the fleet overview.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const s = data?.summary;
    const sevIcon = { warning: AlertTriangle, info: Info };
    const sevColor = { warning: 'text-amber-500 bg-amber-50 border-amber-200', info: 'text-blue-500 bg-blue-50 border-blue-200' };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 flex items-center">
                        <Network className="w-6 h-6 mr-2 text-blue-600" /> Fleet
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Firmware, roaming and channel health across all access points.</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all ${loading
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100'}`}
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    <span>{loading ? 'Scanning…' : 'Refresh'}</span>
                </button>
            </div>

            {error && <div className="bg-red-50 border-l-4 border-red-400 p-4 text-sm text-red-700">{error}</div>}

            {loading && !data && <div className="p-8 text-center text-gray-500">Scanning the fleet…</div>}

            {s && (
                <>
                    {/* Health banner */}
                    <div className={`rounded-2xl p-5 border flex items-center ${s.healthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        {s.healthy
                            ? <ShieldCheck className="w-8 h-8 text-emerald-500 mr-4 flex-shrink-0" />
                            : <ShieldAlert className="w-8 h-8 text-amber-500 mr-4 flex-shrink-0" />}
                        <div>
                            <p className={`text-lg font-bold ${s.healthy ? 'text-emerald-900' : 'text-amber-900'}`}>
                                {s.healthy ? 'Fleet is healthy' : `${s.issue_count} thing${s.issue_count === 1 ? '' : 's'} to look at`}
                            </p>
                            <p className={`text-sm ${s.healthy ? 'text-emerald-700' : 'text-amber-700'}`}>
                                {s.reachable}/{s.total} units reachable · {s.clients} wireless clients
                            </p>
                        </div>
                    </div>

                    {/* Summary tiles */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <SummaryTile icon={Cpu} label="Firmware" value={s.firmware}
                            ok={s.firmware_consistent} okText="all in sync" badText="drifted" />
                        <SummaryTile icon={Radio} label="Roaming (802.11r)" value={s.roaming_domain || '—'}
                            ok={s.roaming_consistent} okText="consistent" badText="mismatch" />
                        <SummaryTile icon={Users} label="Clients" value={String(s.clients)} ok={true} okText="connected" />
                    </div>

                    {/* Issues */}
                    {data.issues.length > 0 && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                            <h3 className="text-sm font-bold text-gray-900 mb-3">What to look at</h3>
                            <ul className="space-y-2">
                                {data.issues.map((iss, i) => {
                                    const Icon = sevIcon[iss.severity] || Info;
                                    return (
                                        <li key={i} className={`flex items-start p-3 rounded-xl border ${sevColor[iss.severity] || sevColor.info}`}>
                                            <Icon className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                                            <span className="text-sm text-gray-800">{iss.detail}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {/* Per-unit grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.units.map((u) => (
                            <div key={u.id ?? u.name} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-bold text-gray-900 truncate">{u.name}</span>
                                        {u.is_gateway && <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">Gateway</span>}
                                    </div>
                                    <span className="text-xs font-mono text-gray-400 shrink-0 ml-2">{u.ip}</span>
                                </div>
                                <dl className="space-y-1.5 text-sm">
                                    <Row k="Firmware" v={u.release || '—'} mono />
                                    <Row k="Kernel" v={u.kernel || '—'} mono />
                                    <Row k="Radios" v={u.radios?.map((r) => `${r.band} ch${r.channel}`).join(' · ') || '—'} />
                                    <Row k="Roaming" v={u.mobility_domains?.length ? u.mobility_domains.join(', ') : 'none'} />
                                    <Row k="Clients" v={u.client_count ?? '—'} />
                                </dl>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {u.ssids?.map((ss) => (
                                        <span key={ss.ssid} className="text-[11px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{ss.ssid}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {data.issues.filter((i) => i.kind === 'unreachable').map((iss, i) => (
                            <div key={`off-${i}`} className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-5 flex items-center text-gray-400">
                                <ShieldAlert className="w-5 h-5 mr-2" /><span className="text-sm">{iss.detail}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const SummaryTile = ({ icon: Icon, label, value, ok, okText, badText }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-2">
            <Icon className="w-5 h-5 text-gray-400" />
            <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                {ok ? okText : badText}
            </span>
        </div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
        <p className="text-xl font-black text-gray-900 mt-1 truncate">{value}</p>
    </div>
);

const Row = ({ k, v, mono }) => (
    <div className="flex justify-between">
        <dt className="text-gray-400">{k}</dt>
        <dd className={`text-gray-800 font-medium ${mono ? 'font-mono text-xs' : ''}`}>{v}</dd>
    </div>
);

export default Fleet;
