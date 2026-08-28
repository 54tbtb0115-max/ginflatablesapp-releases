import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { User } from '../../shared/types';
import { api } from '../lib/api';

// 左侧图标导航栏，样式参考 Chatvia：桌面端 75px 竖排，移动端置底横排
export default function Sidebar({
    dark,
    onToggleDark,
    user,
    onLogout,
}: {
    dark: boolean;
    onToggleDark: () => void;
    user: User;
    onLogout: () => void;
}) {
    const [showPassword, setShowPassword] = useState(false);
    const tabClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center justify-center mx-auto h-14 w-14 my-1 rounded-lg text-2xl transition-colors ` +
        (isActive
            ? 'bg-violet-600/60 text-white'
            : 'text-violet-100 hover:bg-violet-600/40 hover:text-white');

    return (
        <nav className="w-full lg:w-[75px] shrink-0 bg-violet-500 shadow flex flex-row lg:flex-col items-center justify-between z-40">
            <div className="hidden lg:flex my-5 h-9 w-9 items-center justify-center rounded-lg bg-white/20 text-white">
                <i className="ri-brush-ai-line text-xl" aria-hidden />
            </div>

            <ul className="flex flex-row lg:flex-col justify-center w-full lg:my-auto">
                <li className="flex-grow lg:flex-grow-0">
                    <NavLink to="/" className={tabClass} title="聊天生图">
                        <i className="ri-message-3-line" aria-hidden />
                    </NavLink>
                </li>
                <li className="flex-grow lg:flex-grow-0">
                    <NavLink to="/gallery" className={tabClass} title="图库">
                        <i className="ri-image-2-line" aria-hidden />
                    </NavLink>
                </li>
                <li className="flex-grow lg:flex-grow-0">
                    <NavLink to="/keywords" className={tabClass} title="关键词统计">
                        <i className="ri-bar-chart-horizontal-line" aria-hidden />
                    </NavLink>
                </li>
            </ul>

            <div className="flex flex-row lg:flex-col items-center my-1 lg:my-4 gap-1">
                <button
                    onClick={onToggleDark}
                    className="flex items-center justify-center h-12 w-12 rounded-lg text-2xl text-violet-100 hover:text-white"
                    title={dark ? '切换到亮色' : '切换到暗色'}
                >
                    <i className={dark ? 'ri-sun-line' : 'ri-moon-clear-line'} aria-hidden />
                </button>
                <div
                    className="flex items-center justify-center h-9 w-9 rounded-full bg-white/25 text-white text-sm font-semibold"
                    title={`当前账号：${user.username}`}
                >
                    {user.username.slice(0, 1).toUpperCase()}
                </div>
                <button
                    onClick={() => setShowPassword(true)}
                    className="flex items-center justify-center h-12 w-12 rounded-lg text-xl text-violet-100 hover:text-white"
                    title="修改密码"
                >
                    <i className="ri-lock-password-line" aria-hidden />
                </button>
                <button
                    onClick={onLogout}
                    className="flex items-center justify-center h-12 w-12 rounded-lg text-xl text-violet-100 hover:text-white"
                    title="退出登录"
                >
                    <i className="ri-logout-box-r-line" aria-hidden />
                </button>
            </div>

            {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
        </nav>
    );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (newPassword !== confirm) {
            setError('两次输入的新密码不一致');
            return;
        }
        setBusy(true);
        try {
            await api.changePassword(oldPassword, newPassword);
            setDone(true);
            setTimeout(onClose, 1200);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const inputClass =
        'w-full rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 px-4 py-2.5 focus:ring-violet-500';

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <form
                onSubmit={submit}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-white dark:bg-zinc-800 rounded-lg shadow p-6 space-y-4"
            >
                <h6 className="text-gray-700 dark:text-gray-50">修改密码</h6>
                {done ? (
                    <p className="text-sm text-green-500">密码已修改 ✓</p>
                ) : (
                    <>
                        <input
                            type="password"
                            placeholder="旧密码"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            autoFocus
                            className={inputClass}
                        />
                        <input
                            type="password"
                            placeholder="新密码（至少 6 位）"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className={inputClass}
                        />
                        <input
                            type="password"
                            placeholder="再输一遍新密码"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            className={inputClass}
                        />
                        {error && <p className="text-sm text-red-500">{error}</p>}
                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-md bg-slate-100 dark:bg-zinc-600 text-gray-600 dark:text-gray-100 text-sm px-4 py-2"
                            >
                                取消
                            </button>
                            <button
                                type="submit"
                                disabled={busy || !oldPassword || !newPassword || !confirm}
                                className="rounded-md bg-violet-500 text-white text-sm px-4 py-2 hover:bg-violet-600 disabled:opacity-50"
                            >
                                {busy ? '提交中…' : '确认修改'}
                            </button>
                        </div>
                    </>
                )}
            </form>
        </div>
    );
}
