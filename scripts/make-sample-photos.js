// Conjures a handful of procedural landscape "plates" into ./photos
// so the gallery has something to hang before you point it at real photos.
// Zero dependencies: writes PNGs by hand via zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'photos');
fs.mkdirSync(OUT, { recursive: true });

// ── minimal PNG encoder ─────────────────────────────────────────────
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePng(file, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// ── tiny painting toolkit ───────────────────────────────────────────
const W = 1400, H = 900;
function lerp(a, b, t) { return a + (b - a) * t; }
function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function fbm(x, seed) {
  return (
    Math.sin(x * 0.008 + seed) * 0.55 +
    Math.sin(x * 0.021 + seed * 2.7) * 0.3 +
    Math.sin(x * 0.057 + seed * 5.1) * 0.15
  );
}
function paint(scene) {
  const buf = Buffer.alloc(W * H * 3);
  const put = (x, y, c) => {
    const i = (y * W + x) * 3;
    buf[i] = Math.max(0, Math.min(255, c[0]));
    buf[i + 1] = Math.max(0, Math.min(255, c[1]));
    buf[i + 2] = Math.max(0, Math.min(255, c[2]));
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      put(x, y, scene(x, y));
    }
  }
  return buf;
}
function ridge(x, base, amp, seed) { return base + fbm(x, seed) * amp; }
function sun(x, y, cx, cy, r, col, sky) {
  const d = Math.hypot(x - cx, y - cy);
  if (d < r) return col;
  const glow = Math.exp(-(((d - r) / (r * 1.8)) ** 2));
  return mixc(sky, col, glow * 0.7);
}
function stars(x, y, c) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  const f = h - Math.floor(h);
  return f > 0.9985 ? [235, 238, 255] : c;
}

// ── the eight plates ────────────────────────────────────────────────
const plates = {
  'amber-dusk-over-the-vale': (x, y) => {
    const t = y / H;
    let sky = mixc([252, 168, 84], [64, 42, 86], 1 - t);
    sky = sun(x, y, W * 0.62, H * 0.52, 46, [255, 236, 190], sky);
    const m1 = ridge(x, H * 0.55, 60, 3), m2 = ridge(x, H * 0.7, 80, 8);
    if (y > m2) return mixc([38, 24, 44], [16, 10, 22], (y - m2) / (H - m2));
    if (y > m1) return mixc([92, 52, 80], [50, 30, 56], (y - m1) / (H - m1));
    return sky;
  },
  'moonrise-over-still-water': (x, y) => {
    const t = y / H;
    let sky = mixc([26, 32, 68], [8, 10, 26], 1 - t);
    sky = stars(x, y, sky);
    sky = sun(x, y, W * 0.38, H * 0.3, 38, [240, 238, 220], sky);
    const water = H * 0.62;
    if (y > water) {
      const ry = water * 2 - y + Math.sin(x * 0.08 + y * 0.4) * 6;
      const refl = ry > 0 && ry < water ? sun(x, ry, W * 0.38, H * 0.3, 38, [240, 238, 220], mixc([26, 32, 68], [8, 10, 26], 1 - ry / H)) : [10, 12, 30];
      return mixc(refl, [6, 8, 20], 0.45 + 0.2 * Math.sin(x * 0.05 + y * 0.3));
    }
    const m = ridge(x, H * 0.58, 40, 12);
    if (y > m) return [14, 14, 30];
    return sky;
  },
  'the-green-marches': (x, y) => {
    const t = y / H;
    let sky = mixc([196, 220, 232], [120, 158, 196], 1 - t);
    const hills = [
      [H * 0.5, 50, 4, [96, 128, 88]],
      [H * 0.62, 60, 9, [72, 106, 64]],
      [H * 0.78, 70, 15, [46, 76, 42]],
    ];
    for (const [base, amp, seed, col] of hills.reverse()) {
      if (y > ridge(x, base, amp, seed)) return col.map((c) => c * (1 - t * 0.25));
    }
    return sky;
  },
  'storm-light-on-the-fells': (x, y) => {
    const t = y / H;
    let sky = mixc([120, 124, 138], [52, 56, 72], 1 - t);
    const shaft = Math.exp(-(((x - W * 0.55 - (y * 0.2)) / 90) ** 2));
    sky = mixc(sky, [222, 208, 170], shaft * 0.5 * (1 - t));
    const m1 = ridge(x, H * 0.5, 90, 21), m2 = ridge(x, H * 0.72, 60, 27);
    if (y > m2) return mixc([44, 46, 40], [24, 26, 22], (y - m2) / (H - m2));
    if (y > m1) {
      const lit = shaft * 0.6;
      return mixc([70, 72, 78], [150, 138, 104], lit);
    }
    return sky;
  },
  'aurora-over-the-frozen-firth': (x, y) => {
    const t = y / H;
    let sky = stars(x, y, mixc([14, 22, 46], [4, 6, 18], 1 - t));
    const band = Math.exp(-(((y - (H * 0.3 + fbm(x, 6) * 90)) / 70) ** 2));
    sky = mixc(sky, [72, 220, 150], band * 0.65);
    const band2 = Math.exp(-(((y - (H * 0.42 + fbm(x, 11) * 70)) / 40) ** 2));
    sky = mixc(sky, [130, 120, 230], band2 * 0.4);
    const m = ridge(x, H * 0.7, 50, 31);
    if (y > m) return mixc([196, 210, 224], [120, 138, 160], (y - m) / (H - m));
    return sky;
  },
  'the-old-forest-road': (x, y) => {
    const t = y / H;
    let sky = mixc([240, 214, 150], [170, 190, 160], 1 - t);
    sky = sun(x, y, W * 0.5, H * 0.34, 30, [255, 244, 200], sky);
    for (let k = 0; k < 5; k++) {
      const px = (Math.sin(k * 37.7) * 0.5 + 0.5) * W;
      const w = 26 + k * 8;
      if (Math.abs(x - px) < w && y > H * (0.18 + k * 0.04)) {
        return mixc([40, 52, 34], [14, 20, 12], k / 5);
      }
    }
    const m = ridge(x, H * 0.66, 30, 41);
    if (y > m) return mixc([86, 74, 48], [40, 34, 22], (y - m) / (H - m));
    return sky;
  },
  'ember-peaks-at-nightfall': (x, y) => {
    const t = y / H;
    let sky = stars(x, y, mixc([70, 32, 52], [16, 8, 26], 1 - t));
    const m1 = ridge(x, H * 0.48, 110, 51);
    const m2 = ridge(x, H * 0.68, 90, 57);
    if (y > m2) return [18, 10, 16];
    if (y > m1) {
      const rim = Math.exp(-(y - m1) / 14);
      return mixc([48, 22, 34], [255, 120, 60], rim * 0.8);
    }
    return sky;
  },
  'mist-in-the-silver-birches': (x, y) => {
    const t = y / H;
    let base = mixc([214, 220, 226], [150, 162, 172], 1 - t);
    for (let k = 0; k < 9; k++) {
      const px = ((Math.sin(k * 91.3) * 0.5 + 0.5) * 1.1 - 0.05) * W;
      const w = 8 + (k % 3) * 5;
      const depth = k / 9;
      if (Math.abs(x - px) < w && y > H * (0.05 + depth * 0.1)) {
        const bark = Math.sin(y * 0.15 + k) > 0.82 ? [60, 62, 64] : [206, 204, 196];
        return mixc(bark, base, depth * 0.65);
      }
    }
    const m = H * 0.8 + fbm(x, 71) * 20;
    if (y > m) return mixc([120, 126, 118], [90, 96, 90], (y - m) / (H - m));
    return base;
  },
};

for (const [name, scene] of Object.entries(plates)) {
  const file = path.join(OUT, `${name}.png`);
  process.stdout.write(`  ✦ painting ${name} … `);
  writePng(file, W, H, paint(scene));
  console.log('done');
}
console.log(`\n  ${Object.keys(plates).length} plates hang ready in ${OUT}\n`);
