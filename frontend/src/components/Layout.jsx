import { useState, useEffect } from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Router as RouterIcon, Settings, LogOut, ChevronRight, Menu } from 'lucide-react';
import api from '../api';

const Layout = () => {
    const { user, loading, logout } = useAuth();
    const location = useLocation();

    const [devices, setDevices] = useState([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        if (user) {
            api.get('/devices').then(res => setDevices(res.data)).catch(console.error);
        }
    }, [user]);

    // Close sidebar on navigation (mobile)
    useEffect(() => {
        setIsSidebarOpen(false);
    }, [location.pathname]);

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    const mainNavItems = [
        { name: 'Dashboard', path: '/', icon: LayoutDashboard },
        { name: 'Managed Devices', path: '/devices', icon: RouterIcon },
        { name: 'Settings', path: '/settings', icon: Settings },
    ];

    return (
        <div className="flex h-screen overflow-hidden bg-gray-50 text-gray-900">
            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200">
                    <span className="text-xl font-bold text-blue-600 tracking-tight">i<span className="text-gray-900">OpenWrt</span></span>
                    <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-gray-400 hover:text-gray-600">
                        <ChevronRight className="w-5 h-5 rotate-180" />
                    </button>
                </div>

                <nav className="flex-1 px-4 py-4 space-y-6 overflow-y-auto">
                    {/* Main Nav */}
                    <div className="space-y-1">
                        {mainNavItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.path;

                            return (
                                <Link
                                    key={item.name}
                                    to={item.path}
                                    className={`flex items-center px-3 py-2.5 rounded-md transition-colors ${isActive
                                        ? 'bg-blue-50 text-blue-700 font-medium'
                                        : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                                    {item.name}
                                </Link>
                            );
                        })}
                    </div>

                    {/* Devices Nav */}
                    <div>
                        <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">My Network</h3>
                        <div className="space-y-1">
                            {devices.map((device) => {
                                const path = `/devices/${device.id}`;
                                const isActive = location.pathname === path;

                                return (
                                    <Link
                                        key={device.id}
                                        to={path}
                                        className={`flex items-center px-3 py-2 rounded-md transition-colors ${isActive
                                            ? 'bg-gray-100 text-gray-900 font-medium'
                                            : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className={`w-2 h-2 rounded-full mr-3 ${device.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                        <span className="flex-1 truncate text-sm">{device.name}</span>
                                        <ChevronRight className={`w-4 h-4 ${isActive ? 'text-gray-400' : 'text-transparent'}`} />
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </nav>

                {/* Logout Button */}
                <div className="p-4 border-t border-gray-200">
                    <button
                        onClick={logout}
                        className="flex w-full items-center px-3 py-2.5 text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
                    >
                        <LogOut className="w-5 h-5 mr-3 text-gray-400" />
                        Sign out
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto w-full">
                <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-8 sticky top-0 z-30">
                    <div className="flex items-center">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="lg:hidden p-2 -ml-2 mr-3 text-gray-500 hover:text-gray-900"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-lg font-medium truncate">
                            {mainNavItems.find(i => i.path === location.pathname)?.name || 'Device Overview'}
                        </h2>
                    </div>
                    <div className="flex items-center text-sm font-medium text-blue-600 lg:hidden">
                        iOpenWrt
                    </div>
                </header>
                <div className="p-4 md:p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default Layout;
