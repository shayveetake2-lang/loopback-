/** @type {import('tailwindcss').Config} */
export default {
  content: ["./frontend/index.html", "./frontend/app.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "sans-serif"],
        display: ["Space Grotesk", "sans-serif"],
      },
    },
  },
};
