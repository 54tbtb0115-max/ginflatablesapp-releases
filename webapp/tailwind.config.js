// 配色与字体取自 Chatvia (Themesbrand) Tailwind 模板，保持同样的视觉风格
import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['class', '[data-mode="dark"]'],
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        fontFamily: {
            primary: ['Public Sans', 'sans-serif'],
        },
        extend: {
            fontSize: {
                base: '0.938rem',
            },
            colors: {
                violet: {
                    50: '#DFDDFB',
                    100: '#D9D6FB',
                    200: '#BFBBF8',
                    300: '#9892F3',
                    400: '#7F77F0',
                    500: '#7269ef',
                    600: '#685FD9',
                    700: '#5D56C4',
                    800: '#534CAE',
                    900: '#494398',
                },
                gray: {
                    50: '#EFF2F7',
                    100: '#E6E7EA',
                    200: '#C0C2CB',
                    300: '#A7A9B6',
                    400: '#8D91A2',
                    500: '#74788D',
                    600: '#5F6273',
                    700: '#3F414D',
                    800: '#2A2C33',
                    900: '#202126',
                },
                zinc: {
                    50: '#C6C9CB',
                    100: '#A5AAAE',
                    200: '#91979C',
                    300: '#6D747B',
                    400: '#48515A',
                    500: '#424B55',
                    600: '#36404a',
                    700: '#303841',
                    800: '#262e35',
                    900: '#22282e',
                },
                slate: {
                    50: '#f5f7fb',
                    100: '#e6ebf5',
                    200: '#DFE4EE',
                    300: '#D8DDE6',
                    400: '#D1D6DF',
                    500: '#BEC3CB',
                    600: '#ABAFB6',
                    700: '#989CA2',
                    800: '#85888E',
                    900: '#72757A',
                },
                red: {
                    500: '#FD625E',
                },
                green: {
                    500: '#2ab57d',
                },
            },
        },
    },
    plugins: [forms],
};
