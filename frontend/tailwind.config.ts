import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18211f",
        mint: "#b9edda",
        paper: "#f7f8f5",
      },
    },
  },
  plugins: [],
};
export default config;
