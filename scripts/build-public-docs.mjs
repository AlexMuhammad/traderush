import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const docsDir = path.join(root, "docs");
const outDir = path.join(root, "public-docs");

const pages = [
  ["Getting started", "Trade Rush", "index.mdx"],
  ["Introduction", "Problem statement", "introduction/problem.mdx"],
  ["Introduction", "Our solution", "introduction/solution.mdx"],
  ["Overview", "How it works", "overview/how-it-works.mdx"],
  ["Overview", "System architecture", "overview/architecture.mdx"],
  ["Overview", "User roles", "overview/user-roles.mdx"],
  ["Features", "Duels", "features/duels.mdx"],
  ["Features", "Rooms", "features/rooms.mdx"],
  ["Features", "Book trading", "features/book-trading.mdx"],
  ["Features", "Network switching", "features/network-switching.mdx"],
  ["Smart contracts", "Architecture", "contracts/overview.mdx"],
  ["Smart contracts", "Addresses", "contracts/addresses.mdx"],
  ["Smart contracts", "Functions", "contracts/functions.mdx"],
  ["Technical", "Tech stack", "technical/tech-stack.mdx"],
  ["Technical", "System flow", "technical/system-flow.mdx"],
  ["Technical", "API integration", "technical/api-integration.mdx"],
  ["Resources", "Hackathon notes", "resources/hackathon-notes.mdx"],
  ["Resources", "Glossary", "resources/glossary.mdx"],
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseTable(lines, start) {
  const header = lines[start].split("|").slice(1, -1).map((x) => x.trim());
  let i = start + 2;
  const rows = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    rows.push(lines[i].split("|").slice(1, -1).map((x) => x.trim()));
    i++;
  }
  const html = `<table><thead><tr>${header.map((h) => `<th>${inlineMarkdown(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return [html, i - 1];
}

function mdxToHtml(source) {
  const lines = source
    .replace(/> ## Documentation Index[\s\S]*?before exploring further\.\n\n/, "")
    .replace(/<CardGroup[\s\S]*?<\/CardGroup>/g, "")
    .replace(/<CodeGroup>[\s\S]*?<\/CodeGroup>/g, "")
    .replace(/<Note>/g, '<div class="callout note">')
    .replace(/<\/Note>/g, "</div>")
    .replace(/<Warning>/g, '<div class="callout warning">')
    .replace(/<\/Warning>/g, "</div>")
    .replace(/<Info>/g, '<div class="callout info">')
    .replace(/<\/Info>/g, "</div>")
    .split("\n");

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      out.push(`<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:-]+\|/.test(lines[i + 1])) {
      const [html, end] = parseTable(lines, i);
      out.push(html);
      i = end;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      out.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(`<li>${inlineMarkdown(lines[i].slice(2))}</li>`);
        i++;
      }
      i--;
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^<\/?div/.test(line.trim())) {
      out.push(line.trim());
      continue;
    }
    out.push(`<p>${inlineMarkdown(line.trim())}</p>`);
  }
  return out.join("");
}

const groupedNav = pages.reduce((acc, [group, title, file]) => {
  if (!acc.has(group)) acc.set(group, []);
  acc.get(group).push({ title, id: slugify(file.replace(/\.mdx$/, "")) });
  return acc;
}, new Map());

await mkdir(outDir, { recursive: true });

const sections = [];
for (const [, title, file] of pages) {
  const source = await readFile(path.join(docsDir, file), "utf8");
  const id = slugify(file.replace(/\.mdx$/, ""));
  sections.push(`<section id="${id}" class="doc-section">${mdxToHtml(source)}</section>`);
}

const nav = [...groupedNav.entries()].map(([group, items]) => `<div class="nav-group"><p>${group}</p>${items.map((item) => `<a href="#${item.id}">${item.title}</a>`).join("")}</div>`).join("");

const css = `
:root{color-scheme:dark;--bg:#08111f;--panel:#0d1b2f;--line:#213247;--text:#e7eef8;--muted:#97a6ba;--brand:#14b8a6;--brand2:#f59e0b;--code:#101827}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#08111f 0%,#101827 52%,#0b1220 100%);color:var(--text);font:16px/1.65 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#5eead4;text-decoration:none}a:hover{text-decoration:underline}.shell{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);background:rgba(8,17,31,.94);padding:24px}.brand{display:flex;gap:12px;align-items:center;margin-bottom:24px}.brand img{width:36px;height:36px}.brand strong{display:block;font-size:18px}.brand span{display:block;color:var(--muted);font-size:13px}.nav-group{margin:18px 0}.nav-group p{margin:0 0 7px;color:#fbbf24;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.nav-group a{display:block;color:#cbd5e1;padding:5px 0;font-size:14px}.content{max-width:980px;width:100%;padding:56px 42px 96px}.hero{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:28px}.hero h1{font-size:44px;line-height:1.05;margin:0 0 14px}.hero p{color:var(--muted);font-size:18px;max-width:760px}.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.pill{border:1px solid var(--line);background:rgba(20,184,166,.1);color:#ccfbf1;border-radius:999px;padding:6px 10px;font-size:13px}.doc-section{padding:30px 0;border-bottom:1px solid var(--line)}h1{font-size:36px;line-height:1.12;margin:0 0 12px}h2{font-size:25px;margin:34px 0 10px}h3{font-size:19px;margin:24px 0 8px}p,blockquote{max-width:820px}blockquote{margin:0 0 20px;color:#bdd6e7;border-left:3px solid var(--brand);padding-left:14px}table{width:100%;border-collapse:collapse;margin:16px 0 26px;background:rgba(13,27,47,.76);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:table}th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:top}th{color:#f8fafc;background:rgba(20,184,166,.12);font-size:13px}tr:last-child td{border-bottom:0}pre{overflow:auto;background:var(--code);border:1px solid var(--line);border-radius:8px;padding:14px}code{font-family:"SFMono-Regular",Consolas,monospace;background:rgba(148,163,184,.15);padding:.12em .35em;border-radius:4px}pre code{background:none;padding:0}.callout{border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:12px 14px;margin:16px 0;max-width:820px;background:rgba(13,27,47,.86)}.warning{border-left-color:#f97316}.note{border-left-color:#38bdf8}.info{border-left-color:var(--brand)}@media(max-width:860px){.shell{display:block}.sidebar{position:relative;height:auto}.content{padding:34px 20px}.hero h1{font-size:34px}table{display:block;overflow-x:auto;white-space:nowrap}}`
  .replace(/\s+/g, " ")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .trim();

const js = `document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener("click",e=>{const t=document.querySelector(a.getAttribute("href"));if(t){e.preventDefault();t.scrollIntoView({behavior:"smooth",block:"start"});history.replaceState(null,"",a.getAttribute("href"))}}));`;

function minify(value) {
  return value.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
}

const html = minify(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Trade Rush documentation for the Event Contracts Hackathon.">
<title>Trade Rush Docs</title>
<link rel="icon" href="/favicon.svg">
<style>${css}</style>
</head>
<body>
<div class="shell">
<aside class="sidebar">
<div class="brand"><img src="/favicon.svg" alt=""><div><strong>Trade Rush</strong><span>Event Contracts docs</span></div></div>
${nav}
</aside>
<main class="content">
<div class="hero"><h1>Trade Rush Docs</h1><p>Public documentation for run, room, and duel modes on DreamDEX Event Contracts.</p><div class="meta"><span class="pill">Somnia Shannon</span><span class="pill">DreamDEX</span><span class="pill">Hackathon build</span><span class="pill">Minified static deploy</span></div></div>
${sections.join("")}
</main>
</div>
<script>${js}</script>
</body>
</html>`);

await writeFile(path.join(outDir, "index.html"), html);
await writeFile(path.join(outDir, "llms.txt"), await readFile(path.join(docsDir, "llms.txt"), "utf8"));
if (existsSync(path.join(docsDir, "favicon.svg"))) {
  await copyFile(path.join(docsDir, "favicon.svg"), path.join(outDir, "favicon.svg"));
}
