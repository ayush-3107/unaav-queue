/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0F6E56',
          light:   '#E8F5F1',
          dark:    '#0A4F3D',
        },
      },
    },
  },
  plugins: [],
};