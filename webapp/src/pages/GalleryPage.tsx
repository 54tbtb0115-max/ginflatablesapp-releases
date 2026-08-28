import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GalleryImage } from '../../shared/types';
import { imageUrl } from '../../shared/types';
import { api } from '../lib/api';

// 图库：所有用户生成的所有图片，瀑布流 + 游标分页
export default function GalleryPage() {
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewing, setViewing] = useState<GalleryImage | null>(null);
    const navigate = useNavigate();

    const load = (nextCursor?: number) => {
        setLoading(true);
        api.gallery(nextCursor)
            .then((page) => {
                setImages((prev) => (nextCursor ? [...prev, ...page.images] : page.images));
                setCursor(page.nextCursor);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => load(), []);

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-800">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-600">
                <h5 className="text-gray-700 dark:text-gray-50">图库</h5>
                <p className="text-xs text-gray-400 mt-0.5">所有用户生成的图片都汇集在这里</p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6 pb-[90px] lg:pb-6">
                {error && <p className="text-center text-sm text-red-500 my-4">{error}</p>}
                {!loading && images.length === 0 && !error && (
                    <p className="text-center text-sm text-gray-400 my-12">还没有图片，去聊天页生成第一张吧。</p>
                )}

                <div className="columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-3 [column-fill:_balance]">
                    {images.map((img) => (
                        <button
                            key={img.id}
                            onClick={() => setViewing(img)}
                            className="group relative mb-3 block w-full overflow-hidden rounded-lg break-inside-avoid"
                        >
                            <img
                                src={imageUrl(img.id)}
                                alt={img.prompt ?? ''}
                                loading="lazy"
                                className="w-full transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-white text-xs truncate">{img.prompt}</p>
                            </div>
                        </button>
                    ))}
                </div>

                {cursor !== null && (
                    <div className="text-center my-6">
                        <button
                            onClick={() => load(cursor)}
                            disabled={loading}
                            className="rounded-md bg-violet-500/10 text-violet-500 text-sm px-6 py-2 hover:bg-violet-500 hover:text-white transition-colors disabled:opacity-50"
                        >
                            {loading ? '加载中…' : '加载更多'}
                        </button>
                    </div>
                )}
            </div>

            {viewing && (
                <div
                    className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
                    onClick={() => setViewing(null)}
                >
                    <div
                        className="bg-white dark:bg-zinc-700 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img src={imageUrl(viewing.id)} alt={viewing.prompt ?? ''} className="w-full rounded-t-lg" />
                        <div className="p-4">
                            <p className="text-sm text-gray-700 dark:text-gray-100">{viewing.prompt}</p>
                            {viewing.promptEn && (
                                <p className="text-xs text-gray-400 mt-2 leading-5">{viewing.promptEn}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-2">
                                {new Date(viewing.createdAt).toLocaleString('zh-CN')}
                            </p>
                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={() => navigate('/', { state: { refImageId: viewing.id } })}
                                    className="rounded-md bg-violet-500 text-white text-sm px-4 py-2 hover:bg-violet-600"
                                >
                                    <i className="ri-repeat-2-line mr-1" aria-hidden />
                                    以此图再创作
                                </button>
                                <a
                                    href={imageUrl(viewing.id)}
                                    download
                                    className="rounded-md bg-slate-100 dark:bg-zinc-600 text-gray-600 dark:text-gray-100 text-sm px-4 py-2 hover:bg-slate-200"
                                >
                                    <i className="ri-download-2-line mr-1" aria-hidden />
                                    下载
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
