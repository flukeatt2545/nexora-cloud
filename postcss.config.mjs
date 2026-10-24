import tailwindcss from "@tailwindcss/postcss";
import siteAngular from "./scripts/postcss-site-angular.mjs";

// siteAngular goes last: it reads the finished rules, Tailwind's included.
const config = {
  plugins: [tailwindcss(), siteAngular()],
};

export default config;
