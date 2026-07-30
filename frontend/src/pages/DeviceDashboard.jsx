import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Cpu, Power, RefreshCw, Database, Users, Globe, Thermometer } from 'lucide-react';
import api from '../api';
import PackageManager from '../components/PackageManager';

const DeviceDashboard = () => {
    const { id } = useParams();
    const [device, setDevice] = useState(null);
    const [stats, setStats] = useState(null);
    const [rate, setRate] = useState({ rx: 0, tx: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Previous byte counters, to turn cumulative totals into a live rate.
    const prevSample = useRef(null);

    const [rebooting, setRebooting] = useState(false);

    const handleReboot = async () => {
        if (!window.confirm(`Are you sure you want to REBOOT ${device?.name}? This will cause a networking outage for its clients.`)) {
            return;
        }

        setRebooting(true);
        try {
            await api.post(`/devices/${id}/reboot`);
            alert("Reboot command sent successfully!");
        } catch (err) {
            console.error("Reboot failed", err);
            alert("Failed to send reboot command.");
        } finally {
            setRebooting(false);
        }
    };

    useEffect(() => {
        // Clear previous device's data so a failed fetch can't leave it on screen.
        setDevice(null);
        setStats(null);
        setRate({ rx: 0, tx: 0 });
        prevSample.current = null;
        setLoading(true);

        let cancelled = false;
        let inFlight = false;

        const fetchDeviceData = async () => {
            // Each poll opens a fresh SSH connection to the router. If one is slow, a 5s interval
            // stacks connections and can deliver samples out of order, which corrupts the rate.
            if (inFlight) return;
            inFlight = true;
            try {
                const devRes = await api.get(`/devices/${id}`);
                if (cancelled) return;
                setDevice(devRes.data);

                const statRes = await api.get(`/devices/${id}/stats`);
                if (cancelled) return;
                const s = statRes.data;

                // The API returns cumulative interface byte counters, not a speed. Derive the rate
                // from the delta between polls; the first sample has nothing to compare against.
                const now = Date.now();
                const prev = prevSample.current;
                if (prev && s.network) {
                    const seconds = (now - prev.t) / 1000;
                    const dRx = s.network.rx_bytes - prev.rx;
                    const dTx = s.network.tx_bytes - prev.tx;
                    if (seconds > 0 && dRx >= 0 && dTx >= 0) {
                        setRate({ rx: (dRx * 8) / seconds / 1e6, tx: (dTx * 8) / seconds / 1e6 });
                    }
                }
                if (s.network) prevSample.current = { t: now, rx: s.network.rx_bytes, tx: s.network.tx_bytes };

                setStats(s);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                console.error("Failed to fetch device stats", err);
                setError("Failed to connect to device. Is it online?");
                // Don't keep showing a stale rate as if it were live.
                setRate({ rx: 0, tx: 0 });
                prevSample.current = null;
            } finally {
                inFlight = false;
                if (!cancelled) setLoading(false);
            }
        };

        fetchDeviceData();
        const interval = setInterval(fetchDeviceData, 5000); // Poll every 5 seconds for live stats
        return () => { cancelled = true; clearInterval(interval); };
    }, [id]);

    if (loading && !device) return <div className="p-8 text-center text-gray-500">Loading Device Data...</div>;

    const formatUptime = (seconds) => {
        if (!seconds) return '0s';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor(seconds % (3600 * 24) / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m}m`;
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Load average is not a percentage; scale 1-minute load to a bar without pretending it is one.
    const load1m = stats?.load ? parseFloat(stats.load['1m']) || 0 : 0;
    const memPercent = stats?.memory?.percent ?? 0;
    const clientCount = stats?.wifi_clients ?? 0;
    // Not every device exposes a thermal sensor; null means "no data", so hide the card entirely.
    const temp = stats?.temperature ?? null;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">{device?.name}</h1>
                    <p className="text-sm text-gray-500 font-mono mt-1">{device?.ip}</p>
                </div>
                <div className="flex items-center space-x-4">
                    {device?.essid && (
                        <div className="hidden md:flex flex-col items-end mr-2">
                            <span className="text-[10px] text-gray-400 font-bold uppercase">ESSID {device.wifi_mode && <span className="text-blue-300 ml-1">({device.wifi_mode})</span>}</span>
                            <span className="text-sm font-bold text-gray-700">{device.essid}</span>
                        </div>
                    )}
                    {device?.mesh_id && (
                        <div className="hidden md:flex flex-col items-end mr-4">
                            <span className="text-[10px] text-blue-400 font-bold uppercase">Mesh ID</span>
                            <span className="text-sm font-black text-blue-600 px-2 py-0.5 bg-blue-50 rounded-lg">{device.mesh_id}</span>
                        </div>
                    )}
                    {device?.status === 'online' && (
                        <button
                            onClick={handleReboot}
                            disabled={rebooting}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold transition-all shadow-sm border-2 ${rebooting
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100 hover:border-red-200'
                                }`}
                        >
                            {rebooting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                            <span>{rebooting ? 'Rebooting...' : 'Reboot Device'}</span>
                        </button>
                    )}
                    <span className={`px-3 py-1 text-sm font-semibold rounded-full ${device?.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                        {device?.status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                    <span className="text-sm text-gray-500">
                        {/* Display Local Time */}
                        Last Seen: {device?.last_seen ? new Date(device.last_seen + 'Z').toLocaleString() : 'Never'}
                    </span>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border-l-4 border-red-400 p-4">
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mt-8">
                    {/* CPU Usage */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100 group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600">
                                <Cpu className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{load1m.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Load Average (1m)</p>
                        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            {/* A load of 1.00 saturates one core; cap the bar there rather than implying a percentage. */}
                            <div className="h-full bg-orange-500 rounded-full transition-all duration-1000" style={{ width: `${Math.min(load1m * 100, 100)}%` }}></div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2 font-medium">5m {stats.load?.['5m'] ?? '—'} · 15m {stats.load?.['15m'] ?? '—'}</p>
                    </div>

                    {/* Memory Usage */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                                <Database className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{memPercent}%</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Memory Utilized</p>
                        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${memPercent}%` }}></div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2 font-medium">
                            {Math.round((stats.memory?.used || 0) / 1024)} MB of {Math.round((stats.memory?.total || 0) / 1024)} MB
                        </p>
                    </div>

                    {/* WiFi Clients */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                                <Users className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{clientCount}</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Wireless Clients</p>
                        <p className="text-[11px] text-gray-400 mt-2 font-medium">
                            {clientCount === 0 ? 'No wireless clients associated' : `Associated to this radio`}
                        </p>
                    </div>

                    {/* Uptime */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                                <Clock className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-sm md:text-base font-black text-gray-900 truncate ml-2">{formatUptime(stats.uptime)}</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">System Uptime</p>
                        <p className="text-[11px] text-gray-400 font-medium mt-2">
                            Booted {stats.uptime ? new Date(Date.now() - stats.uptime * 1000).toLocaleDateString() : '—'}
                        </p>
                    </div>

                    {/* Temperature (only when the device exposes a thermal sensor) */}
                    {temp != null && (
                        <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                            <div className="flex justify-between items-start mb-4">
                                <div className={`p-2.5 rounded-xl ${temp >= 75 ? 'bg-red-50 text-red-600' : temp >= 60 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                    <Thermometer className="w-5 h-5 md:w-6 md:h-6" />
                                </div>
                                <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{temp.toFixed(1)}°C</span>
                            </div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">CPU Temperature</p>
                            <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                {/* Bar scaled to a 90°C reference; SoCs typically throttle around 80–85°C. */}
                                <div className={`h-full rounded-full transition-all duration-1000 ${temp >= 75 ? 'bg-red-500' : temp >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(temp / 90 * 100, 100)}%` }}></div>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-2 font-medium">
                                {temp >= 75 ? 'Hot — check cooling' : temp >= 60 ? 'Warm' : 'Normal range'}
                            </p>
                        </div>
                    )}

                    {/* Traffic Stats (Full Width on Large, Stacked on Small) */}
                    <div className="col-span-1 sm:col-span-2 lg:col-span-4 bg-white rounded-2xl shadow-sm p-5 md:p-8 border border-gray-100 mt-4">
                        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-50">
                            <div className="flex items-center">
                                <Globe className="w-5 h-5 text-blue-500 mr-2" />
                                <h3 className="text-lg font-bold text-gray-900 tracking-tight">Real-time Interface Traffic</h3>
                            </div>
                            <span className="text-[10px] font-black text-gray-300 uppercase animate-pulse">Live Stream</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 md:gap-12">
                            {[
                                { label: 'Download', side: 'RX', color: 'emerald', rate: rate.rx, total: stats.network?.rx_bytes },
                                { label: 'Upload', side: 'TX', color: 'blue', rate: rate.tx, total: stats.network?.tx_bytes },
                            ].map(({ label, side, color, rate: r, total }) => (
                                <div key={side} className="space-y-4">
                                    <div className="flex justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        <span>{label} Speed</span>
                                        <span className={color === 'emerald' ? 'text-emerald-500' : 'text-blue-500'}>{side} Traffic</span>
                                    </div>
                                    <div className="flex items-baseline">
                                        <span className="text-3xl md:text-4xl font-black text-gray-900 mr-2">{r.toFixed(2)}</span>
                                        <span className="text-sm font-bold text-gray-400">Mbps</span>
                                    </div>
                                    {/* Bar is relative to a 100 Mbps reference; it is not a link-capacity percentage. */}
                                    <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                            style={{ width: `${Math.min(r, 100)}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-[11px] text-gray-400 font-medium">{formatBytes(total || 0)} total since boot</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <PackageManager deviceId={id} deviceName={device?.name} />
                </div>
            )}
        </div>
    );
};

export default DeviceDashboard;
