// 局部编辑用的图像处理（sharp）：蒙版转换、羽化合成、扩图补白
// 约定：前端传来的“选区”PNG —— 要编辑的地方画成不透明(alpha>0)，其余透明(alpha=0)
import sharp from 'sharp';

export type Dir = 'up' | 'down' | 'left' | 'right' | 'all';

export async function pngDims(buf: Buffer): Promise<{ width: number; height: number }> {
    const m = await sharp(buf).metadata();
    return { width: m.width ?? 0, height: m.height ?? 0 };
}

// 统一成 RGBA PNG（gpt-image edits 要求底图为 PNG）
export async function toPngRGBA(buf: Buffer): Promise<Buffer> {
    return sharp(buf).ensureAlpha().png().toBuffer();
}

// 取选区的 alpha 通道（0..255，255=要编辑），并缩放到指定尺寸
async function selectionAlphaRaw(selectionPng: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(selectionPng)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .extractChannel(3)
        .raw()
        .toBuffer();
}

// 生成 OpenAI/gpt-image 规格的蒙版：RGBA，透明处=要编辑，不透明处=保持
// 输入选区 alpha：255=编辑 → 输出 alpha=0；0=保持 → 输出 alpha=255
export async function buildEditMask(selectionPng: Buffer, width: number, height: number): Promise<Buffer> {
    const sel = await selectionAlphaRaw(selectionPng, width, height);
    const n = width * height;
    const rgba = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        rgba[i * 4] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255 - sel[i]; // 反转：编辑区→透明
    }
    return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// 把模型输出“只在选区内(带羽化)”合成回原图 → 选区外 100% 是原像素，边缘平滑无缝
export async function compositeMasked(
    originalPng: Buffer,
    editedPng: Buffer,
    selectionPng: Buffer,
    feather = 6
): Promise<Buffer> {
    const { width, height } = await pngDims(originalPng);
    const n = width * height;
    const rgb = await sharp(editedPng).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const fa = await sharp(selectionPng)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .extractChannel(3)
        .blur(feather > 0 ? feather : 0.3) // 羽化边缘
        .raw()
        .toBuffer();
    const rgba = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        rgba[i * 4] = rgb[i * 3];
        rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgba[i * 4 + 2] = rgb[i * 3 + 2];
        rgba[i * 4 + 3] = fa[i]; // 用羽化后的选区作为叠加透明度
    }
    const editedWithAlpha = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return sharp(originalPng)
        .removeAlpha()
        .composite([{ input: editedWithAlpha, blend: 'over' }])
        .png()
        .toBuffer();
}

// 扩张选区（把涂抹范围向外扩 px 像素）——擦除时用，把紧邻的接触阴影一并纳入可编辑区
export async function dilateSelection(
    selectionPng: Buffer,
    width: number,
    height: number,
    px: number
): Promise<Buffer> {
    if (px <= 0) return selectionPng;
    // 用「模糊 + 低阈值」近似形态学膨胀：alpha 模糊后只要有一点就算选中 → 区域向外长出一圈
    const alpha = await sharp(selectionPng)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .extractChannel(3)
        .blur(px)
        .raw()
        .toBuffer();
    const n = width * height;
    const rgba = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        const on = alpha[i] > 12 ? 255 : 0;
        rgba[i * 4] = 255;
        rgba[i * 4 + 1] = 255;
        rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = on;
    }
    return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// 扩图：把原图向指定方向补白，返回补白后的底图 + 对应选区(新区域=要编辑)
export async function padForOutpaint(
    originalPng: Buffer,
    dir: Dir,
    ratio = 0.5
): Promise<{ paddedBase: Buffer; selection: Buffer; width: number; height: number }> {
    const { width, height } = await pngDims(originalPng);
    const px = Math.max(1, Math.round(width * ratio));
    const py = Math.max(1, Math.round(height * ratio));
    let top = 0,
        bottom = 0,
        left = 0,
        right = 0;
    if (dir === 'all') {
        top = bottom = py;
        left = right = px;
    } else if (dir === 'up') top = py;
    else if (dir === 'down') bottom = py;
    else if (dir === 'left') left = px;
    else if (dir === 'right') right = px;
    const nw = width + left + right;
    const nh = height + top + bottom;

    // 底图：原图放在对应位置，四周补透明（模型据此在新区域作画）
    const paddedBase = await sharp(originalPng)
        .removeAlpha()
        .extend({ top, bottom, left, right, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    // 选区：整张不透明(要编辑)，在原图所在矩形挖透明(保持) → 用 dest-out 打洞
    const hole = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
    })
        .png()
        .toBuffer();
    const selection = await sharp({
        create: { width: nw, height: nh, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
    })
        .composite([{ input: hole, left, top, blend: 'dest-out' }])
        .png()
        .toBuffer();

    return { paddedBase, selection, width: nw, height: nh };
}
