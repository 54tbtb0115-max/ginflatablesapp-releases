import type { Conversation, GalleryPage, GenerateRequest, KeywordStat, Message, User } from '../../shared/types';

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
    listConversations: () => request<{ conversations: Conversation[] }>('/api/conversations'),
    createConversation: () => request<{ conversation: Conversation }>('/api/conversations', { method: 'POST' }),
    listMessages: (conversationId: string) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`),
    chat: (conversationId: string, text: string, sourceImageId?: string) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/chat`, json({ text, sourceImageId })),
    generate: (conversationId: string, body: GenerateRequest) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/generate`, json(body)),
    hdRegenerate: (conversationId: string, imageId: string) =>
        request<{ messages: Message[] }>(`/api/conversations/${conversationId}/hd`, json({ imageId })),
    upload: (conversationId: string, file: File) =>
        request<{ imageId: string; message: Message }>(`/api/conversations/${conversationId}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
        }),
    gallery: (cursor?: number) =>
        request<GalleryPage>(`/api/gallery${cursor ? `?cursor=${cursor}` : ''}`),
};
