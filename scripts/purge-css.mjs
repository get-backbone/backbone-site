#!/usr/bin/env node
/**
 * Purge public/assets/css/main.css against public HTML + JS.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PurgeCSS } from "purgecss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const publicRoot = path.join(root, "public");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collectContentFiles() {
  const html = walk(publicRoot).filter((f) => f.endsWith(".html"));
  const js = walk(path.join(publicRoot, "assets")).filter((f) => f.endsWith(".js"));
  return [...html, ...js];
}

function tailwindishExtractor(content) {
  // Include (), commas, and spaces inside [...] so PurgeCSS keeps rules for classes like
  // min-w-[calc(50vw-563px)], min-h-[min(300px,52vh)], max-h-[min(300px,52vh)].
  return content.match(/[A-Za-z0-9_\-:\[\]\/#.%!(),]+/g) || [];
}

const cssPath = path.join(publicRoot, "assets/css/main.css");
const cssBefore = fs.readFileSync(cssPath, "utf8");

const result = await new PurgeCSS().purge({
  content: collectContentFiles(),
  css: [cssPath],
  defaultExtractor: tailwindishExtractor,
  safelist: {
    standard: [/^aos-/, /^js-/, /^turbo-/, /^svg-/, /^stimulus-/, /^theme-/],
    deep: [/^\[.*\]$/, /autofill/],
    greedy: [/:[a-z-]+$/],
  },
});

const out = result[0].css;
fs.writeFileSync(cssPath, out, "utf8");
console.log(
  `PurgeCSS: ${cssBefore.length} → ${out.length} bytes (${Math.round((1 - out.length / cssBefore.length) * 100)}% reduction)`,
);
