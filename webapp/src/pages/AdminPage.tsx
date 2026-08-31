import { useEffect, useState } from 'react';
import type { AdminStats } from '../../shared/types';
import { api } from '../lib/api';

// 把 Date 转成 <input type="date"> 用的 yyyy-mm-dd（本地时区）
function toDateInput(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 管理员统计页：按日期范围统计生成量（总数 / 按模型 / 按用户 / 按天）
export default function AdminPage() {
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
    const [from, setFrom] = useState(toDateInput(monthAgo));
    const [to, setTo] = useState(toDateInput(today));
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const load = () => {
        setLoading(true);
        setError(null);
        // from 当天 00:00，to 当天 23:59:59
        const fromMs = new Date(`${from}T00:00:00`).getTime();
        const toMs = new Date(`${to}T23:59:59`).getTime();
        api.adminStats(fromMs, toMs)
            .then(setStats)
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const maxDay = Math.max(1, ...(stats?.byDay.map((d) => d.count) ?? [1]));

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-800">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-600">
                <h5 className="text-gray-700 dark:text-gray-50">数据统计</h5>
                <p className="text-xs text-gray-400 mt-0.5">按日期范围统计本站的图片生成量（仅管理员可见）</p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6 pb-[90px] lg:pb-6">
                {/* 日期范围 */}
                <div className="flex flex-wrap items-center gap-2 mb-6">
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 text-sm px-3 py-2 focus:ring-violet-500"
                    />
                    <span className="text-gray-400">~</span>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 text-sm px-3 py-2 focus:ring-violet-500"
                    />
                    <button
                        onClick={load}
                        disabled={loading}
                        className="rounded-md bg-violet-500 text-white text-sm px-5 py-2 hover:bg-violet-600 disabled:opacity-50"
                    >
                        {loading ? '查询中…' : '查询'}
                    </button>
                </div>

                {error && <p className="text-sm text-red-500 my-4">{error}</p>}

                {stats && (
                    <>
                        {/* 总数 */}
                        <div className="mb-6 rounded-lg bg-violet-500/10 px-5 py-4 inline-block">
                            <p className="text-xs text-gray-400 mb-1">这段时间共生成</p>
                            <p className="text-2xl font-semibold text-violet-500">{stats.total} 张</p>
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2 items-start">
                            {/* 按模型 */}
                            <section className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4">
                                <h6 className="text-gray-700 dark:text-gray-50 mb-3">按模型</h6>
                                {stats.byModel.length === 0 && <p className="text-sm text-gray-400">无数据</p>}
                                <ul className="space-y-2">
                                    {stats.byModel.map((m) => (
                                        <li key={m.model} className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-100 truncate mr-3" title={m.model}>
                                                {m.model}
                                            </span>
                                            <span className="text-gray-500 dark:text-gray-200 shrink-0">{m.count} 张</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            {/* 按用户 */}
                            <section className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4">
                                <h6 className="text-gray-700 dark:text-gray-50 mb-3">按用户</h6>
                                {stats.byUser.length === 0 && <p className="text-sm text-gray-400">无数据</p>}
                                <ul className="space-y-2">
                                    {stats.byUser.map((u) => (
                                        <li key={u.username} className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-100 truncate mr-3">{u.username}</span>
                                            <span className="text-gray-500 dark:text-gray-200 shrink-0">{u.count} 张</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            {/* 按天 */}
                            <section className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4 lg:col-span-2">
                                <h6 className="text-gray-700 dark:text-gray-50 mb-3">按天</h6>
                                {stats.byDay.length === 0 && <p className="text-sm text-gray-400">无数据</p>}
                                <ul className="space-y-2">
                                    {stats.byDay.map((d) => (
                                        <li key={d.day} className="flex items-center gap-3 text-sm">
                                            <span className="w-24 shrink-0 text-gray-500 dark:text-gray-300">{d.day}</span>
                                            <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-zinc-600 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-violet-500"
                                                    style={{ width: `${Math.max((d.count / maxDay) * 100, 4)}%` }}
                                                />
                                            </div>
                                            <span className="w-10 shrink-0 text-right text-gray-500 dark:text-gray-200">
                                                {d.count}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
