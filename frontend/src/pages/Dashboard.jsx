import { useState, useEffect } from 'react';
import { Activity, Server, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../api';

const Dashboard = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
                        <Server className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Managed Devices</p>
                        <p className="text-2xl font-semibold text-gray-900">{total}</p>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6 border border-gray-100 flex items-center">
                    <div className={`p-3 rounded-full mr-4 ${online > 0 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        <Activity className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Online Devices</p>
                        <p className="text-2xl font-semibold text-gray-900">{online}</p>
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
                        <div className="text-sm text-gray-500">
                            Last Seen: {device.last_seen ? new Date(device.last_seen + 'Z').toLocaleString() : 'Never'}
                        </div>
                    </div>
                ))}
                {devices.length === 0 && (
                    <div className="col-span-full p-8 text-center border-2 border-dashed border-gray-300 rounded-lg text-gray-500">
                        No devices connected to the network yet. Go to the Devices tab to add one.
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
