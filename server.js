// The Winding Gallery — tiny local server.
// Usage:  node server.js [photo-directory]
//         node server.js --dir=~/Pictures/landscapes --port=4173
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// Resolve three through Node's module resolution — when this package is
// installed from npm, three is hoisted to a *sibling* node_modules, not
// nested inside ours, so a hardcoded ROOT/node_modules path would miss it.
const THREE_BUILD = path.dirname(createRequire(import.meta.url).resolve('three'));
const THREE_ADDONS = path.join(THREE_BUILD, '..', 'examples', 'jsm');

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

export function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Recursively collect images under `dir` (sorted, dotfiles skipped).
export async function scanPhotos(dir, base = dir, depth = 0, out = []) {
  if (depth > 6 || out.length >= 5000) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      await scanPhotos(full, base, depth + 1, out);
    } else if (IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
      const rel = path.relative(base, full);
      out.push({
        name: path.basename(e.name, path.extname(e.name)),
        src: '/photos/' + rel.split(path.sep).map(encodeURIComponent).join('/'),
      });
    }
  }
  return out;
}

// Resolve a URL sub-path safely inside a root directory (no traversal).
export function safeJoin(root, urlSubPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlSubPath);
  } catch {
    return null;
  }
  const resolved = path.resolve(root, '.' + path.sep + decoded);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Build (but do not start) the gallery's HTTP server.
export function createGalleryServer(photoDir) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/photos') {
      const photos = await scanPhotos(photoDir);
      return send(res, 200, JSON.stringify({ dir: photoDir, photos }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    }

    if (p.startsWith('/photos/')) {
      const file = safeJoin(photoDir, p.slice('/photos/'.length));
      if (!file) return send(res, 403, 'Forbidden');
      return streamFile(res, file);
    }

    if (p.startsWith('/vendor/three/')) {
      const file = safeJoin(THREE_BUILD, p.slice('/vendor/three/'.length));
      if (!file) return send(res, 403, 'Forbidden');
      return streamFile(res, file);
    }

    if (p.startsWith('/vendor/three-addons/')) {
      const file = safeJoin(THREE_ADDONS, p.slice('/vendor/three-addons/'.length));
      if (!file) return send(res, 403, 'Forbidden');
      return streamFile(res, file);
    }

    const file = safeJoin(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
    if (!file) return send(res, 403, 'Forbidden');
    return streamFile(res, file);
  });
}

// Parse argv, start the server, print the welcome. Used by bin/cli.js.
export function startFromArgv(argv = process.argv.slice(2)) {
  let photoDir = path.join(process.cwd(), 'photos');
  if (!fs.existsSync(photoDir)) photoDir = path.join(ROOT, 'photos');
  let port = Number(process.env.PORT) || 4173;
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) photoDir = arg.slice(6);
    else if (arg.startsWith('--port=')) port = Number(arg.slice(7));
    else if (!arg.startsWith('-')) photoDir = arg;
  }
  photoDir = path.resolve(expandHome(photoDir));

  const server = createGalleryServer(photoDir);
  server.listen(port, () => {
    console.log('');
    console.log('  ✦ The Winding Gallery');
    console.log(`    path:    http://localhost:${port}`);
    console.log(`    photos:  ${photoDir}`);
    if (!fs.existsSync(photoDir)) {
      console.log('    (that directory does not exist yet — run `npm run samples`');
      console.log('     to conjure placeholder plates, or pass your own directory:');
      console.log('     `winding-gallery ~/Pictures/landscapes`)');
    }
    console.log('');
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startFromArgv();
}
