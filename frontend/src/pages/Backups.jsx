import { useState, useEffect } from 'react';
import { Archive, Download, RotateCcw, HardDrive, Server, Wifi, RefreshCcw } from 'lucide-react';
import api from '../api';

const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtDate = (iso) => new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const Backups = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    const load = async () => {
        try {
            const res = await api.get('/backups');
            setData(res.data);
        } catch (e) {
            setMsg({ type: 'error', text: 'Failed to load backups' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

    const runNow = async () => {
        setBusy(true);
        setMsg({ type: 'info', text: 'Backing up all devices…' });
        try {
            const res = await api.post('/backups/run');
            const ok = res.data.results.filter(r => r.ok).length;
            flash({ type: 'success', text: `Backup complete — ${ok}/${res.data.results.length} devices.` });
            await load();
        } catch (e) {
            flash({ type: 'error', text: 'Backup failed: ' + (e.response?.data?.message || e.message) });
        } finally {
            setBusy(false);
        }
    };

    const download = async (deviceId, file) => {
        try {
            const res = await api.get(`/backups/${deviceId}/${encodeURIComponent(file)}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            flash({ type: 'error', text: 'Download failed' });
        }
    };

    const restore = async (deviceId, file, name) => {
        if (!window.confirm(`Restore this backup to "${name}"?\n\nThe device will apply the saved config and REBOOT (brief outage).`)) return;
        try {
            await api.post(`/backups/${deviceId}/${encodeURIComponent(file)}/restore`);
            flash({ type: 'success', text: `${name} is restoring and rebooting…` });
        } catch (e) {
            flash({ type: 'error', text: 'Restore failed: ' + (e.response?.data?.error || e.message) });
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Loading backups…</div>;

    const totalBackups = data.reduce((s, d) => s + d.backups.length, 0);

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Backups</h1>
                    <p className="text-gray-500 text-sm mt-1">Automatic daily config backups of every unit, stored on the server</p>
                </div>
                <button onClick={runNow} disabled={busy}
                    className={`flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl font-bold transition-all shadow-lg w-full md:w-auto ${busy ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'}`}>
                    <RefreshCcw className={`w-5 h-5 ${busy ? 'animate-spin' : ''}`} />
                    <span>{busy ? 'Backing up…' : 'Back up all now'}</span>
                </button>
            </div>

            {msg && (
                <div className={`p-4 rounded-xl border text-sm font-medium ${msg.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : msg.type === 'error' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
                    {msg.text}
                </div>
            )}

            <div className="flex items-start space-x-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs text-slate-500">
                <HardDrive className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                <p>Backups run automatically every day and are kept on the controller (in the mapped <code className="font-mono">data</code> volume, so they survive container updates). The last 10 per device are retained. <strong>Download</strong> one to keep it off-box, or <strong>Restore</strong> to push a saved config back onto its device (it will reboot).</p>
            </div>

            {totalBackups === 0 && (
                <div className="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
                    No backups yet — click “Back up all now”.
                </div>
            )}

            <div className="space-y-4">
                {data.map(dev => (
                    <div key={dev.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 bg-gray-50/40">
                            <div className="flex items-center space-x-3">
                                {dev.is_gateway ? <Server className="w-5 h-5 text-blue-600" /> : <Wifi className="w-5 h-5 text-gray-400" />}
                                <div>
                                    <p className="font-bold text-gray-900 leading-none">{dev.name}</p>
                                    <p className="text-[11px] text-gray-400 font-mono mt-1">{dev.ip}{dev.is_gateway ? ' · gateway' : ''}</p>
                                </div>
                            </div>
                            <span className="text-[11px] font-bold text-gray-400">{dev.backups.length} backup{dev.backups.length !== 1 ? 's' : ''}</span>
                        </div>
                        {dev.backups.length === 0 ? (
                            <p className="px-5 py-4 text-xs text-gray-400 italic">No backups for this device yet.</p>
                        ) : (
                            <ul className="divide-y divide-gray-50">
                                {dev.backups.map(b => (
                                    <li key={b.file} className="flex items-center justify-between px-5 py-3 hover:bg-blue-50/20">
                                        <div className="flex items-center space-x-3 min-w-0">
                                            <Archive className="w-4 h-4 text-gray-300 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-sm text-gray-700 font-medium">{fmtDate(b.mtime)}</p>
                                                <p className="text-[10px] text-gray-400 font-mono">{fmtSize(b.size)}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2 shrink-0">
                                            <button onClick={() => download(dev.id, b.file)} title="Download"
                                                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition-colors">
                                                <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Download</span>
                                            </button>
                                            <button onClick={() => restore(dev.id, b.file, dev.name)} title="Restore to device (reboots)"
                                                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-100 transition-colors">
                                                <RotateCcw className="w-3.5 h-3.5" /><span className="hidden sm:inline">Restore</span>
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Backups;
