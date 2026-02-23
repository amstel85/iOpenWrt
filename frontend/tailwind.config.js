/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'unifi-blue': '#0087F5',
        'unifi-dark': '#1F2937',
        'unifi-bg': '#F3F4F6',
        'unifi-card': '#FFFFFF',
        'unifi-text': '#374151',
        'unifi-text-light': '#6B7280',
        'unifi-border': '#E5E7EB',
        'unifi-success': '#10B981',
        'unifi-warning': '#F59E0B',
        'unifi-danger': '#EF4444',
      }
    },
  },
  plugins: [],
}
