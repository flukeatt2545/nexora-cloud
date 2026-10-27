import tailwindcss from "@tailwindcss/postcss";
import squareUi from "./build/postcss-square-ui.mjs";

const config = {
  plugins: [tailwindcss(), squareUi()],
};

export default config;
