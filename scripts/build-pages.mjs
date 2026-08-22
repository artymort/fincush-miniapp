import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const apiUrl = String(process.env.WORKER_API_URL || "").replace(/\/$/, "");

const files = [
  "styles.css",
  "app.js",
  "fingramlogo.svg",
  "fingramlogotext.svg",
  "Inter-Variable.ttf",
  "Inter-OFL.txt",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}

const sourceHtml = await readFile(resolve(root, "index.html"), "utf8");
const escapedApiUrl = apiUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const builtHtml = sourceHtml.replace(
  '<meta name="fincush-api-url" content="" />',
  `<meta name="fincush-api-url" content="${escapedApiUrl}" />`,
);
await writeFile(resolve(output, "index.html"), builtHtml, "utf8");

await cp(resolve(root, "assets", "mascot", "poses"), resolve(output, "assets", "mascot", "poses"), {
  recursive: true,
});

await writeFile(resolve(output, ".nojekyll"), "", "utf8");

console.log(`GitHub Pages bundle created in ${output}`);
console.log(apiUrl ? `Worker API: ${apiUrl}` : "Worker API is empty: the published app will use demo mode.");
