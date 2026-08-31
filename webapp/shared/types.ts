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
    // pending = 后台生成中；failed = 生成失败；不存在 = 已完成
    status?: 'pending' | 'failed';
    error?: string;
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
    modelId?: string;
};

export type ImageModelOption = { id: string; label: string };

export type User = { id: string; username: string; isAdmin?: boolean };

export type AdminUserStat = {
    username: string;
    count: number;
    cost: number;
    lastUsed: number;
    models: { model: string; count: number }[];
};

export type AdminStats = {
    total: number; // 成功生成数
    totalCost: number; // 预估总花费（美元）
    activeUsers: number; // 去重用户数
    avgPerDay: number; // 日均生成量
    failed: number; // 失败/停止数
    byType: { textToImage: number; imageToImage: number; hd: number };
    byModel: { model: string; count: number; cost: number }[];
    byUser: AdminUserStat[];
    byDay: { day: string; count: number }[];
};

export type KeywordStat = {
    group: string;
    word: string;
    count: number;
    lastUsed: number;
};

export function imageUrl(id: string): string {
    return `/api/images/${id}/file`;
}
