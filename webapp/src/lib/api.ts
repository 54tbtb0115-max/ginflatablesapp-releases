import type {
    AdminStats,
    Conversation,
    GalleryPage,
    GenerateRequest,
    ImageModelOption,
    KeywordStat,
    Message,
    RefRole,
    User,
} from '../../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
    return data;
}

const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export const api = {
    me: () => request<{ user: User }>('/api/auth/me'),
    login: (username: string, password: string) =>
        request<{ user: User }>('/api/auth/login', json({ username, password })),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    changePassword: (oldPassword: string, newPassword: string) =>
        request<{ ok: boolean }>('/api/account/password', json({ oldPassword, newPassword })),
    keywordStats: () => request<{ stats: KeywordStat[]; total: number }>('/api/keywords/stats'),
    adminStats: (from: number, to: number) =>
        request<AdminStats>(`/api/admin/stats?from=${from}&to=${to}`),
    models: () => request<{ models: ImageModelOption[]; defaultModelId: string }>('/api/models'),
    listConversations: () => request<{ conversations: Conversation[] }>('/api/conversations'),
    createConversation: () => request<{ conversation: Conversation }>('/api/conversations', { method: 'POST' }),
    listMessages: (conversationId: string) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`),
    chat: (
        conversationId: string,
        text: string,
        opts?: { sourceImageIds?: string[]; sourceRoles?: RefRole[]; modelId?: string }
    ) =>
        request<{ messages: Message[] }>(
            `/api/conversations/${conversationId}/chat`,
            json({ text, ...opts })
        ),
    generate: (conversationId: string, body: GenerateRequest) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/generate`, json(body)),
    hdRegenerate: (conversationId: string, imageId: string) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/hd`, json({ imageId })),
    // 局部编辑：标记改图 / 擦除 / 扩图 / 抠图
    edit: (
        conversationId: string,
        body: {
            imageId: string;
            op: 'inpaint' | 'erase' | 'outpaint' | 'cutout';
            maskPng?: string;
            prompt?: string;
            direction?: 'up' | 'down' | 'left' | 'right' | 'all';
            ratio?: number;
        }
    ) => request<{ messages: Message[] }>(`/api/conversations/${conversationId}/edit`, json(body)),
    cancel: (conversationId: string, messageId: string) =>
        request<{ ok: boolean }>(`/api/conversations/${conversationId}/cancel`, json({ messageId })),
    upload: (conversationId: string, file: File) =>
        request<{ imageId: string; message: Message }>(`/api/conversations/${conversationId}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
        }),
    gallery: (cursor?: number) =>
        request<GalleryPage>(`/api/gallery${cursor ? `?cursor=${cursor}` : ''}`),
};
