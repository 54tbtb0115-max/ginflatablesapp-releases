import { useEffect, useRef, useState } from 'react';
import type { Message } from '../../shared/types';
import { imageUrl } from '../../shared/types';
import { api } from '../lib/api';

type Tool = 'inpaint' | 'erase' | 'outpaint' | 'cutout';
type Dir = 'up' | 'down' | 'left' | 'right' | 'all';

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
    { id: 'inpaint', label: '标记改图', icon: 'ri-brush-line', hint: '涂抹要修改的区域，并写下想改成什么' },
    {
        id: 'erase',
        label: '擦除',
        icon: 'ri-eraser-line',
        hint: '涂抹要去掉的东西（把它的影子/倒影也一起涂上，效果更好），AI 会自动填补背景',
    },
    { id: 'outpaint', label: '扩图', icon: 'ri-aspect-ratio-line', hint: '向选定方向扩展画面，AI 补全新区域' },
    { id: 'cutout', label: '抠图', icon: 'ri-scissors-cut-line', hint: '一键去背景，只保留主体（透明底）' },
];

const DIRS: { id: Dir; label: string }[] = [
    { id: 'up', label: '上' },
    { id: 'down', label: '下' },
    { id: 'left', label: '左' },
    { id: 'right', label: '右' },
    { id: 'all', label: '四周' },
];

export default function ImageEditor({
    conversationId,
    imageId,
    onClose,
    onResult,
}: {
    conversationId: string;
    imageId: string;
    onClose: () => void;
    onResult: (messages: Message[]) => void;
}) {
    const [tool, setTool] = useState<Tool>('inpaint');
    const [brush, setBrush] = useState(48);
    const [prompt, setPrompt] = useState('');
    const [direction, setDirection] = useState<Dir>('all');
    const [ratio, setRatio] = useState(0.5);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMask, setHasMask] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const needMask = tool === 'inpaint' || tool === 'erase';

    // 图片加载后把画布尺寸设为图片自然尺寸（长边封顶 1280，保性能）
    const onImgLoad = () => {
        const img = imgRef.current;
        const cv = canvasRef.current;
        if (!img || !cv) return;
        const nw = img.naturalWidth || 1024;
        const nh = img.naturalHeight || 1024;
        const cap = 1280;
        const scale = Math.min(1, cap / Math.max(nw, nh));
        cv.width = Math.round(nw * scale);
        cv.height = Math.round(nh * scale);
        const ctx = cv.getContext('2d');
        ctx?.clearRect(0, 0, cv.width, cv.height);
        setHasMask(false);
    };

    const pos = (e: React.PointerEvent) => {
        const cv = canvasRef.current!;
        const rect = cv.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * cv.width,
            y: ((e.clientY - rect.top) / rect.height) * cv.height,
        };
    };

    const paint = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const ctx = canvasRef.current!.getContext('2d')!;
        ctx.strokeStyle = 'rgba(139,92,246,0.55)';
        ctx.fillStyle = 'rgba(139,92,246,0.55)';
        ctx.lineWidth = brush;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, brush / 2, 0, Math.PI * 2);
        ctx.fill();
    };

    const onDown = (e: React.PointerEvent) => {
        if (!needMask) return;
        drawing.current = true;
        const p = pos(e);
        last.current = p;
        paint(p, p);
        setHasMask(true);
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!needMask || !drawing.current || !last.current) return;
        const p = pos(e);
        paint(last.current, p);
        last.current = p;
    };
    const onUp = () => {
        drawing.current = false;
        last.current = null;
    };

    const clearMask = () => {
        const cv = canvasRef.current;
        if (!cv) return;
        cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
        setHasMask(false);
    };

    // 把涂抹的画布导出成蒙版 PNG：涂过的地方=不透明白(要编辑)，其余透明
    const exportMask = (): string => {
        const cv = canvasRef.current!;
        const src = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
        const out = document.createElement('canvas');
        out.width = cv.width;
        out.height = cv.height;
        const octx = out.getContext('2d')!;
        const dst = octx.createImageData(cv.width, cv.height);
        for (let i = 0; i < src.data.length; i += 4) {
            const painted = src.data[i + 3] > 8;
            dst.data[i] = 255;
            dst.data[i + 1] = 255;
            dst.data[i + 2] = 255;
            dst.data[i + 3] = painted ? 255 : 0;
        }
        octx.putImageData(dst, 0, 0);
        return out.toDataURL('image/png');
    };

    const submit = async () => {
        setError(null);
        if (needMask && !hasMask) {
            setError('请先在图上涂抹要处理的区域');
            return;
        }
        if (tool === 'inpaint' && !prompt.trim()) {
            setError('请写下要把涂抹区域改成什么');
            return;
        }
        setBusy(true);
        try {
            const body = {
                imageId,
                op: tool,
                maskPng: needMask ? exportMask() : undefined,
                prompt: tool === 'inpaint' || tool === 'outpaint' ? prompt.trim() || undefined : undefined,
                direction: tool === 'outpaint' ? direction : undefined,
                ratio: tool === 'outpaint' ? ratio : undefined,
            };
            const { messages } = await api.edit(conversationId, body);
            onResult(messages);
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    // Esc 关闭
    useEffect(() => {
        const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const active = TOOLS.find((t) => t.id === tool)!;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white dark:bg-zinc-800 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-600 px-5 py-3">
                    <h5 className="text-gray-700 dark:text-gray-50">编辑图片</h5>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500" title="关闭">
                        <i className="ri-close-line text-2xl" aria-hidden />
                    </button>
                </div>

                {/* 工具栏 */}
                <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                    {TOOLS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => {
                                setTool(t.id);
                                setError(null);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                t.id === tool
                                    ? 'bg-violet-500 text-white'
                                    : 'bg-slate-100 dark:bg-zinc-700 text-gray-600 dark:text-gray-200 hover:text-violet-500'
                            }`}
                        >
                            <i className={t.icon} aria-hidden />
                            {t.label}
                        </button>
                    ))}
                </div>
                <p className="px-5 pt-2 text-xs text-gray-400">{active.hint}</p>

                {/* 画布区 */}
                <div className="flex-1 overflow-auto px-5 py-3">
                    <div className="relative mx-auto w-fit">
                        <img
                            ref={imgRef}
                            src={imageUrl(imageId)}
                            alt="待编辑"
                            onLoad={onImgLoad}
                            className="block max-h-[52vh] w-auto rounded-lg select-none"
                            draggable={false}
                        />
                        <canvas
                            ref={canvasRef}
                            onPointerDown={onDown}
                            onPointerMove={onMove}
                            onPointerUp={onUp}
                            onPointerLeave={onUp}
                            className="absolute inset-0 h-full w-full rounded-lg"
                            style={{ cursor: needMask ? 'crosshair' : 'default', touchAction: 'none' }}
                        />
                    </div>
                </div>

                {/* 参数区 */}
                <div className="border-t border-slate-100 dark:border-zinc-600 px-5 py-3 space-y-3">
                    {needMask && (
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400 shrink-0">画笔</span>
                            <input
                                type="range"
                                min={10}
                                max={120}
                                value={brush}
                                onChange={(e) => setBrush(Number(e.target.value))}
                                className="flex-1 accent-violet-500"
                            />
                            <button
                                onClick={clearMask}
                                className="shrink-0 rounded-md border border-slate-200 dark:border-zinc-500 px-3 py-1 text-xs text-gray-500 dark:text-gray-200 hover:border-violet-400"
                            >
                                清除涂抹
                            </button>
                        </div>
                    )}
                    {tool === 'inpaint' && (
                        <input
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="把涂抹区域改成……（例如：换成一个红色的杯子）"
                            className="w-full rounded-md border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 text-sm px-3 py-2 placeholder:text-gray-400 focus:ring-violet-500"
                        />
                    )}
                    {tool === 'outpaint' && (
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-xs text-gray-400">方向</span>
                            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-zinc-700 p-0.5">
                                {DIRS.map((d) => (
                                    <button
                                        key={d.id}
                                        onClick={() => setDirection(d.id)}
                                        className={`px-3 py-1 rounded-md text-xs transition-colors ${
                                            d.id === direction
                                                ? 'bg-violet-500 text-white'
                                                : 'text-gray-500 dark:text-gray-300 hover:text-violet-500'
                                        }`}
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                            <span className="text-xs text-gray-400 ml-2">幅度 {Math.round(ratio * 100)}%</span>
                            <input
                                type="range"
                                min={10}
                                max={100}
                                value={Math.round(ratio * 100)}
                                onChange={(e) => setRatio(Number(e.target.value) / 100)}
                                className="flex-1 min-w-[120px] accent-violet-500"
                            />
                        </div>
                    )}
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="rounded-md px-4 py-1.5 text-sm text-gray-500 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-zinc-700"
                        >
                            取消
                        </button>
                        <button
                            onClick={submit}
                            disabled={busy}
                            className="rounded-md bg-violet-500 text-white text-sm px-5 py-1.5 hover:bg-violet-600 disabled:opacity-50"
                        >
                            {busy ? '提交中…' : '生成'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
