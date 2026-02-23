import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Devices from './pages/Devices';
import DeviceDashboard from './pages/DeviceDashboard';

import Dashboard from './pages/Dashboard';

// Placeholder Settings component
const Settings = () => (
    <div className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center text-gray-500">
        <h2 className="text-xl font-medium text-gray-900 mb-2">Controller Settings</h2>
        <p>Global configurations and admin settings will appear here.</p>
    </div>
);

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/" element={<Layout />}>
                        <Route index element={<Dashboard />} />
                        <Route path="devices" element={<Devices />} />
                        <Route path="devices/:id" element={<DeviceDashboard />} />
                        <Route path="settings" element={<Settings />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
