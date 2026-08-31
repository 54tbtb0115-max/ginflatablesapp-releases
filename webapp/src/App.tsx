import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { User } from '../shared/types';
import Sidebar from './components/Sidebar';
import { api } from './lib/api';
import AdminPage from './pages/AdminPage';
import ChatPage from './pages/ChatPage';
import GalleryPage from './pages/GalleryPage';
import KeywordsPage from './pages/KeywordsPage';
import LoginPage from './pages/LoginPage';

export default function App() {
    const [dark, setDark] = useState(() => localStorage.getItem('mode') === 'dark');
    // undefined = 正在检查登录态；null = 未登录
    const [user, setUser] = useState<User | null | undefined>(undefined);

    useEffect(() => {
        document.documentElement.dataset.mode = dark ? 'dark' : 'light';
        localStorage.setItem('mode', dark ? 'dark' : 'light');
    }, [dark]);

    useEffect(() => {
        api.me()
            .then(({ user }) => setUser(user))
            .catch(() => setUser(null));
    }, []);

    const logout = async () => {
        try {
            await api.logout();
        } finally {
            setUser(null);
        }
    };

    if (user === undefined) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-900 text-gray-400">
                <i className="ri-loader-4-line animate-spin text-2xl text-violet-500" aria-hidden />
            </div>
        );
    }

    if (!user) return <LoginPage onLogin={setUser} />;

    return (
        <div className="flex h-screen flex-col-reverse lg:flex-row overflow-hidden">
            <Sidebar dark={dark} onToggleDark={() => setDark((d) => !d)} user={user} onLogout={logout} />
            <div className="flex-1 min-h-0">
                <Routes>
                    <Route path="/" element={<ChatPage />} />
                    <Route path="/gallery" element={<GalleryPage />} />
                    <Route path="/keywords" element={<KeywordsPage />} />
                    {user.isAdmin && <Route path="/admin" element={<AdminPage />} />}
                </Routes>
            </div>
        </div>
    );
}
