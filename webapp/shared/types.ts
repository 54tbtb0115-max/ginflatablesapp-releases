// 前后端共用的类型定义

export type KeywordGroup = {
    name: string;
    options: string[];
};

export type TextContent = { text: string };

export type KeywordsContent = {
    reply: string;
    groups: KeywordGroup[];
};

export type ImageContent = {
    imageId: string;
    prompt: string;
    promptEn?: string;
    sourceImageId?: string;
};

export type Message = {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    createdAt: number;
} & (
    | { type: 'text'; content: TextContent }
    | { type: 'keywords'; content: KeywordsContent }
    | { type: 'image'; content: ImageContent }
);

export type Conversation = {
    id: string;
    title: string;
    createdAt: number;
};

export type GalleryImage = {
    id: string;
    prompt: string | null;
    promptEn: string | null;
    keywords: string | null;
    sourceImageId: string | null;
    model: string | null;
    createdAt: number;
};

export type GalleryPage = {
    images: GalleryImage[];
    nextCursor: number | null;
};

// 生成请求：selected 是用户勾选的关键词（按分组），note 是补充说明
// 带 sourceImageId 即图生图（以该图为参考进行编辑式生成）
export type GenerateRequest = {
    selected: Record<string, string[]>;
    note?: string;
    sourceImageId?: string;
};

export type User = { id: string; username: string };

export type KeywordStat = {
    group: string;
    word: string;
    count: number;
    lastUsed: number;
};

export function imageUrl(id: string): string {
    return `/api/images/${id}/file`;
}
