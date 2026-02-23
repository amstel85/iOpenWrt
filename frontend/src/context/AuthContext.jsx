import { createContext, useState, useEffect, useContext } from 'react';
import api from '../api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Simple token check on load
        const token = localStorage.getItem('iopenwrt_token');
        if (token) {
            // we could verify token with backend, but for now we trust it
            // if an API call fails with 401 later, we will logout
            setUser({ token });
        }
        setLoading(false);
    }, []);

    const login = async (username, password) => {
        const response = await api.post('/auth/login', { username, password });
        if (response.data && response.data.token) {
            localStorage.setItem('iopenwrt_token', response.data.token);
            setUser({ token: response.data.token });
            return true;
        }
        return false;
    };

    const logout = () => {
        localStorage.removeItem('iopenwrt_token');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
