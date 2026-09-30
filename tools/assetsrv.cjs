// Dev-only helper for tools/convert.html: serves source assets from ASSET_DIR (with CORS) and saves what the
// converter posts to /save/<name> into public/models/.   node tools/assetsrv.cjs <asset dir>
const http = require('http');
const fs = require('fs');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(__dirname, '../public/models');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.obj': 'text/plain', '.mtl': 'text/plain', '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary' };

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && url.startsWith('/save/')) {
    const name = path.basename(url.slice(6));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(path.join(name.startsWith('shot-') ? ASSETS : OUT, name), buf);
      console.log('saved', name, (buf.length / 1e6).toFixed(1), 'MB');
      res.end('ok');
    });
    return;
  }
  const file = path.join(ASSETS, url);
  if (!file.startsWith(ASSETS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(5199, () => console.log('asset server on 5199, serving', ASSETS));
