import { useState } from 'react';
import type { User } from '../../shared/types';
import { api } from '../lib/api';

// 登录页：账号由管理员创建分发，不开放注册
export default function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError(null);
        setBusy(true);
        try {
            const { user } = await api.login(username, password);
            onLogin(user);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-900 px-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500 text-white mb-4">
                        <i className="ri-brush-ai-line text-2xl" aria-hidden />
                    </div>
                    <h4 className="text-gray-700 dark:text-gray-50">AI 画室</h4>
                    <p className="text-sm text-gray-400 mt-1">登录后开始创作，账号由管理员分配</p>
                </div>

                <form onSubmit={submit} className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 space-y-4">
                    <div>
                        <label className="block text-sm text-gray-500 dark:text-gray-200 mb-1.5">用户名</label>
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoFocus
                            autoComplete="username"
                            className="w-full rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 px-4 py-2.5 focus:ring-violet-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-500 dark:text-gray-200 mb-1.5">密码</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            className="w-full rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 px-4 py-2.5 focus:ring-violet-500"
                        />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <button
                        type="submit"
                        disabled={busy || !username || !password}
                        className="w-full rounded-md bg-violet-500 text-white py-2.5 hover:bg-violet-600 disabled:opacity-50"
                    >
                        {busy ? '登录中…' : '登录'}
                    </button>
                </form>
            </div>
        </div>
    );
}
