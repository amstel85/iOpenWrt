import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, Clock, Cpu, HardDrive, Wifi, ArrowDownToLine, ArrowUpFromLine, Power, RefreshCw, Database, Users } from 'lucide-react';
import api from '../api';

const DeviceDashboard = () => {
    const { id } = useParams();
    const [device, setDevice] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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
        const fetchDeviceData = async () => {
            try {
                // Fetch basic device info
                const devRes = await api.get(`/devices/${id}`);
                setDevice(devRes.data);

                // Fetch real-time stats
                const statRes = await api.get(`/devices/${id}/stats`);
                setStats(statRes.data);
                setError(null);
            } catch (err) {
                console.error("Failed to fetch device stats", err);
                setError("Failed to connect to device. Is it online?");
            } finally {
                setLoading(false);
            }
        };

        setLoading(true);
        fetchDeviceData();
        const interval = setInterval(fetchDeviceData, 5000); // Poll every 5 seconds for live stats
        return () => clearInterval(interval);
    }, [id]);

    if (loading && !device) return <div className="p-8 text-center text-gray-500">Loading Device Data...</div>;

    // Formatting Helpers
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds) => {
        if (!seconds) return '0s';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor(seconds % (3600 * 24) / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m}m`;
    };

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
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{stats.cpu_usage}%</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">CPU Performance</p>
                        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 rounded-full transition-all duration-1000" style={{ width: `${stats.cpu_usage}%` }}></div>
                        </div>
                    </div>

                    {/* Memory Usage */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                                <Database className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{stats.memory_usage}%</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Memory Utilized</p>
                        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${stats.memory_usage}%` }}></div>
                        </div>
                    </div>

                    {/* WiFi Clients */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                                <Users className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-xl md:text-2xl font-black text-gray-900 leading-none">{stats.clients}</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Active Clients</p>
                        <p className="text-[11px] text-gray-400 mt-2 font-medium">Monitoring <span className="text-purple-600">{stats.clients_list?.length || 0}</span> local targets</p>
                    </div>

                    {/* Uptime */}
                    <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                                <Clock className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-sm md:text-base font-black text-gray-900 truncate ml-2">{stats.uptime}</span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">System Uptime</p>
                        <p className="text-[11px] text-emerald-600 font-bold mt-2 uppercase tracking-tighter">Node is Healthy</p>
                    </div>

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
                            <div className="space-y-4">
                                <div className="flex justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <span>Download Speed</span>
                                    <span className="text-emerald-500">RX Traffic</span>
                                </div>
                                <div className="flex items-baseline">
                                    <span className="text-3xl md:text-4xl font-black text-gray-900 mr-2">{stats.traffic_rx}</span>
                                    <span className="text-sm font-bold text-gray-400">Mbps</span>
                                </div>
                                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 animate-pulse" style={{ width: '65%' }}></div>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="flex justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <span>Upload Speed</span>
                                    <span className="text-blue-500">TX Traffic</span>
                                </div>
                                <div className="flex items-baseline">
                                    <span className="text-3xl md:text-4xl font-black text-gray-900 mr-2">{stats.traffic_tx}</span>
                                    <span className="text-sm font-bold text-gray-400">Mbps</span>
                                </div>
                                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{ width: '25%' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeviceDashboard;
