/**
 * Brings Verity (a browser-only app, github.com/franklinpetra/verity) into this site at /verity.
 *
 *   node scripts/sync-verity.mjs [path/to/verity]   # default: ~/Documents/Projects/verity
 *
 * Copies Verity's page, scripts, styles, icons and document readers into public/verity/,
 * then makes three small changes to its page: a <base href="/verity/"> so its relative paths
 * resolve here, the three-room switcher (The Discussion, Verity, The Clock), and prefill.js, which fills
 * the decision box from ?q= so a question linked from elsewhere opens ready to run. Verity's own
 * strict content policy is kept, with base-uri relaxed to 'self' to allow that <base>.
 * Re-run after changing Verity.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(process.argv[2] ?? join(homedir(), "Documents/Projects/verity"));
const target = resolve(import.meta.dirname, "../public/verity");
if (!existsSync(join(source, "index.html"))) {
  console.error(`No Verity index.html at ${source}`);
  process.exit(1);
}

const SKIP = new Set([".git", ".github", "node_modules", "README.md", "vercel.json", ".DS_Store", ".gitignore"]);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(source)) {
  if (SKIP.has(entry) || entry.startsWith(".")) continue;
  cpSync(join(source, entry), join(target, entry), { recursive: true });
}

const pagePath = join(target, "index.html");
let page = readFileSync(pagePath, "utf8");
const replace = (from, to, label) => {
  if (!page.includes(from)) throw new Error(`Verity's page changed: couldn't find ${label}`);
  page = page.replace(from, to);
};
replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    <base href="/verity/" />', "the charset meta");
replace("base-uri 'none'", "base-uri 'self'", "base-uri in the content policy");
replace(
  '<a class="wordmark" href="./" id="wordmark">Verity</a>',
  '<a class="wordmark" href="./" id="wordmark">Verity</a>\n      ' +
    '<nav class="room-switch" aria-label="Rooms"><a href="/">The Discussion</a>' +
    '<a href="/verity" aria-current="page">Verity</a><a href="/clock">The Clock</a></nav>',
  "the wordmark",
);
replace(
  '<script src="app.js" type="module"></script>',
  '<script src="app.js" type="module"></script>\n    <script src="prefill.js" type="module"></script>',
  "the app script",
);
writeFileSync(pagePath, page);

writeFileSync(
  join(target, "prefill.js"),
  `// Added by this site: a question linked from elsewhere arrives as ?q=.
const question = new URLSearchParams(location.search).get("q");
const box = document.getElementById("decision");
if (question && box && !box.value) {
  box.value = question.slice(0, Number(box.maxLength) > 0 ? Number(box.maxLength) : 4000);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}
`,
);

const cssPath = join(target, "styles.css");
writeFileSync(
  cssPath,
  `${readFileSync(cssPath, "utf8")}
/* Added by this site: the three rooms, centred in the header, as in the other rooms. */
.top {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) auto minmax(max-content, 1fr);
}
.top .topnav {
  justify-self: end;
}
.room-switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}
.room-switch a {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  color: var(--ink-soft);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.room-switch a:hover {
  color: var(--ink);
}
.room-switch a:focus-visible {
  outline: 2px solid #1c6b5c;
  outline-offset: 1px;
}
.room-switch a[aria-current="page"] {
  color: #ffffff;
  background: #1c6b5c;
}
@media (max-width: 1040px) {
  .top {
    grid-template-columns: auto 1fr;
  }
  .room-switch {
    grid-row: 2;
    grid-column: 1 / -1;
    justify-self: center;
  }
}
@media (max-width: 420px) {
  .room-switch a {
    padding: 0 11px;
    font-size: 13px;
  }
}
`,
);
console.log(`Verity copied from ${source} to public/verity`);
