/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class', // Added this
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
            primary: "#1e1e24",
            secondary: "#2a2a35", 
            accent: "#4f46e5",
        },
        keyframes: {
            fadeIn: {
                '0%': { opacity: '0', transform: 'translateY(4px)' },
                '100%': { opacity: '1', transform: 'translateY(0)' },
            },
        },
        animation: {
            fadeIn: 'fadeIn 0.3s ease-out both',
        },
      },
    },
    plugins: [],
}