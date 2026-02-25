import { useState, useEffect } from 'react';
import { Activity, Server, AlertCircle, CheckCircle2, Users, X, Wifi, Monitor, RefreshCw, LayoutTemplate, Edit2, Check, Ban } from 'lucide-react';
import api from '../api';
import TopologyMap from '../components/TopologyMap';

const Dashboard = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [selectedClients, setSelectedClients] = useState(null); // For modal
    const [renamingMac, setRenamingMac] = useState(null);
    const [newName, setNewName] = useState('');

    const fetchDevices = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const res = await api.get('/devices');
            setDevices(res.data);

            // Refresh modal data if open
            if (selectedClients) {
                const updatedClients = [];
                res.data.forEach(d => {
                    if (d.clients_json) {
                        try {
                            const clients = JSON.parse(d.clients_json);
                            clients.forEach(c => updatedClients.push({ ...c, routerName: d.name }));
                        } catch (e) { console.error(e); }
                    }
                });
                setSelectedClients(updatedClients);
            }
        } catch (err) {
            console.error("Failed to fetch dashboard data", err);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    const handleRename = async (mac) => {
        if (!newName.trim()) return;
        try {
            await api.post('/clients/register', { mac, name: newName.trim() });
            setRenamingMac(null);
            setNewName('');
            await handleSync(); // Trigger full sync to propagate names
        } catch (err) {
            console.error("Failed to rename client", err);
            alert("Failed to save name");
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            await api.post('/network/sync');
            await fetchDevices(false);
        } catch (err) {
            console.error("Manual sync failed", err);
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const interval = setInterval(() => fetchDevices(false), 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }, []);

    if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Initializing Network Intelligence...</div>;

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

    // Mesh Consistency Audit
    const onlineDevices = devices.filter(d => d.status === 'online');
    const meshIds = [...new Set(onlineDevices.map(d => d.mesh_id).filter(id => id))];
    const ssids = [...new Set(onlineDevices.map(d => d.essid).filter(id => id))];

    const isMeshConsistent = meshIds.length <= 1 && ssids.length <= 1;
    const dominantMeshId = meshIds[0] || 'Unknown';
    const dominantSsid = ssids[0] || 'Unknown';

    // Overall Health
    let hColor = 'text-green-500';
    let hBg = 'bg-green-100';
    let hText = 'Healthy';
    let HIcon = CheckCircle2;
    if (total === 0) {
        hColor = 'text-gray-400';
        hBg = 'bg-gray-100';
        hText = 'No Devices';
        HIcon = Server;
    } else if (offline === total) {
        hColor = 'text-red-500';
        hBg = 'bg-red-100';
        hText = 'Critical';
        HIcon = AlertCircle;
    } else if (!isMeshConsistent) {
        hColor = 'text-orange-500';
        hBg = 'bg-orange-100';
        hText = 'Mesh Mismatch';
        HIcon = AlertCircle;
    } else if (offline > 0) {
        hColor = 'text-yellow-500';
        hBg = 'bg-yellow-100';
        hText = 'Warning';
        HIcon = AlertCircle;
    }

    const getSignalColor = (rssi) => {
        if (!rssi) return 'text-gray-400';
        if (rssi > -60) return 'text-green-500';
        if (rssi > -75) return 'text-yellow-500';
        return 'text-red-500';
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Main Dashboard</h1>
                    <p className="text-gray-500 text-sm mt-1">Live overview of your managed OpenWrt network</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all w-full md:w-auto ${syncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white border hover:bg-gray-50 text-gray-700 shadow-sm'
                        }`}
                >
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                    <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
            </div>

            {/* Top Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <div className="bg-white rounded-2xl shadow-sm p-4 md:p-6 border border-gray-100 flex items-center group hover:shadow-md transition-shadow">
                    <div className="p-3 md:p-4 rounded-xl bg-blue-50 text-blue-600 mr-4 group-hover:bg-blue-100 transition-colors">
                        <Server className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Managed Nodes</p>
                        <p className="text-xl md:text-2xl font-black text-gray-900 leading-none mt-1">{total}</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-4 md:p-6 border border-gray-100 flex items-center group hover:shadow-md transition-shadow">
                    <div className={`p-3 md:p-4 rounded-xl mr-4 transition-colors ${online > 0 ? 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100' : 'bg-gray-50 text-gray-400'}`}>
                        <Activity className={`w-6 h-6 md:w-8 md:h-8 ${online > 0 ? 'animate-pulse' : ''}`} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Online Status</p>
                        <p className="text-xl md:text-2xl font-black text-gray-900 leading-none mt-1">{online}</p>
                    </div>
                </div>

                <div
                    className="bg-white rounded-2xl shadow-sm p-4 md:p-6 border border-gray-100 flex items-center cursor-pointer group hover:shadow-md hover:border-purple-200 transition-all"
                    onClick={() => totalClients > 0 && setSelectedClients(allClients)}
                >
                    <div className="p-3 md:p-4 rounded-xl bg-purple-50 text-purple-600 mr-4 group-hover:bg-purple-100 transition-colors">
                        <Users className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Connected Clients</p>
                        <div className="flex items-center mt-1">
                            <p className="text-xl md:text-2xl font-black text-gray-900 leading-none">{totalClients}</p>
                            {totalClients > 0 && <span className="ml-2 text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-bold uppercase">VIEW</span>}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-4 md:p-6 border border-gray-100 flex items-center group hover:shadow-md transition-shadow">
                    <div className={`p-3 md:p-4 rounded-xl mr-4 bg-opacity-50 ${hBg} ${hColor}`}>
                        <HIcon className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Internal Health</p>
                        <p className={`text-xl md:text-2xl font-black leading-none mt-1 ${hColor}`}>{hText}</p>
                    </div>
                </div>
            </div>

            {/* Topology Map */}
            <div className="pt-4 overflow-hidden">
                <div className="flex items-center space-x-2 mb-4">
                    <LayoutTemplate className="w-5 h-5 text-blue-600" />
                    <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight">Logical Topology</h2>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-2 md:p-4 overflow-x-auto">
                    <TopologyMap devices={devices} />
                </div>
            </div>

            {/* Device Status Grid */}
            <div className="pt-4 flex items-center justify-between">
                <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight">Active Infrastructure</h2>
                <span className="text-[10px] md:text-xs font-medium text-gray-400 uppercase">Updates every 30s</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {devices.map(device => (
                    <div key={device.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6 hover:shadow-md transition-all group overflow-hidden relative">
                        {device.status === 'online' && (
                            <div className="absolute top-0 right-0 w-20 h-20 -mr-8 -mt-8 bg-emerald-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        )}
                        <div className="flex justify-between items-start mb-6 relative">
                            <div className="pr-4">
                                <h3 className="text-base md:text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors truncate">{device.name}</h3>
                                <p className="text-[10px] md:text-xs text-gray-400 font-mono tracking-tighter mt-0.5">{device.ip}</p>
                            </div>
                            <span className={`px-2 py-0.5 text-[9px] font-black tracking-widest rounded-lg border shadow-sm whitespace-nowrap ${device.status === 'online' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'
                                }`}>
                                {device.status.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex justify-between items-end relative">
                            <div className="space-y-0.5">
                                <p className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Last Pulse</p>
                                <p className="text-xs text-gray-600 font-medium tracking-tight">
                                    {device.last_seen ? new Date(device.last_seen + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Establishing...'}
                                </p>
                            </div>
                            <div className="flex flex-col items-end space-y-2">
                                {device.status === 'online' && (
                                    <>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[9px] text-blue-400 font-bold uppercase mb-0.5 truncate max-w-[100px]">
                                                {device.essid || 'No SSID'}
                                            </span>
                                            <div className="text-[9px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-lg border border-blue-100">
                                                {device.mesh_id || 'STANDALONE'}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <div className="flex items-center text-sm md:text-base font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-100">
                                                <Users className="w-3.5 h-3.5 mr-1" />
                                                {device.client_count || 0}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Client List Modal */}
            {selectedClients && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-2xl md:rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in slide-in-from-bottom-8 duration-300 border-2 md:border-4 border-white flex flex-col max-h-[90vh]">
                        <div className="p-4 md:p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/50 shrink-0">
                            <div>
                                <h3 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Network Clients</h3>
                                <p className="text-xs md:text-sm text-gray-500 mt-1">Found across <span className="font-bold text-blue-600">{total}</span> infrastructure nodes</p>
                            </div>
                            <button
                                onClick={() => setSelectedClients(null)}
                                className="p-2 md:p-3 hover:bg-white hover:shadow-sm rounded-xl md:rounded-2xl transition-all group"
                            >
                                <X className="w-5 h-5 md:w-6 md:h-6 text-gray-400 group-hover:text-red-500 transition-colors" />
                            </button>
                        </div>

                        <div className="overflow-y-auto grow custom-scrollbar">
                            {/* Desktop Table View */}
                            <table className="hidden md:table w-full text-left">
                                <thead className="bg-gray-50/50 text-[11px] uppercase text-gray-400 font-black tracking-widest sticky top-0 backdrop-blur-md">
                                    <tr>
                                        <th className="px-8 py-5">Device Identity</th>
                                        <th className="px-8 py-5">Network Access</th>
                                        <th className="px-8 py-5">Signal/Type</th>
                                        <th className="px-8 py-5">Gateway</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {selectedClients.map((client, idx) => (
                                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors group">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center space-x-3">
                                                    {renamingMac === client.mac ? (
                                                        <div className="flex items-center space-x-2">
                                                            <input
                                                                autoFocus
                                                                className="text-sm font-bold border-b-2 border-blue-500 outline-none bg-transparent"
                                                                value={newName}
                                                                onChange={(e) => setNewName(e.target.value)}
                                                                onKeyDown={(e) => e.key === 'Enter' && handleRename(client.mac)}
                                                            />
                                                            <button onClick={() => handleRename(client.mac)} className="text-emerald-500 hover:text-emerald-600">
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => setRenamingMac(null)} className="text-red-400 hover:text-red-500">
                                                                <Ban className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-col">
                                                                <span className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{client.name}</span>
                                                                <span className="text-[10px] text-gray-400 font-bold uppercase mt-1 tracking-tight">
                                                                    {client.manufacturer} • {client.rssi ? `${client.rssi} dBm` : 'Unknown Signal'}
                                                                </span>
                                                                <span className="text-[9px] text-blue-400 font-medium italic mt-0.5">
                                                                    Connected to {client.routerName}
                                                                </span>
                                                            </div>
                                                            <button
                                                                onClick={() => { setRenamingMac(client.mac); setNewName(client.name); }}
                                                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-blue-500 transition-all"
                                                            >
                                                                <Edit2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-gray-600 font-mono tracking-tight">{client.ip}</span>
                                                    <span className="text-[10px] text-gray-300 font-mono mt-0.5">{client.mac}</span>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <div className="flex items-center space-x-3">
                                                    <span className={`flex items-center text-[10px] font-black tracking-widest px-2.5 py-1.5 rounded-xl border-2 ${client.type === 'wireless'
                                                        ? 'bg-blue-50 text-blue-700 border-blue-100'
                                                        : 'bg-slate-50 text-slate-700 border-slate-100'
                                                        }`}>
                                                        {client.type === 'wireless' ? <Wifi className="w-3.5 h-3.5 mr-1.5" /> : <Monitor className="w-3.5 h-3.5 mr-1.5" />}
                                                        {client.type.toUpperCase()}
                                                    </span>
                                                    {client.rssi && (
                                                        <div className="flex flex-col">
                                                            <span className={`text-xs font-black ${getSignalColor(client.rssi)}`}>{client.rssi} dBm</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <span className="text-xs font-black text-gray-400 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200">{client.routerName}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Mobile Card View */}
                            <div className="md:hidden divide-y divide-gray-100">
                                {selectedClients.map((client, idx) => (
                                    <div key={idx} className="p-4 space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center space-x-2">
                                                {renamingMac === client.mac ? (
                                                    <div className="flex items-center space-x-2">
                                                        <input
                                                            autoFocus
                                                            className="text-sm font-bold border-b-2 border-blue-500 outline-none bg-transparent w-32"
                                                            value={newName}
                                                            onChange={(e) => setNewName(e.target.value)}
                                                        />
                                                        <button onClick={() => handleRename(client.mac)} className="text-emerald-500">
                                                            <Check className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setRenamingMac(null)} className="text-red-400">
                                                            <Ban className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-gray-900">{client.name}</span>
                                                            <div className="flex flex-col mt-0.5">
                                                                <span className="text-[10px] text-gray-400 font-bold uppercase leading-none">{client.manufacturer}</span>
                                                                <span className="text-[9px] text-blue-400 font-medium italic mt-1 leading-none">
                                                                    {client.rssi} dBm @ {client.routerName}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => { setRenamingMac(client.mac); setNewName(client.name); }}
                                                            className="p-1 text-gray-300"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            <span className={`flex items-center text-[9px] font-black tracking-widest px-2 py-1 rounded-lg border shadow-sm ${client.type === 'wireless'
                                                ? 'bg-blue-50 text-blue-700 border-blue-100'
                                                : 'bg-slate-50 text-slate-700 border-slate-100'
                                                }`}>
                                                {client.type === 'wireless' ? <Wifi className="w-3 h-3 mr-1" /> : <Monitor className="w-3 h-3 mr-1" />}
                                                {client.type.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-[11px]">
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 font-mono">{client.ip}</span>
                                                <span className="text-gray-300 font-mono mt-0.5">{client.mac}</span>
                                            </div>
                                            {client.rssi && (
                                                <span className={`font-black ${getSignalColor(client.rssi)}`}>{client.rssi} dBm</span>
                                            )}
                                        </div>
                                        <div className="flex items-center text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 w-fit">
                                            Gateway: {client.routerName}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
