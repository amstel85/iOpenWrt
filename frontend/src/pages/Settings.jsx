import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, RefreshCcw, Bell, ShieldCheck, Database } from 'lucide-react';
import api from '../api';

const Settings = () => {
    const [config, setConfig] = useState({
        sync_interval: 30,
        mesh_audit: true,
        notify_new_devices: false
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    // Load from localStorage for now (frontend-only settings)
    useEffect(() => {
        const saved = localStorage.getItem('io_config');
        if (saved) {
            try {
                setConfig(JSON.parse(saved));
            } catch (e) { console.error(e); }
        }
    }, []);

    const handleSave = () => {
        setSaving(true);
        localStorage.setItem('io_config', JSON.stringify(config));
        setTimeout(() => {
            setSaving(false);
            setMessage({ type: 'success', text: 'Settings saved successfully!' });
            setTimeout(() => setMessage(null), 3000);
        }, 500);
    };

    const refreshOUI = async () => {
        setMessage({ type: 'info', text: 'Updating OUI Database...' });
        // Simulating OUI update for now
        setTimeout(() => {
            setMessage({ type: 'success', text: 'OUI Database updated!' });
            setTimeout(() => setMessage(null), 3000);
        }, 2000);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Controller Settings</h1>
                    <p className="text-gray-500 text-sm mt-1">Configure global behavior and system maintenance</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-200 disabled:opacity-50 w-full md:w-auto"
                >
                    {saving ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
                </button>
            </div>

            {message && (
                <div className={`p-4 rounded-xl border animate-in fade-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700'
                    }`}>
                    <p className="font-bold flex items-center text-sm md:text-base">
                        <ShieldCheck className="w-5 h-5 mr-2" />
                        {message.text}
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                {/* Network Polling */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 space-y-6">
                    <div className="flex items-center space-x-3 text-gray-900 border-b border-gray-50 pb-4">
                        <RefreshCcw className="w-6 h-6 text-blue-500" />
                        <h2 className="text-lg md:text-xl font-black">Sync & Polling</h2>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Global Sync Interval (Seconds)</label>
                            <input
                                type="number"
                                min="10"
                                max="300"
                                value={config.sync_interval}
                                onChange={(e) => setConfig({ ...config, sync_interval: parseInt(e.target.value) })}
                                className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 font-mono focus:border-blue-500 focus:outline-none transition-colors"
                            />
                            <p className="text-[10px] text-gray-400 mt-2 font-medium italic">High frequency (10s) increases SSH load on routers.</p>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                            <div className="pr-4">
                                <p className="font-bold text-gray-900 leading-none text-sm md:text-base">Mesh Consistency Audit</p>
                                <p className="text-[9px] md:text-[10px] text-blue-600 font-bold uppercase mt-1">Experimental</p>
                            </div>
                            <button
                                onClick={() => setConfig({ ...config, mesh_audit: !config.mesh_audit })}
                                className={`w-12 h-6 shrink-0 rounded-full transition-all relative ${config.mesh_audit ? 'bg-blue-600' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.mesh_audit ? 'right-1' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Automation & Alerts */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 space-y-6">
                    <div className="flex items-center space-x-3 text-gray-900 border-b border-gray-50 pb-4">
                        <Bell className="w-6 h-6 text-purple-500" />
                        <h2 className="text-lg md:text-xl font-black">Alerts & Notifications</h2>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-purple-50/50 rounded-2xl border border-purple-100 opacity-50 cursor-not-allowed">
                            <div className="pr-4">
                                <p className="font-bold text-gray-900 leading-none text-sm md:text-base">Telegram Bot Alerts</p>
                                <p className="text-[9px] md:text-[10px] text-purple-600 font-bold uppercase mt-1">Requires API Token</p>
                            </div>
                            <SettingsIcon className="w-5 h-5 text-purple-400 shrink-0" />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="pr-4">
                                <p className="font-bold text-gray-900 leading-none text-sm md:text-base">Notify on New Device</p>
                                <p className="text-[9px] md:text-[10px] text-gray-400 font-medium mt-1">Browser Notification</p>
                            </div>
                            <button
                                onClick={() => setConfig({ ...config, notify_new_devices: !config.notify_new_devices })}
                                className={`w-12 h-6 shrink-0 rounded-full transition-all relative ${config.notify_new_devices ? 'bg-emerald-500' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.notify_new_devices ? 'right-1' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* System Maintenance */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 col-span-1 md:col-span-2 space-y-6">
                    <div className="flex items-center space-x-3 text-gray-900 border-b border-gray-50 pb-4">
                        <Database className="w-6 h-6 text-emerald-500" />
                        <h2 className="text-lg md:text-xl font-black">Maintenance & Data</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={refreshOUI}
                            className="flex items-center justify-center space-x-3 p-5 md:p-6 bg-slate-50 hover:bg-slate-100 border-2 border-slate-100 rounded-2xl transition-all group"
                        >
                            <RefreshCcw className="w-6 h-6 text-slate-400 group-hover:rotate-180 transition-transform duration-700 shrink-0" />
                            <div className="text-left">
                                <p className="font-bold text-slate-700 text-sm md:text-base">Re-index Manufacturers</p>
                                <p className="text-[10px] text-slate-400 font-medium">Update OUI Database</p>
                            </div>
                        </button>

                        <button className="flex items-center justify-center space-x-3 p-5 md:p-6 bg-red-50 hover:bg-red-100 border-2 border-red-100 rounded-2xl transition-all group">
                            <Database className="w-6 h-6 text-red-400 shrink-0" />
                            <div className="text-left">
                                <p className="font-bold text-red-700 text-sm md:text-base">Clear Lease History</p>
                                <p className="text-[10px] text-red-400 font-medium">Reset client name mapping</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
