// Captures the site's gallery screenshots from a live, freshly-served
// gallery. The Pages deploy workflow runs this so the published site
// always shows the current code — no screenshot is committed to the
// repo (issue #12).
//
//   node scripts/capture-site-shots.mjs [--out=_site/screenshots] [--port=4790]
//
// Needs playwright with its chromium browser installed (CI does
// `pnpm add -D playwright && pnpm exec playwright install chromium`);
// it is never a dependency of the published package. Sample plates are
// conjured automatically if `photos/` is missing.

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const OUT = path.resolve(arg('out', '_site/screenshots'));
const PORT = Number(arg('port', 4790));
const WINGS_PORT = PORT + 1;
// scene warm-up before each shot; CI renders on software GL, so generous
const SETTLE = Number(arg('settle', 9000));

// the wings demo tree: the 8 sample plates split into three wings, so
// the waygate and map shots have wings to show. `?auto&s=44.5` lands at
// the FELLS waygate with this split — the site caption names it.
const WINGS = {
  coast: ['aurora-over-the-frozen-firth', 'moonrise-over-still-water',
    'storm-light-on-the-fells'],
  fells: ['ember-peaks-at-nightfall', 'mist-in-the-silver-birches',
    'the-green-marches'],
  vales: ['amber-dusk-over-the-vale', 'the-old-forest-road'],
};

// every screenshot the README and site show. Viewpoints are load-bearing:
// docs/index.html captions name the beheld plate and the waygate's wing.
const SHOTS = [
  { name: 'the-path', q: '?auto&s=140' },
  { name: 'hero-far', q: '?auto&s=90&yaw=35' },
  { name: 'vista', q: '?auto&s=120&yaw=50' },
  { name: 'lantern', q: '?auto&s=40&yaw=35' },
  { name: 'plate-amber', q: '?auto&s=5&yaw=-40' },
  { name: 'plate-aurora', q: '?auto&s=21.5&yaw=42' },
  // behold/tour play out in real time: wait until the view is beholding
  { name: 'behold', q: '?auto&s=24&behold', mode: 'inspect', settle: 4000 },
  { name: 'keepers-tour', q: '?auto&tour', mode: 'inspect', settle: 2500 },
  { name: 'veil', q: '' },
  { name: 'waygate', q: '?auto&s=44.5', wings: true },
  { name: 'wayfarers-map', q: '?auto&s=90&yaw=35', wings: true, key: 'KeyM' },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)));
  });
}

async function ready(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server at ${url} never came up`);
}

const exists = (p) => stat(p).then(() => true, () => false);

async function main() {
  if (!await exists(path.join(ROOT, 'photos'))) {
    await run(process.execPath, ['scripts/make-sample-photos.js']);
  }
  await mkdir(OUT, { recursive: true });

  const wingsDir = await mkdtemp(path.join(tmpdir(), 'winding-wings-'));
  for (const [wing, names] of Object.entries(WINGS)) {
    await mkdir(path.join(wingsDir, wing));
    for (const n of names) {
      await cp(path.join(ROOT, 'photos', `${n}.png`),
        path.join(wingsDir, wing, `${n}.png`));
    }
  }

  const servers = [
    spawn(process.execPath, ['bin/cli.js', '--dir=photos', `--port=${PORT}`],
      { cwd: ROOT, stdio: 'ignore' }),
    spawn(process.execPath, ['bin/cli.js', `--dir=${wingsDir}`, `--port=${WINGS_PORT}`],
      { cwd: ROOT, stdio: 'ignore' }),
  ];
  let browser = null;
  try {
    await ready(`http://localhost:${PORT}/api/photos`);
    await ready(`http://localhost:${WINGS_PORT}/api/photos`);

    // software-GL flags so WebGL renders on GPU-less CI runners
    browser = await chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

    for (const shot of SHOTS) {
      const t0 = Date.now();
      const port = shot.wings ? WINGS_PORT : PORT;
      await page.goto(`http://localhost:${port}/${shot.q}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.__winding === 'function',
        null, { timeout: 60000 });
      if (shot.mode) {
        await page.waitForFunction((m) => window.__winding().mode === m,
          shot.mode, { timeout: 180000 });
      }
      await page.waitForTimeout(shot.settle ?? SETTLE);
      if (shot.key) {
        await page.keyboard.press(shot.key);
        await page.waitForTimeout(2000);
      }
      const file = path.join(OUT, `${shot.name}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
      console.log(`  ✦ ${shot.name}.jpg  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } finally {
    if (browser) await browser.close();
    for (const s of servers) s.kill();
    await rm(wingsDir, { recursive: true, force: true });
  }
  console.log(`${SHOTS.length} screenshots → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
