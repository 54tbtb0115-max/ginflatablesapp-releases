import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Conversation, KeywordsContent, Message } from '../../shared/types';
import { imageUrl } from '../../shared/types';
import { api } from '../lib/api';

type Busy = 'idle' | 'thinking' | 'generating';

export default function ChatPage() {
    const location = useLocation();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [busy, setBusy] = useState<Busy>('idle');
    const [error, setError] = useState<string | null>(null);
    // 图生图的参考图：来自图库「再创作」、聊天内图片、或本地上传
    const [refImageId, setRefImageId] = useState<string | null>(
        (location.state as { refImageId?: string } | null)?.refImageId ?? null
    );
    const bottomRef = useRef<HTMLDivElement>(null);
    // 防止请求返回时用户已切到别的会话，把消息插错地方
    const activeIdRef = useRef<string | null>(null);
    activeIdRef.current = activeId;

    useEffect(() => {
        api.listConversations()
            .then(({ conversations }) => {
                setConversations(conversations);
                if (conversations.length > 0) setActiveId(conversations[0].id);
            })
            .catch((e) => setError(e.message));
    }, []);

    useEffect(() => {
        if (!activeId) {
            setMessages([]);
            return;
        }
        api.listMessages(activeId)
            .then(({ messages }) => setMessages(messages))
            .catch((e) => setError(e.message));
    }, [activeId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, busy]);

    // 有"生成中"的图片时轮询刷新消息——切页面/换会话/刷新后回来，生成结果照常出现
    useEffect(() => {
        const hasPending = messages.some((m) => m.type === 'image' && m.content.status === 'pending');
        if (!hasPending || !activeId) return;
        const timer = setInterval(() => {
            api.listMessages(activeId)
                .then(({ messages }) => {
                    if (activeIdRef.current === activeId) setMessages(messages);
                })
                .catch(() => {});
        }, 2500);
        return () => clearInterval(timer);
    }, [messages, activeId]);

    const ensureConversation = useCallback(async (): Promise<string> => {
        if (activeId) return activeId;
        const { conversation } = await api.createConversation();
        setConversations((cs) => [conversation, ...cs]);
        setActiveId(conversation.id);
        return conversation.id;
    }, [activeId]);

    const newConversation = async () => {
        try {
            const { conversation } = await api.createConversation();
            setConversations((cs) => [conversation, ...cs]);
            setActiveId(conversation.id);
            setRefImageId(null);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const sendText = async (text: string) => {
        setError(null);
        setBusy('thinking');
        try {
            const id = await ensureConversation();
            const { messages: newMessages } = await api.chat(id, text, refImageId ?? undefined);
            if (activeIdRef.current === id) setMessages((ms) => [...ms, ...newMessages]);
            // AI 判断为明确指令时会直接返回生成的图片，此时参考图已被使用
            if (newMessages.some((m) => m.type === 'image')) setRefImageId(null);
            setConversations((cs) =>
                cs.map((c) => (c.id === id && c.title === '新会话' ? { ...c, title: text.slice(0, 20) } : c))
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy('idle');
        }
    };

    const generate = async (selected: Record<string, string[]>, note: string) => {
        if (!activeId) return;
        setError(null);
        setBusy('generating');
        try {
            const { messages: newMessages } = await api.generate(activeId, {
                selected,
                note: note || undefined,
                sourceImageId: refImageId ?? undefined,
            });
            if (activeIdRef.current === activeId) setMessages((ms) => [...ms, ...newMessages]);
            setRefImageId(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy('idle');
        }
    };

    const uploadReference = async (file: File) => {
        setError(null);
        try {
            const id = await ensureConversation();
            const { imageId, message } = await api.upload(id, file);
            setMessages((ms) => [...ms, message]);
            setRefImageId(imageId);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    return (
        <div className="flex h-full min-h-0">
            <ConversationList
                conversations={conversations}
                activeId={activeId}
                onSelect={setActiveId}
                onNew={newConversation}
            />
            <ChatWindow
                messages={messages}
                busy={busy}
                error={error}
                refImageId={refImageId}
                onClearRef={() => setRefImageId(null)}
                onUseAsRef={setRefImageId}
                onSend={sendText}
                onGenerate={generate}
                onUpload={uploadReference}
                bottomRef={bottomRef}
            />
        </div>
    );
}

function ConversationList({
    conversations,
    activeId,
    onSelect,
    onNew,
}: {
    conversations: Conversation[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
}) {
    return (
        <div className="hidden md:flex w-[300px] lg:w-[380px] shrink-0 flex-col bg-slate-50 dark:bg-zinc-700 shadow">
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <h4 className="text-gray-700 dark:text-gray-50">会话</h4>
                <button
                    onClick={onNew}
                    className="h-9 w-9 rounded-lg bg-violet-500/20 text-violet-500 hover:bg-violet-500 hover:text-white transition-colors"
                    title="新会话"
                >
                    <i className="ri-add-line text-xl" aria-hidden />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-4">
                {conversations.length === 0 && (
                    <p className="px-4 py-6 text-sm text-gray-400">还没有会话，直接在右侧输入描述开始吧。</p>
                )}
                {conversations.map((c) => (
                    <button
                        key={c.id}
                        onClick={() => onSelect(c.id)}
                        className={`w-full text-left px-4 py-3 my-0.5 rounded-md transition-colors ${
                            c.id === activeId
                                ? 'bg-violet-500/10 dark:bg-zinc-600'
                                : 'hover:bg-slate-100 dark:hover:bg-zinc-600/50'
                        }`}
                    >
                        <p className="truncate text-gray-700 dark:text-gray-50">{c.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(c.createdAt).toLocaleString('zh-CN')}
                        </p>
                    </button>
                ))}
            </div>
        </div>
    );
}

function ChatWindow({
    messages,
    busy,
    error,
    refImageId,
    onClearRef,
    onUseAsRef,
    onSend,
    onGenerate,
    onUpload,
    bottomRef,
}: {
    messages: Message[];
    busy: Busy;
    error: string | null;
    refImageId: string | null;
    onClearRef: () => void;
    onUseAsRef: (id: string) => void;
    onSend: (text: string) => void;
    onGenerate: (selected: Record<string, string[]>, note: string) => void;
    onUpload: (file: File) => void;
    bottomRef: React.RefObject<HTMLDivElement>;
}) {
    const [input, setInput] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // 输入框随内容自动增高（约 5 行封顶，超出后内部滚动）
    const resizeInput = () => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
    };

    const submit = () => {
        const text = input.trim();
        if (!text || busy !== 'idle') return;
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
        onSend(text);
    };

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-800">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-600">
                <h5 className="text-gray-700 dark:text-gray-50">聊天生图</h5>
                <p className="text-xs text-gray-400 mt-0.5">
                    描述画面 → 挑选 AI 总结的关键词 → 生成图片；选中参考图即为图生图
                </p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 lg:px-6 py-4 pb-[90px] lg:pb-4">
                {messages.length === 0 && busy === 'idle' && <EmptyState />}
                {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} busy={busy} onGenerate={onGenerate} onUseAsRef={onUseAsRef} />
                ))}
                {busy === 'thinking' && <PendingBubble text="思考中…" />}
                {busy === 'generating' && <PendingBubble text="正在整理提示词…" />}
                {error && (
                    <div className="my-3 mx-auto max-w-md rounded-md bg-red-500/10 text-red-500 text-sm px-4 py-2 text-center">
                        {error}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {refImageId && (
                <div className="mx-4 lg:mx-6 mb-2 flex items-center gap-3 rounded-lg bg-violet-500/10 px-3 py-2">
                    <img src={imageUrl(refImageId)} alt="参考图" className="h-12 w-12 rounded object-cover" />
                    <div className="flex-1 text-sm text-gray-600 dark:text-gray-100">
                        <p className="font-medium">已设为图生图参考图</p>
                        <p className="text-xs text-gray-400 mt-0.5">生成时会以这张图为基础进行修改</p>
                    </div>
                    <button onClick={onClearRef} className="text-gray-400 hover:text-red-500" title="移除参考图">
                        <i className="ri-close-circle-line text-xl" aria-hidden />
                    </button>
                </div>
            )}

            <div className="px-4 lg:px-6 py-4 border-t border-slate-100 dark:border-zinc-600 mb-[60px] lg:mb-0">
                <div className="flex items-end gap-2">
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="h-11 w-11 shrink-0 rounded-lg text-violet-500 hover:bg-violet-500/10 text-xl"
                        title="上传参考图（图生图）"
                    >
                        <i className="ri-image-add-line" aria-hidden />
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onUpload(file);
                            e.target.value = '';
                        }}
                    />
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            resizeInput();
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        rows={1}
                        placeholder="描述你想要的画面，例如：黄昏的海边有一座充气城堡…（Shift+回车换行）"
                        className="flex-1 resize-none overflow-y-auto scrollbar-thin rounded-lg border-0 bg-slate-50 dark:bg-zinc-700 dark:text-gray-100 placeholder:text-gray-400 focus:ring-violet-500 px-4 py-2.5"
                    />
                    <button
                        onClick={submit}
                        disabled={busy !== 'idle' || !input.trim()}
                        className="h-11 w-11 shrink-0 rounded-lg bg-violet-500 text-white text-xl hover:bg-violet-600 disabled:opacity-50"
                        title="发送"
                    >
                        <i className="ri-send-plane-2-fill" aria-hidden />
                    </button>
                </div>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <div className="h-16 w-16 rounded-2xl bg-violet-500/10 text-violet-500 flex items-center justify-center mb-4">
                <i className="ri-brush-ai-line text-3xl" aria-hidden />
            </div>
            <p className="max-w-sm text-sm leading-6">
                用一句话描述你想要的画面，AI 会先总结出场景、主体、风格等关键词，
                你挑选之后再生成图片。生成的每张图都会保存到图库。
            </p>
        </div>
    );
}

function PendingBubble({ text }: { text: string }) {
    return (
        <div className="flex justify-start my-3">
            <div className="rounded-lg rounded-bl-none bg-slate-50 dark:bg-zinc-700 px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                <i className="ri-loader-4-line animate-spin text-violet-500" aria-hidden />
                {text}
            </div>
        </div>
    );
}

function MessageBubble({
    message,
    busy,
    onGenerate,
    onUseAsRef,
}: {
    message: Message;
    busy: Busy;
    onGenerate: (selected: Record<string, string[]>, note: string) => void;
    onUseAsRef: (id: string) => void;
}) {
    const mine = message.role === 'user';

    if (message.type === 'keywords') {
        return (
            <div className="flex justify-start my-3">
                <KeywordCard content={message.content} disabled={busy !== 'idle'} onGenerate={onGenerate} />
            </div>
        );
    }

    if (message.type === 'image') {
        if (message.content.status === 'pending') {
            return (
                <div className="flex justify-start my-3">
                    <div className="w-[280px] h-[180px] rounded-lg bg-slate-50 dark:bg-zinc-700 flex flex-col items-center justify-center gap-2 text-sm text-gray-400">
                        <i className="ri-loader-4-line animate-spin text-2xl text-violet-500" aria-hidden />
                        正在生成图片…（切换页面也不会中断）
                    </div>
                </div>
            );
        }
        if (message.content.status === 'failed') {
            return (
                <div className="flex justify-start my-3">
                    <div className="max-w-[320px] rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
                        <p className="font-medium mb-1">生成失败</p>
                        <p className="text-xs leading-5">{message.content.error ?? '未知错误'}</p>
                    </div>
                </div>
            );
        }
        return (
            <div className={`flex ${mine ? 'justify-end' : 'justify-start'} my-3`}>
                <div className="max-w-[320px]">
                    <img
                        src={imageUrl(message.content.imageId)}
                        alt={message.content.prompt}
                        className="rounded-lg shadow max-w-full"
                        loading="lazy"
                    />
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                        <span className="truncate flex-1" title={message.content.prompt}>
                            {message.content.prompt}
                        </span>
                        <a
                            href={imageUrl(message.content.imageId)}
                            download
                            className="hover:text-violet-500"
                            title="下载"
                        >
                            <i className="ri-download-2-line" aria-hidden />
                        </a>
                        <button
                            onClick={() => onUseAsRef(message.content.imageId)}
                            className="hover:text-violet-500"
                            title="以此图再创作（图生图）"
                        >
                            <i className="ri-repeat-2-line" aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${mine ? 'justify-end' : 'justify-start'} my-3`}>
            <div
                className={`max-w-[75%] px-4 py-2.5 text-sm leading-6 rounded-lg whitespace-pre-wrap ${
                    mine
                        ? 'bg-violet-500 text-white rounded-br-none'
                        : 'bg-slate-50 dark:bg-zinc-700 text-gray-700 dark:text-gray-100 rounded-bl-none'
                }`}
            >
                {message.content.text}
            </div>
        </div>
    );
}

// 关键词挑选卡片：AI 返回的分组关键词，勾选后点「生成图片」
function KeywordCard({
    content,
    disabled,
    onGenerate,
}: {
    content: KeywordsContent;
    disabled: boolean;
    onGenerate: (selected: Record<string, string[]>, note: string) => void;
}) {
    const [selected, setSelected] = useState<Record<string, string[]>>(() =>
        // 默认选中每组第一个（通常是用户明确提到的）
        Object.fromEntries(content.groups.map((g) => [g.name, g.options.slice(0, 1)]))
    );
    const [note, setNote] = useState('');

    const toggle = (group: string, word: string) => {
        setSelected((s) => {
            const words = s[group] ?? [];
            return { ...s, [group]: words.includes(word) ? words.filter((w) => w !== word) : [...words, word] };
        });
    };

    const count = Object.values(selected).reduce((n, ws) => n + ws.length, 0);

    return (
        <div className="max-w-[85%] lg:max-w-[560px] rounded-lg rounded-bl-none bg-slate-50 dark:bg-zinc-700 px-4 py-3">
            <p className="text-sm text-gray-700 dark:text-gray-100 mb-3">{content.reply}</p>
            {content.groups.map((g) => (
                <div key={g.name} className="mb-2.5">
                    <p className="text-xs text-gray-400 mb-1.5">{g.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {g.options.map((word) => {
                            const active = (selected[g.name] ?? []).includes(word);
                            return (
                                <button
                                    key={word}
                                    onClick={() => toggle(g.name, word)}
                                    className={`px-3 py-1 rounded-full text-13 text-sm border transition-colors ${
                                        active
                                            ? 'bg-violet-500 border-violet-500 text-white'
                                            : 'border-slate-200 dark:border-zinc-500 text-gray-500 dark:text-gray-200 hover:border-violet-400'
                                    }`}
                                >
                                    {word}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
            <div className="flex items-center gap-2 mt-3">
                <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="补充说明（可选）"
                    className="flex-1 rounded-md border-0 bg-white dark:bg-zinc-600 dark:text-gray-100 text-sm px-3 py-1.5 placeholder:text-gray-400 focus:ring-violet-500"
                />
                <button
                    onClick={() => onGenerate(selected, note.trim())}
                    disabled={disabled || count === 0}
                    className="shrink-0 rounded-md bg-violet-500 text-white text-sm px-4 py-1.5 hover:bg-violet-600 disabled:opacity-50"
                >
                    <i className="ri-magic-line mr-1" aria-hidden />
                    生成图片
                </button>
            </div>
        </div>
    );
}
