import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import GalleryPage from './pages/GalleryPage';

export default function App() {
    const [dark, setDark] = useState(() => localStorage.getItem('mode') === 'dark');

    useEffect(() => {
        document.documentElement.dataset.mode = dark ? 'dark' : 'light';
        localStorage.setItem('mode', dark ? 'dark' : 'light');
    }, [dark]);

    return (
        <div className="flex h-screen flex-col-reverse lg:flex-row overflow-hidden">
            <Sidebar dark={dark} onToggleDark={() => setDark((d) => !d)} />
            <div className="flex-1 min-h-0">
                <Routes>
                    <Route path="/" element={<ChatPage />} />
                    <Route path="/gallery" element={<GalleryPage />} />
                </Routes>
            </div>
        </div>
    );
}
