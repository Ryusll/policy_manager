/**
 * 테마 색은 CSS 변수(`--color-navy-*`, `--color-gold-*`)로 주입됩니다.
 * `src/index.css` 기본값 + 설정에서 프리셋/커스텀 변경.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: 'rgb(var(--color-navy-50) / <alpha-value>)',
          100: 'rgb(var(--color-navy-100) / <alpha-value>)',
          200: 'rgb(var(--color-navy-200) / <alpha-value>)',
          300: 'rgb(var(--color-navy-300) / <alpha-value>)',
          400: 'rgb(var(--color-navy-400) / <alpha-value>)',
          500: 'rgb(var(--color-navy-500) / <alpha-value>)',
          600: 'rgb(var(--color-navy-600) / <alpha-value>)',
          700: 'rgb(var(--color-navy-700) / <alpha-value>)',
          800: 'rgb(var(--color-navy-800) / <alpha-value>)',
          900: 'rgb(var(--color-navy-900) / <alpha-value>)',
        },
        gold: {
          400: 'rgb(var(--color-gold-400) / <alpha-value>)',
          500: 'rgb(var(--color-gold-500) / <alpha-value>)',
          600: 'rgb(var(--color-gold-600) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans KR"', 'Apple SD Gothic Neo', 'Malgun Gothic', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
