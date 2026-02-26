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
        }
      },
    },
    plugins: [],
}