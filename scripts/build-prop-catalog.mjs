// Measures every model in src/client/public/models and writes their bounding
// boxes to src/shared/models.generated.json, so the server can use real
// collision sizes without loading 3D files. Run with `npm run props`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const modelsDir = path.join(root, 'src/client/public/models');

const models = [];
for (const dir of fs.readdirSync(modelsDir)) {
  const full = path.join(modelsDir, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full)) if (f.endsWith('.gltf')) models.push(`${dir}/${f.slice(0, -5)}`);
}

const types = { '.js': 'text/javascript', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.html': 'text/html' };
const page = `<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
window.measure = async (list) => {
  const out = {};
  for (const m of list) {
    const g = await loader.loadAsync('/src/client/public/models/' + m + '.gltf');
    const b = new THREE.Box3().setFromObject(g.scene);
    const r = (n) => Math.round(n * 1000) / 1000;
    out[m] = { size: [r(b.max.x - b.min.x), r(b.max.y - b.min.y), r(b.max.z - b.min.z)], center: [r((b.max.x + b.min.x) / 2), r(b.min.y), r((b.max.z + b.min.z) / 2)] };
  }
  return out;
};
window.ready = true;
</script>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const p = await browser.newPage();
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction('window.ready === true');
const result = await p.evaluate((list) => window.measure(list), models.sort());
await browser.close();
server.close();
fs.writeFileSync(path.join(root, 'src/shared/models.generated.json'), JSON.stringify(result, null, 1) + '\n');
console.log(`Measured ${Object.keys(result).length} models`);
