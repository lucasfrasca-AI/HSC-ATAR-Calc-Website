import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import site from "./content/site.json" with { type: "json" };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Fills index.html from content/site.json, including a static fallback that
// stays readable if the bundle never runs. React replaces it on mount.
function contentHtml(): Plugin {
  return {
    name: "content-html",
    transformIndexHtml(html) {
      const fallback =
        `<main class="fallback"><h1>${esc(site.meta.title)}</h1>` +
        `<p>${esc(site.noJs)}</p><p><small>${esc(site.footer.disclaimer)}</small></p></main>`;
      return html
        .replace("%LANG%", esc(site.meta.lang))
        .replace("%TITLE%", esc(site.meta.title))
        .replace("%DESCRIPTION%", esc(site.meta.description))
        .replace("<!--FALLBACK-->", fallback);
    },
  };
}

// Records which source modules ended up in which chunk, so check-budget can
// tell when a must-be-lazy module has been merged into the critical path.
function chunkMap(): Plugin {
  return {
    name: "chunk-map",
    apply: "build",
    writeBundle(_opts, bundle) {
      const map: Record<string, string[]> = {};
      for (const [file, out] of Object.entries(bundle))
        if (out.type === "chunk") map[file] = Object.keys(out.modules).map((id) => id.replace(process.cwd() + "/", ""));
      mkdirSync(".build-meta", { recursive: true });
      writeFileSync(".build-meta/chunks.json", JSON.stringify(map, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [contentHtml(), chunkMap(), react(), tailwindcss()],
  // Never inline assets as data: URIs; the CSP has no data: source.
  build: { assetsInlineLimit: 0, sourcemap: false },
});
