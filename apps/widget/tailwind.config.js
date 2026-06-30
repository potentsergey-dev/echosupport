/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false, // Do not reset host-page styles
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
