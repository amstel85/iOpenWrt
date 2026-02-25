import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Router as RouterIcon, AlertCircle } from 'lucide-react';
import api from '../api';

const Devices = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);

    // Form State
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        ip: '',
        port: 22,
        username: 'root',
        auth_type: 'password',
        password: '',
        private_key: '',
        is_gateway: false
    });

    const openForm = (device = null) => {
        if (device) {
            setEditId(device.id);
            setFormData({
                name: device.name,
                ip: device.ip,
                port: device.port || 22,
                username: device.username || 'root',
                auth_type: device.auth_type || 'password',
                password: '',
                private_key: '',
                is_gateway: !!device.is_gateway
            });
        } else {
            setEditId(null);
            setFormData({ name: '', ip: '', port: 22, username: 'root', auth_type: 'password', password: '', private_key: '', is_gateway: false });
        }
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditId(null);
        setFormData({ name: '', ip: '', port: 22, username: 'root', auth_type: 'password', password: '', private_key: '', is_gateway: false });
    };

    useEffect(() => {
        fetchDevices();
    }, []);

    const fetchDevices = async () => {
        try {
            const res = await api.get('/devices');
            setDevices(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to remove this device?')) return;
        try {
            await api.delete(`/devices/${id}`);
            fetchDevices();
        } catch (err) {
            console.error(err);
            alert('Failed to delete device');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = { ...formData };
        if (editId) {
            if (payload.auth_type === 'password' && !payload.password) delete payload.password;
            if (payload.auth_type === 'key' && !payload.private_key) delete payload.private_key;
        }

        try {
            if (editId) {
                await api.put(`/devices/${editId}`, payload);
            } else {
                await api.post('/devices', payload);
            }
            closeForm();
            fetchDevices();
        } catch (err) {
            console.error(err);
            alert(err.response?.data?.error || 'Failed to save device');
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Loading infrastructure...</div>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Network Infrastructure</h1>
                    <p className="text-xs text-gray-400 mt-1 max-w-md italic">
                        Node IPs and names are automatically discovered via local network visibility and reverse DNS lookups.
                    </p>
                </div>
                <button onClick={() => openForm()} className="flex items-center justify-center bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-100 w-full md:w-auto">
                    <Plus className="w-5 h-5 mr-2" /> Add New Node
                </button>
            </div>

            {showForm && (
                <div className="bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-top-4 duration-300">
                    <h3 className="text-xl font-bold mb-6 text-gray-900">{editId ? 'Edit Infrastructure Node' : 'Register New Node'}</h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                            <div className="md:col-span-1">
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Node Name</label>
                                <input required type="text" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all"
                                    placeholder="e.g. Living Room Router"
                                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">IP Address</label>
                                <input required type="text" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all"
                                    placeholder="192.168.1.1"
                                    value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">SSH Port</label>
                                <input required type="number" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all"
                                    value={formData.port} onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">SSH Username</label>
                                <input required type="text" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all"
                                    value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Authentication Policy</label>
                                <select className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all appearance-none"
                                    value={formData.auth_type} onChange={e => setFormData({ ...formData, auth_type: e.target.value })}>
                                    <option value="password">Standard Password</option>
                                    <option value="key">Encrypted SSH Key</option>
                                </select>
                            </div>
                        </div>

                        {formData.auth_type === 'password' ? (
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                    SSH Password {editId && <span className="text-gray-300 font-normal normal-case ml-1">(Optional / Keep existing)</span>}
                                </label>
                                <input required={!editId} type="password" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all"
                                    value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                    Private SSH Key {editId && <span className="text-gray-300 font-normal normal-case ml-1">(Optional / Keep existing)</span>}
                                </label>
                                <textarea required={!editId} rows="4" className="w-full bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 outline-none transition-all font-mono text-xs"
                                    value={formData.private_key} onChange={e => setFormData({ ...formData, private_key: e.target.value })} />
                            </div>
                        )}

                        <div>
                            <label className="flex items-center space-x-3 cursor-pointer mt-6 p-4 bg-gray-50 rounded-xl border-2 border-transparent hover:border-blue-100 transition-all">
                                <input type="checkbox" className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={formData.is_gateway} onChange={e => setFormData({ ...formData, is_gateway: e.target.checked })} />
                                <span className="text-sm font-bold text-gray-700">Set as Primary Gateway / DHCP Source</span>
                            </label>
                        </div>

                        <div className="flex flex-col md:flex-row md:justify-end space-y-3 md:space-y-0 md:space-x-4 pt-6 border-t border-gray-50">
                            <button type="button" onClick={closeForm} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition">Cancel</button>
                            <button type="submit" className="px-8 py-2.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition shadow-lg shadow-gray-200">{editId ? 'Update Node' : 'Initialize Node'}</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-100 text-left">
                    <thead className="bg-gray-50/50">
                        <tr>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Infastructure Unit</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Network Access</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Type</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">Security Policy</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Management</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-50">
                        {devices.map((device) => (
                            <tr key={device.id} className="hover:bg-gray-50/50 transition-colors group">
                                <td className="px-6 py-5 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="p-2 rounded-lg bg-gray-100 text-gray-500 mr-3 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                            <RouterIcon className="w-5 h-5" />
                                        </div>
                                        <div className="text-sm font-bold text-gray-900">{device.name}</div>
                                    </div>
                                </td>
                                <td className="px-6 py-5 whitespace-nowrap">
                                    <span className="text-sm font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded-md">{device.ip}:{device.port || 22}</span>
                                </td>
                                <td className="px-6 py-5 whitespace-nowrap">
                                    <div className="flex flex-col">
                                        <span className={`px-2.5 py-1 text-[10px] font-black tracking-widest rounded-lg border shadow-sm w-fit ${device.status === 'online' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                            {device.status.toUpperCase()}
                                        </span>
                                        {device.last_error && device.status === 'offline' && (
                                            <div className="flex items-center text-red-400 mt-1 space-x-1 group/err relative">
                                                <AlertCircle className="w-3 h-3" />
                                                <span className="text-[9px] font-medium truncate max-w-[120px]">Error details</span>
                                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover/err:block bg-gray-900 text-white text-[10px] p-2 rounded shadow-xl whitespace-normal w-48 z-50">
                                                    {device.last_error}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-5 whitespace-nowrap">
                                    {device.is_gateway ? (
                                        <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 uppercase tracking-wider">Gateway</span>
                                    ) : (
                                        <span className="text-[10px] font-bold text-gray-400 uppercase">Access Point</span>
                                    )}
                                </td>
                                <td className="px-6 py-5 whitespace-nowrap">
                                    <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg border border-gray-100">{device.auth_type.toUpperCase()}</span>
                                </td>
                                <td className="px-6 py-5 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                    <button onClick={() => openForm(device)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                                    <button onClick={() => handleDelete(device.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="md:hidden space-y-4">
                {devices.map((device) => (
                    <div key={device.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center">
                                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 mr-3">
                                    <RouterIcon className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900">{device.name}</h3>
                                    <p className="text-[11px] font-mono text-gray-400">{device.ip}:{device.port || 22}</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end space-y-2">
                                <span className={`px-2 py-0.5 text-[9px] font-black tracking-widest rounded-lg border shadow-sm ${device.status === 'online' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                    {device.status.toUpperCase()}
                                </span>
                            </div>
                        </div>
                        {device.last_error && device.status === 'offline' && (
                            <div className="bg-red-50 p-3 rounded-xl border border-red-100 flex items-start space-x-2">
                                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                                <span className="text-[10px] text-red-600 font-medium">{device.last_error}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-3 border-t border-gray-50">
                            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg border border-gray-100">{device.auth_type.toUpperCase()} AUTH</span>
                            <div className="flex space-x-2">
                                <button onClick={() => openForm(device)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-xl transition"><Edit2 className="w-4 h-4" /></button>
                                <button onClick={() => handleDelete(device.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition"><Trash2 className="w-4 h-4" /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {devices.length === 0 && (
                <div className="bg-white rounded-3xl p-12 text-center border-2 border-dashed border-gray-100">
                    <RouterIcon className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-gray-400 font-medium">No infrastructure nodes registered yet.</p>
                </div>
            )}
        </div>
    );
};

export default Devices;
