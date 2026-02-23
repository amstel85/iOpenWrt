import { Server, Users, Wifi, Monitor } from 'lucide-react';

const TopologyMap = ({ devices }) => {
    // Collect all clients and group them by router
    const routers = devices.map(d => {
        let clients = [];
        try {
            clients = d.clients_json ? JSON.parse(d.clients_json) : [];
        } catch (e) {
            console.error(e);
        }
        return { ...d, clients };
    });

    return (
        <div className="p-8 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 min-h-[400px]">
            <div className="flex flex-col items-center space-y-12">
                {/* Gateway / Internet Placeholder */}
                <div className="flex flex-col items-center">
                    <div className="p-4 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-blue-500 text-white rounded-lg">
                            <Server className="w-6 h-6" />
                        </div>
                        <span className="font-bold text-gray-900">Network Core</span>
                    </div>
                    <div className="w-px h-8 bg-gray-300"></div>
                </div>

                {/* Routers Row */}
                <div className="flex flex-wrap justify-center gap-12">
                    {routers.map(router => (
                        <div key={router.id} className="flex flex-col items-center">
                            <div className={`p-5 rounded-2xl shadow-sm border-2 transition-all ${router.status === 'online' ? 'bg-white border-emerald-100 shadow-md' : 'bg-gray-100 border-gray-200 grayscale'
                                }`}>
                                <div className="flex flex-col items-center">
                                    <Server className={`w-8 h-8 mb-2 ${router.status === 'online' ? 'text-emerald-500' : 'text-gray-400'}`} />
                                    <span className="font-bold text-gray-900 text-sm">{router.name}</span>
                                    <span className="text-[10px] text-gray-400 font-mono tracking-tighter">{router.ip}</span>
                                </div>
                            </div>

                            {/* Connector to clients */}
                            {router.clients && router.clients.length > 0 && router.status === 'online' && (
                                <>
                                    <div className="w-px h-8 bg-gray-200"></div>
                                    <div className="grid grid-cols-3 gap-2 mt-0">
                                        {router.clients.slice(0, 6).map((client, idx) => (
                                            <div key={idx} className="flex flex-col items-center group relative" title={client.name}>
                                                <div className={`p-1.5 rounded-lg border-2 ${client.type === 'wireless' ? 'bg-blue-50 border-blue-100 text-blue-500' : 'bg-slate-50 border-slate-100 text-slate-500'
                                                    }`}>
                                                    {client.type === 'wireless' ? <Wifi className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                                                </div>
                                                <span className="absolute -bottom-4 text-[8px] font-bold text-gray-400 hidden group-hover:block whitespace-nowrap bg-white px-1 shadow-sm rounded">
                                                    {client.name}
                                                </span>
                                            </div>
                                        ))}
                                        {router.clients.length > 6 && (
                                            <div className="flex items-center justify-center text-[10px] font-black text-gray-400">
                                                +{router.clients.length - 6}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TopologyMap;
