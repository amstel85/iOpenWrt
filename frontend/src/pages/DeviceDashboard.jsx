import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, Clock, Cpu, HardDrive, Wifi, ArrowDownToLine, ArrowUpFromLine, Power, RefreshCw } from 'lucide-react';
import api from '../api';

const DeviceDashboard = () => {
    const { id } = useParams();
    const [device, setDevice] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
                    {/* CPU Load */}
                    <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
                        <div className="flex items-center mb-4">
                            <div className="p-2 rounded-full bg-indigo-100 text-indigo-600 mr-3">
                                <Cpu className="w-6 h-6" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-500">CPU Load (1m)</h3>
                        </div>
                        <p className="text-3xl font-semibold text-gray-900">{stats.load['1m']}</p>
                        <p className="text-xs text-gray-400 mt-2">5m: {stats.load['5m']} | 15m: {stats.load['15m']}</p>
                    </div>

                    {/* Memory */}
                    <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
                        <div className="flex items-center mb-4">
                            <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3">
                                <HardDrive className="w-6 h-6" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-500">Memory Used</h3>
                        </div>
                        <p className="text-3xl font-semibold text-gray-900">{stats.memory.percent}%</p>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3 mb-1">
                            <div className={`h-1.5 rounded-full ${stats.memory.percent > 90 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${stats.memory.percent}%` }}></div>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{formatBytes(stats.memory.used * 1024)} / {formatBytes(stats.memory.total * 1024)}</p>
                    </div>

                    {/* WiFi Clients */}
                    <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
                        <div className="flex items-center mb-4">
                            <div className="p-2 rounded-full bg-teal-100 text-teal-600 mr-3">
                                <Wifi className="w-6 h-6" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-500">Connected Clients</h3>
                        </div>
                        <p className="text-3xl font-semibold text-gray-900">{stats.wifi_clients}</p>
                        <p className="text-xs text-gray-400 mt-2">Wireless nodes associated</p>
                    </div>

                    {/* Uptime */}
                    <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
                        <div className="flex items-center mb-4">
                            <div className="p-2 rounded-full bg-purple-100 text-purple-600 mr-3">
                                <Clock className="w-6 h-6" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-500">Uptime</h3>
                        </div>
                        <p className="text-3xl font-semibold text-gray-900">{formatUptime(stats.uptime)}</p>
                        <p className="text-xs text-gray-400 mt-2">Time since last boot</p>
                    </div>

                    {/* Traffic Stats (Full Width) */}
                    <div className="col-span-1 md:col-span-2 lg:col-span-4 bg-white rounded-lg shadow p-6 border border-gray-100 mt-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-6 flex items-center">
                            <Activity className="w-5 h-5 mr-2 text-gray-400" /> Interface Traffic (Since Boot)
                        </h3>
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <div className="flex items-center text-gray-500 mb-2">
                                    <ArrowDownToLine className="w-4 h-4 mr-2 text-green-500" />
                                    <span>Total Download (RX)</span>
                                </div>
                                <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.network.rx_bytes)}</p>
                            </div>
                            <div>
                                <div className="flex items-center text-gray-500 mb-2">
                                    <ArrowUpFromLine className="w-4 h-4 mr-2 text-blue-500" />
                                    <span>Total Upload (TX)</span>
                                </div>
                                <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.network.tx_bytes)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeviceDashboard;
