/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // "Zinc" Palette - The standard for modern dark UIs
        background: "#09090b",
        foreground: "#fafafa",
        primary: "#18181b",
        border: "#27272a",
        muted: "#27272a",
        "muted-foreground": "#a1a1aa",
      }
    },
  },
  plugins: [],
}
