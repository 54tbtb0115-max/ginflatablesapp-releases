import { useEffect, useMemo, useState } from 'react';
import type { KeywordStat } from '../../shared/types';
import { api } from '../lib/api';

const GROUP_ORDER = ['场景', '主体', '风格', '光线', '构图'];

// 关键词统计：所有用户勾选过的关键词按使用次数排行，用于整理高频词
export default function KeywordsPage() {
    const [stats, setStats] = useState<KeywordStat[]>([]);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        api.keywordStats()
            .then((r) => {
                setStats(r.stats);
                setTotal(r.total);
            })
            .catch((e) => setError(e.message));
    }, []);

    const groups = useMemo(() => {
        const filtered = filter ? stats.filter((s) => s.word.includes(filter)) : stats;
        const byGroup = new Map<string, KeywordStat[]>();
        for (const s of filtered) {
            const list = byGroup.get(s.group) ?? [];
            list.push(s);
            byGroup.set(s.group, list);
        }
        return [...byGroup.entries()].sort(
            ([a], [b]) =>
                (GROUP_ORDER.indexOf(a) + 1 || GROUP_ORDER.length + 1) -
                (GROUP_ORDER.indexOf(b) + 1 || GROUP_ORDER.length + 1)
        );
    }, [stats, filter]);

    const maxCount = stats[0]?.count ?? 1;

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-800">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-600 flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <h5 className="text-gray-700 dark:text-gray-50">关键词统计</h5>
                    <p className="text-xs text-gray-400 mt-0.5">
                        所有用户生成图片时选中的关键词，累计 {total} 次使用
                    </p>
                </div>
                <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="搜索关键词…"
                    className="rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 text-sm px-3 py-2 focus:ring-violet-500"
                />
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6 pb-[90px] lg:pb-6">
                {error && <p className="text-center text-sm text-red-500 my-4">{error}</p>}
                {!error && stats.length === 0 && (
                    <p className="text-center text-sm text-gray-400 my-12">
                        还没有记录。通过关键词卡片生成图片后，这里会统计每个词的使用次数。
                    </p>
                )}

                <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3 items-start">
                    {groups.map(([group, list]) => (
                        <section key={group} className="rounded-lg bg-slate-50 dark:bg-zinc-700 p-4">
                            <h6 className="text-gray-700 dark:text-gray-50 mb-3">
                                {group}
                                <span className="ml-2 text-xs font-normal text-gray-400">{list.length} 个词</span>
                            </h6>
                            <ul className="space-y-2">
                                {list.map((s) => (
                                    <li key={s.word} className="flex items-center gap-3">
                                        <span className="w-32 shrink-0 truncate text-sm text-gray-600 dark:text-gray-100" title={s.word}>
                                            {s.word}
                                        </span>
                                        <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-zinc-600 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-violet-500"
                                                style={{ width: `${Math.max((s.count / maxCount) * 100, 4)}%` }}
                                            />
                                        </div>
                                        <span className="w-10 shrink-0 text-right text-sm text-gray-500 dark:text-gray-200">
                                            {s.count}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
