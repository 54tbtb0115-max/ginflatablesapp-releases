import { NavLink } from 'react-router-dom';

// 左侧图标导航栏，样式参考 Chatvia：桌面端 75px 竖排，移动端置底横排
export default function Sidebar({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
    const tabClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center justify-center mx-auto h-14 w-14 my-1 rounded-lg text-2xl transition-colors ` +
        (isActive
            ? 'bg-violet-600/60 text-white'
            : 'text-violet-100 hover:bg-violet-600/40 hover:text-white');

    return (
        <nav className="w-full lg:w-[75px] shrink-0 bg-violet-500 shadow flex flex-row lg:flex-col items-center justify-between z-40">
            <div className="hidden lg:flex my-5 h-9 w-9 items-center justify-center rounded-lg bg-white/20 text-white">
                <i className="ri-brush-ai-line text-xl" aria-hidden />
            </div>

            <ul className="flex flex-row lg:flex-col justify-center w-full lg:my-auto">
                <li className="flex-grow lg:flex-grow-0">
                    <NavLink to="/" className={tabClass} title="聊天生图">
                        <i className="ri-message-3-line" aria-hidden />
                    </NavLink>
                </li>
                <li className="flex-grow lg:flex-grow-0">
                    <NavLink to="/gallery" className={tabClass} title="图库">
                        <i className="ri-image-2-line" aria-hidden />
                    </NavLink>
                </li>
            </ul>

            <div className="my-3 lg:my-5">
                <button
                    onClick={onToggleDark}
                    className="flex items-center justify-center h-14 w-14 rounded-lg text-2xl text-violet-100 hover:text-white"
                    title={dark ? '切换到亮色' : '切换到暗色'}
                >
                    <i className={dark ? 'ri-sun-line' : 'ri-moon-clear-line'} aria-hidden />
                </button>
            </div>
        </nav>
    );
}
