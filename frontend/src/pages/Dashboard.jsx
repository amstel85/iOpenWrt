import { useState, useEffect } from 'react';
import { Activity, Server, AlertCircle, CheckCircle2, Users, X, Wifi, Monitor } from 'lucide-react';
import api from '../api';

const Dashboard = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedClients, setSelectedClients] = useState(null); // For modal

    useEffect(() => {
        const fetchDevices = async () => {
            try {
                const res = await api.get('/devices');
                setDevices(res.data);
            } catch (err) {
                console.error("Failed to fetch dashboard data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchDevices();
        const interval = setInterval(fetchDevices, 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }, []);

    if (loading) return <div className="p-8 text-center text-gray-500">Loading Network Data...</div>;

    const total = devices.length;
    const online = devices.filter(d => d.status === 'online').length;
    const offline = total - online;

    // Aggregate clients
    const allClients = [];
    devices.forEach(d => {
        if (d.clients_json) {
            try {
                const clients = JSON.parse(d.clients_json);
                clients.forEach(c => allClients.push({ ...c, routerName: d.name }));
            } catch (e) { console.error(e); }
        }
    });

    const totalClients = allClients.length;

    // Overall Health
    let hColor = 'text-green-500';
    let hText = 'Healthy';
    let HIcon = CheckCircle2;
    if (total === 0) {
        hColor = 'text-gray-400';
        hText = 'No Devices';
        HIcon = Server;
    } else if (offline === total) {
        hColor = 'text-red-500';
        hText = 'Critical';
        HIcon = AlertCircle;
    } else if (offline > 0) {
        hColor = 'text-yellow-500';
        hText = 'Warning';
        HIcon = AlertCircle;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-gray-900">Network Dashboard</h1>

            {/* Top Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
                        <Server className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Managed Routers</p>
                        <p className="text-2xl font-semibold text-gray-900">{total}</p>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center">
                    <div className={`p-3 rounded-full mr-4 ${online > 0 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        <Activity className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Online Routers</p>
                        <p className="text-2xl font-semibold text-gray-900">{online}</p>
                    </div>
                </div>

                <div
                    className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => totalClients > 0 && setSelectedClients(allClients)}
                >
                    <div className="p-3 rounded-full bg-purple-100 text-purple-600 mr-4">
                        <Users className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Connected Clients</p>
                        <div className="flex items-baseline">
                            <p className="text-2xl font-semibold text-gray-900">{totalClients}</p>
                            {totalClients > 0 && <span className="ml-2 text-xs text-purple-500 font-medium">Click to view</span>}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center">
                    <div className={`p-3 rounded-full mr-4 bg-opacity-20 ${hColor.replace('text-', 'bg-')} ${hColor}`}>
                        <HIcon className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Network Health</p>
                        <p className={`text-2xl font-semibold ${hColor}`}>{hText}</p>
                    </div>
                </div>
            </div>

            {/* Device Status Grid */}
            <h2 className="text-lg font-medium text-gray-900 mt-8 mb-4">Device Status Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map(device => (
                    <div key={device.id} className="bg-white rounded-lg shadow border border-gray-100 p-5">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900">{device.name}</h3>
                                <p className="text-sm text-gray-500 font-mono">{device.ip}</p>
                            </div>
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${device.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                {device.status.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex justify-between items-end">
                            <div className="text-sm text-gray-500">
                                Last Seen: {device.last_seen ? new Date(device.last_seen + 'Z').toLocaleString() : 'Never'}
                            </div>
                            {device.status === 'online' && (
                                <div className="flex items-center text-xs font-medium text-purple-600 bg-purple-50 px-2 py-1 rounded">
                                    <Users className="w-3 h-3 mr-1" />
                                    {device.client_count || 0}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {devices.length === 0 && (
                    <div className="col-span-full p-8 text-center border-2 border-dashed border-gray-300 rounded-lg text-gray-500">
                        No devices connected to the network yet. Go to the Devices tab to add one.
                    </div>
                )}
            </div>

            {/* Client List Modal */}
            {selectedClients && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Connected Clients</h3>
                                <p className="text-sm text-gray-500">Total {selectedClients.length} devices across all routers</p>
                            </div>
                            <button
                                onClick={() => setSelectedClients(null)}
                                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                            >
                                <X className="w-6 h-6 text-gray-400" />
                            </button>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto p-0">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold sticky top-0">
                                    <tr>
                                        <th className="px-6 py-3">Client Name</th>
                                        <th className="px-6 py-3">IP Address</th>
                                        <th className="px-6 py-3">Connection</th>
                                        <th className="px-6 py-3">Router</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {selectedClients.map((client, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-gray-900">{client.name}</td>
                                            <td className="px-6 py-4 text-gray-600 font-mono text-sm">{client.ip}</td>
                                            <td className="px-6 py-4">
                                                <span className={`flex items-center text-xs font-semibold px-2 py-1 rounded-full ${client.type === 'wireless' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                                    {client.type === 'wireless' ? <Wifi className="w-3 h-3 mr-1" /> : <Monitor className="w-3 h-3 mr-1" />}
                                                    {client.type.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-500">{client.routerName}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
