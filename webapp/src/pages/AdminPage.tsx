import { useEffect, useState } from 'react';
import type { AdminStats } from '../../shared/types';
import { api } from '../lib/api';

function toDateInput(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const money = (n: number) => `$${n.toFixed(2)}`;

// 管理员统计页：按日期范围统计生成量、花费、类型、每用户明细
export default function AdminPage() {
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
    const [from, setFrom] = useState(toDateInput(monthAgo));
    const [to, setTo] = useState(toDateInput(today));
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = () => {
        setLoading(true);
        setError(null);
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
                <p className="text-xs text-gray-400 mt-0.5">按日期范围统计本站的图片生成量与花费（仅管理员可见）</p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6 pb-[90px] lg:pb-6">
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
                        {/* 关键指标卡片 */}
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
                            <Kpi label="生成总数" value={`${stats.total}`} accent />
                            <Kpi label="预估花费" value={money(stats.totalCost)} />
                            <Kpi label="活跃用户" value={`${stats.activeUsers}`} />
                            <Kpi label="日均生成" value={`${stats.avgPerDay}`} />
                            <Kpi label="失败/停止" value={`${stats.failed}`} />
                            <Kpi
                                label="成功率"
                                value={`${
                                    stats.total + stats.failed > 0
                                        ? Math.round((stats.total / (stats.total + stats.failed)) * 100)
                                        : 100
                                }%`}
                            />
                        </div>

                        {/* 生成类型 */}
                        <div className="grid grid-cols-3 gap-3 mb-6">
                            <TypeCard label="文生图" value={stats.byType.textToImage} icon="ri-text" />
                            <TypeCard label="图生图" value={stats.byType.imageToImage} icon="ri-image-edit-line" />
                            <TypeCard label="高清重生成" value={stats.byType.hd} icon="ri-hd-line" />
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2 items-start">
                            {/* 按模型（含花费） */}
                            <section className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4">
                                <h6 className="text-gray-700 dark:text-gray-50 mb-3">按模型</h6>
                                {stats.byModel.length === 0 && <p className="text-sm text-gray-400">无数据</p>}
                                <ul className="space-y-2">
                                    {stats.byModel.map((m) => (
                                        <li key={m.model} className="flex items-center justify-between text-sm gap-3">
                                            <span className="text-gray-600 dark:text-gray-100 truncate" title={m.model}>
                                                {m.model}
                                            </span>
                                            <span className="text-gray-500 dark:text-gray-200 shrink-0">
                                                {m.count} 张 · {money(m.cost)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            {/* 按用户（可展开明细） */}
                            <section className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4">
                                <h6 className="text-gray-700 dark:text-gray-50 mb-3">按用户（点击展开明细）</h6>
                                {stats.byUser.length === 0 && <p className="text-sm text-gray-400">无数据</p>}
                                <ul className="space-y-1">
                                    {stats.byUser.map((u) => (
                                        <li key={u.username}>
                                            <button
                                                onClick={() => setExpanded(expanded === u.username ? null : u.username)}
                                                className="w-full flex items-center justify-between text-sm py-1.5 hover:text-violet-500"
                                            >
                                                <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-100">
                                                    <i
                                                        className={`ri-arrow-right-s-line transition-transform ${
                                                            expanded === u.username ? 'rotate-90' : ''
                                                        }`}
                                                        aria-hidden
                                                    />
                                                    {u.username}
                                                </span>
                                                <span className="text-gray-500 dark:text-gray-200">
                                                    {u.count} 张 · {money(u.cost)}
                                                </span>
                                            </button>
                                            {expanded === u.username && (
                                                <div className="ml-5 mb-2 rounded-md bg-white dark:bg-zinc-600 p-2.5 text-xs text-gray-500 dark:text-gray-200 space-y-1">
                                                    {u.models.map((m) => (
                                                        <div key={m.model} className="flex justify-between gap-2">
                                                            <span className="truncate">{m.model}</span>
                                                            <span className="shrink-0">{m.count} 张</span>
                                                        </div>
                                                    ))}
                                                    <div className="pt-1 border-t border-slate-100 dark:border-zinc-500 text-gray-400">
                                                        最近生成：{new Date(u.lastUsed).toLocaleString('zh-CN')}
                                                    </div>
                                                </div>
                                            )}
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

                        <p className="text-xs text-gray-400 mt-6">
                            花费为按模型单价的估算值（gpt-image-2 $0.036/张、gemini flash $0.023/张），
                            实际以 Aiberm 账单为准。
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className={`rounded-lg px-4 py-3 ${accent ? 'bg-violet-500/10' : 'bg-slate-50 dark:bg-zinc-700'}`}>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-xl font-semibold ${accent ? 'text-violet-500' : 'text-gray-700 dark:text-gray-50'}`}>
                {value}
            </p>
        </div>
    );
}

function TypeCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-lg bg-slate-50 dark:bg-zinc-700 px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-violet-500/15 text-violet-500 flex items-center justify-center">
                <i className={`${icon} text-lg`} aria-hidden />
            </div>
            <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-lg font-semibold text-gray-700 dark:text-gray-50">{value} 张</p>
            </div>
        </div>
    );
}
