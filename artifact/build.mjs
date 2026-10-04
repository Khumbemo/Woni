/**
 * Builds a Claude Artifact preview of Woni into dist-artifact/.
 *
 *   npm run build:artifact
 *
 * Same app as `npm run build`, with relative asset paths, the artifact
 * adapter (artifact/shim.js) loaded after the app, and index.html reduced to
 * the page content the Artifact publisher wraps in its own document skeleton.
 */
import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-artifact');

await build({ root, base: './', logLevel: 'warn', build: { outDir, emptyOutDir: true } });

fs.copyFileSync(path.join(root, 'artifact', 'shim.js'), path.join(outDir, 'shim.js'));

// The PWA service worker can't run inside the Artifact viewer.
for (const f of fs.readdirSync(outDir)) {
  if (/^(sw\.js|workbox-.*\.js|manifest\.(json|webmanifest)|registerSW\.js)$/.test(f)) fs.rmSync(path.join(outDir, f));
}

const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
const bodyClass = (html.match(/<body[^>]*class="([^"]*)"/i) || [])[1] || '';

const keptHead = head
  .split('\n')
  .filter(line => !/<meta (charset|name="viewport")|rel="manifest"|<title>|registerSW/.test(line))
  .join('\n')
  .trim();

const page = `<title>Woni</title>
${keptHead}
${body.trim()}
<script>document.body.classList.add(${JSON.stringify(bodyClass)});</script>
<script type="module" src="./shim.js"></script>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), page);

const files = [];
const walk = dir => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f !== 'index.html' || dir !== outDir) files.push(path.relative(outDir, p));
  }
};
walk(outDir);
console.log(JSON.stringify({ page: 'dist-artifact/index.html', files }, null, 2));
