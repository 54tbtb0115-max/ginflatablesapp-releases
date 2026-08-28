// 网站 logo：紫色渐变圆角方块 + 山景/太阳（图片）+ 星光（AI），内嵌 SVG 不依赖图标库
export default function Logo({ size = 36 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="AI 画室">
            <defs>
                <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#8F88F2" />
                    <stop offset="1" stopColor="#5D56C4" />
                </linearGradient>
                <clipPath id="logo-clip">
                    <rect width="48" height="48" rx="12" />
                </clipPath>
            </defs>
            <rect width="48" height="48" rx="12" fill="url(#logo-bg)" />
            <g clipPath="url(#logo-clip)">
                <circle cx="33" cy="15.5" r="5" fill="#FFC563" />
                <path d="M-2 48 L14 26 L23 37 L30 29 L50 48 Z" fill="#ffffff" opacity="0.9" />
                <path d="M20 48 L32 34 L52 48 Z" fill="#ffffff" opacity="0.55" />
            </g>
            <path
                d="M13.5 7 L15 10.5 L18.5 12 L15 13.5 L13.5 17 L12 13.5 L8.5 12 L12 10.5 Z"
                fill="#ffffff"
            />
        </svg>
    );
}
