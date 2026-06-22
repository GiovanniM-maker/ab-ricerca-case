import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        walk30: "#16a34a",
        transit30: "#2563eb",
        transit45: "#9333ea",
      },
    },
  },
  plugins: [],
};

export default config;
