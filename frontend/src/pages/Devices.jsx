import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Router as RouterIcon } from 'lucide-react';
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
        username: 'root',
        auth_type: 'password',
        password: '',
        private_key: ''
    });

    const openForm = (device = null) => {
        if (device) {
            setEditId(device.id);
            setFormData({
                name: device.name,
                ip: device.ip,
                username: device.username || 'root',
                auth_type: device.auth_type || 'password',
                password: '', // Blank for security, only send if changing
                private_key: ''
            });
        } else {
            setEditId(null);
            setFormData({ name: '', ip: '', username: 'root', auth_type: 'password', password: '', private_key: '' });
        }
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditId(null);
        setFormData({ name: '', ip: '', username: 'root', auth_type: 'password', password: '', private_key: '' });
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

        // Remove empty password/key if editing so we don't overwrite with blanks
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

    if (loading) return <div>Loading devices...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-semibold text-gray-900">Network Devices</h1>
                <button
                    onClick={() => openForm()}
                    className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition"
                >
                    <Plus className="w-4 h-4 mr-2" /> Add Device
                </button>
            </div>

            {/* Add Form */}
            {showForm && (
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-lg font-medium mb-4">{editId ? 'Edit OpenWrt Device' : 'Add New OpenWrt Device'}</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Display Name</label>
                                <input required type="text" className="mt-1 w-full border border-gray-300 rounded-md p-2"
                                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">IP Address</label>
                                <input required type="text" className="mt-1 w-full border border-gray-300 rounded-md p-2"
                                    value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Username</label>
                                <input required type="text" className="mt-1 w-full border border-gray-300 rounded-md p-2"
                                    value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Auth Type</label>
                                <select className="mt-1 w-full border border-gray-300 rounded-md p-2"
                                    value={formData.auth_type} onChange={e => setFormData({ ...formData, auth_type: e.target.value })}>
                                    <option value="password">Password</option>
                                    <option value="key">SSH Key</option>
                                </select>
                            </div>
                        </div>

                        {formData.auth_type === 'password' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    SSH Password {editId && <span className="text-gray-400 font-normal">(Leave blank to keep unchanged)</span>}
                                </label>
                                <input required={!editId} type="password" className="mt-1 w-full border border-gray-300 rounded-md p-2"
                                    value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    Private SSH Key {editId && <span className="text-gray-400 font-normal">(Leave blank to keep unchanged)</span>}
                                </label>
                                <textarea required={!editId} rows="4" className="mt-1 w-full border border-gray-300 rounded-md p-2 font-mono text-sm"
                                    value={formData.private_key} onChange={e => setFormData({ ...formData, private_key: e.target.value })} />
                            </div>
                        )}

                        <div className="flex justify-end space-x-3 pt-4 border-t">
                            <button type="button" onClick={closeForm} className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Device</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Device List */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Device</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Auth</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {devices.map((device) => (
                            <tr key={device.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <RouterIcon className="w-5 h-5 text-gray-400 mr-3" />
                                        <div className="text-sm font-medium text-gray-900">{device.name}</div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{device.ip}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${device.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                        }`}>
                                        {device.status.toUpperCase()}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{device.auth_type}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => openForm(device)} className="text-blue-600 hover:text-blue-900 mr-4">
                                        <Edit2 className="w-4 h-4 inline" />
                                    </button>
                                    <button onClick={() => handleDelete(device.id)} className="text-red-600 hover:text-red-900">
                                        <Trash2 className="w-4 h-4 inline" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {devices.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                    No devices manage yet. Click "Add Device" to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

        </div>
    );
};

export default Devices;
