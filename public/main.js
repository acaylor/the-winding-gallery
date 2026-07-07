// ✦ The Winding Gallery ✦
// An endless winding sky-path hung with your photographs.
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-addons/loaders/GLTFLoader.js';
import { EffectComposer } from '/vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/three-addons/postprocessing/OutputPass.js';
import {
  STEP, extendPath as extendPathState, makePathState,
  seededRand, mod, romanize, plateS, nextPlateIndex,
  wingOfPlate, waygateWing, segForPlateAhead,
} from './gallery-math.js';

// ───────────────────────────────────────── constants ──
const SEG_LEN = 16;          // metres of path per generated segment
const PATH_W = 5.6;          // walkable width
const AHEAD = 170;           // metres of path kept built ahead of the walker
const BEHIND = 40;           // metres kept behind
const EYE = 1.7;
const WALK_SPEED = 7.5;
const MAX_LAT = PATH_W / 2 - 0.6;
const TEX_MAX = 2048;

const COL = {
  night: 0x0b0e1c,
  fog: 0x11142a,
  stone: 0x474b5e,
  stoneDark: 0x33374a,
  gold: 0xe0b64a,
  goldDeep: 0xb98a2f,
  flame: 0xffc46b,
  moss: 0x55703a,
};

// colors pushed past 1.0 render as HDR emitters, which is what the bloom
// pass picks out of the frame
function hotColor(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

// ───────────────────────────────────────── the winding path ──
// A heading integrated over gentle overlapping sine curvature, so the
// path wanders forever without ever knotting, climbing slowly into the sky.
// (The integration itself lives in gallery-math.js, where it is testable.)
const pathState = makePathState();
function extendPath(toS) {
  extendPathState(pathState, toS);
}
extendPath(AHEAD + SEG_LEN * 2);

const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function pathPoint(s, out) {
  extendPath(s);
  const pts = pathState.pts;
  const f = Math.max(0, s) / STEP;
  const i = Math.min(Math.floor(f), pts.length - 2);
  _pa.fromArray(pts[i]);
  _pb.fromArray(pts[i + 1]);
  return out.lerpVectors(_pa, _pb, f - i);
}
// pos + unit tangent + unit right-side vector at s
function pathFrame(s, pos, tan, side) {
  pathPoint(s, pos);
  pathPoint(s + 0.8, _p1);
  pathPoint(Math.max(0, s - 0.8), _p0);
  tan.subVectors(_p1, _p0).normalize();
  side.set(-tan.z, 0, tan.x).normalize(); // right of travel, kept level
}

// ───────────────────────────────────────── renderer & scene ──
// ?quality=low keeps the pre-0.4 pipeline: no bloom, no shadows, no mist
const LOW_FX = new URLSearchParams(location.search).get('quality') === 'low';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (!LOW_FX) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COL.fog, 0.0105);

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 2500);

// post: bloom so the flames, moon and wisp genuinely glow (tone mapping
// moves into the OutputPass; the multisampled HDR target keeps the AA)
let composer = null;
if (!LOW_FX) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType, samples: 4,
  });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.55, 0.85));
  composer.addPass(new OutputPass());
}

const MOON_DIR = new THREE.Vector3(-0.4, 0.8, -0.5).normalize();
scene.add(new THREE.HemisphereLight(0x54628f, 0x2a2138, 1.45));
const moonLight = new THREE.DirectionalLight(0x93a9e8, 1.0);
moonLight.position.copy(MOON_DIR);
scene.add(moonLight, moonLight.target);
if (!LOW_FX) {
  // the moon casts shadows within a frustum that follows the walker
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  const sc = moonLight.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
  sc.near = 1; sc.far = 260;
  moonLight.shadow.bias = -0.0004;
  moonLight.shadow.normalBias = 0.35;
}

// a cool fill from the moonless side, so the off-path silhouettes keep
// their shape instead of collapsing to black
const rimLight = new THREE.DirectionalLight(0x5e6fae, 0.5);
rimLight.position.set(0.55, 0.2, 0.6);
scene.add(rimLight);

// Warm lantern-light that travels with the walker
const walkerLight = new THREE.PointLight(COL.flame, 26, 30, 2);
scene.add(walkerLight);

// ───────────────────────────────────────── sky, stars, moon ──
const skyGroup = new THREE.Group();
scene.add(skyGroup);

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vDir;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec3 dir = normalize(vDir);
      float h = dir.y;
      vec3 zenith  = vec3(0.012, 0.016, 0.045);
      vec3 mid     = vec3(0.055, 0.055, 0.13);
      vec3 horizon = vec3(0.16, 0.11, 0.22);
      vec3 col = mix(mid, zenith, smoothstep(0.06, 0.6, h));
      col = mix(horizon, col, smoothstep(-0.06, 0.14, h));
      // faint warm haze low on the horizon, like far-off lantern towns
      col += vec3(0.10, 0.06, 0.02) * exp(-abs(h + 0.02) * 14.0);
      // the great river of stars, a soft clouded band across the night
      float band = abs(dot(dir, normalize(vec3(0.62, 0.34, -0.42))));
      float mw = exp(-band * band * 22.0);
      float cloud = noise(vec2(atan(dir.z, dir.x) * 5.0, dir.y * 7.0));
      cloud = 0.35 + 0.65 * cloud * cloud;
      col += vec3(0.055, 0.06, 0.095) * mw * cloud * smoothstep(0.0, 0.25, h);
      // dither, or the long gradients ribbon into visible bands
      col += (hash(gl_FragCoord.xy) - 0.5) / 160.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
skyGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 20), skyMat));

// stars
{
  const N = 1600;
  const pos = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const size = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.96 + 0.03;
    v.normalize().multiplyScalar(1500);
    pos.set([v.x, v.y, v.z], i * 3);
    phase[i] = Math.random() * Math.PI * 2;
    size[i] = 1.5 + Math.random() * 3.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aPhase; attribute float aSize;
      varying float vTw;
      uniform float uTime;
      void main() {
        vTw = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }`,
    fragmentShader: `
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vTw;
        gl_FragColor = vec4(0.85, 0.88, 1.0, a);
      }`,
  });
  skyGroup.add(new THREE.Points(g, starMat));
  skyGroup.userData.starMat = starMat;
}

// moon + halo
{
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(46, 40),
    new THREE.MeshBasicMaterial({ color: hotColor(0xf2ecd8, 1.35), fog: false })
  );
  const dir = new THREE.Vector3(-0.42, 0.5, -0.75).normalize();
  moon.position.copy(dir).multiplyScalar(1400);
  moon.lookAt(0, 0, 0);
  skyGroup.add(moon);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture('#f2ecd8'), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.setScalar(340);
  halo.position.copy(moon.position).multiplyScalar(0.985);
  skyGroup.add(halo);
}

// bake the night into an environment map, so gold frames and lantern
// metal have a sky to reflect — plus a few warm glints standing in for
// the lanterns along the path
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 20), skyMat));
  const moonBall = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff6dd })
  );
  moonBall.position.set(-0.42, 0.5, -0.75).normalize().multiplyScalar(44);
  envScene.add(moonBall);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffb45a });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), glintMat);
    glint.position.set(Math.cos(a) * 30, -1.5 + (i % 3), Math.sin(a) * 30);
    envScene.add(glint);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.09).texture;
  scene.environmentIntensity = 0.38;
  pmrem.dispose();
}

function makeGlowTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const g2 = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  g2.addColorStop(0, 'rgba(255,255,255,0.9)');
  g2.addColorStop(0.25, hexToRgba(color, 0.55));
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = g2;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ───────────────────────────────────────── shared materials & geometry ──
// Real CC0 surfaces (ambientCG) — see ASSETS.md for provenance.
const texLoader = new THREE.TextureLoader();
function surface(url, { srgb = false, repeat = null } = {}) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(...repeat);
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return t;
}
const pavingColor = surface('/assets/paving-color.jpg', { srgb: true });
const pavingNormal = surface('/assets/paving-normal.jpg');
const pavingAO = surface('/assets/paving-ao.jpg');
const pavingRough = surface('/assets/paving-rough.jpg');
const rockColor = surface('/assets/rock-color.jpg', { srgb: true });
const rockNormal = surface('/assets/rock-normal.jpg');
const rockAO = surface('/assets/rock-ao.jpg');
const barkColor = surface('/assets/bark-color.jpg', { srgb: true });
const barkNormal = surface('/assets/bark-normal.jpg');

const floorMat = new THREE.MeshStandardMaterial({
  map: pavingColor, normalMap: pavingNormal,
  aoMap: pavingAO, aoMapIntensity: 0.85,
  roughnessMap: pavingRough, roughness: 1,
  vertexColors: true,
});
const stoneMat = new THREE.MeshStandardMaterial({
  map: rockColor, normalMap: rockNormal, aoMap: rockAO,
  color: 0xbdc2d6, roughness: 1,
});
const stoneDarkMat = new THREE.MeshStandardMaterial({
  map: rockColor, normalMap: rockNormal, aoMap: rockAO,
  color: 0x7d8298, roughness: 1,
});
const skirtMat = new THREE.MeshStandardMaterial({
  map: rockColor, normalMap: rockNormal, color: 0x6a6e84, roughness: 1, side: THREE.DoubleSide,
});
const barkMat = new THREE.MeshStandardMaterial({
  map: barkColor, normalMap: barkNormal, roughness: 1,
});
const goldMat = new THREE.MeshStandardMaterial({
  color: COL.goldDeep, metalness: 0.85, roughness: 0.32, emissive: 0x2c1f06,
});
const flameMat = new THREE.MeshBasicMaterial({ color: hotColor(COL.flame, 2.2) });
const mossMat = new THREE.MeshStandardMaterial({ color: COL.moss, roughness: 1, flatShading: true });

const glowTex = makeGlowTexture('#ffc46b');
const curbGeo = new THREE.BoxGeometry(0.55, 0.3, 1.15);
const gatePillarGeo = new THREE.BoxGeometry(0.9, 3.6, 0.9);
const gateCapGeo = new THREE.BoxGeometry(1.2, 0.28, 1.2);
const gateLintelGeo = new THREE.BoxGeometry(PATH_W + 2.2, 0.75, 1.0);
const gateNameGeo = new THREE.PlaneGeometry(4.8, 0.9);
const plinthGeo = new THREE.CylinderGeometry(0.5, 0.72, 1.15, 6);
const capGeo = new THREE.CylinderGeometry(0.62, 0.5, 0.18, 6);
const postGeo = new THREE.CylinderGeometry(0.07, 0.1, 2.7, 6);
const cageGeo = new THREE.OctahedronGeometry(0.2);
const flameGeo = new THREE.OctahedronGeometry(0.09);

// a few pre-jittered floating-rock shapes
const rockGeos = [];
for (let v = 0; v < 4; v++) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) * (0.75 + Math.random() * 0.55),
      p.getY(i) * (0.55 + Math.random() * 0.4),
      p.getZ(i) * (0.75 + Math.random() * 0.55));
  }
  g.computeVertexNormals();
  rockGeos.push(g);
}
const pineGeo = new THREE.ConeGeometry(0.55, 1.6, 6);
const trunkGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.5, 5);

// ───────────────────────────────────────── the deep distance ──
// Far islands adrift on the horizon — some carrying a lantern-town
// spark — so the vista has landmarks instead of empty fog.
{
  const isleMat = new THREE.MeshBasicMaterial({ color: 0x10122a, fog: false });
  const isleRand = seededRand(4099);
  for (let i = 0; i < 10; i++) {
    const a = isleRand() * Math.PI * 2;
    const d = 1050 + isleRand() * 320;
    const isle = new THREE.Mesh(rockGeos[i % rockGeos.length], isleMat);
    isle.position.set(Math.cos(a) * d, (-0.015 + isleRand() * 0.05) * d, Math.sin(a) * d);
    isle.scale.set(36 + isleRand() * 60, 20 + isleRand() * 26, 36 + isleRand() * 60);
    isle.rotation.y = isleRand() * Math.PI * 2;
    skyGroup.add(isle);
    if (isleRand() < 0.6) {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture('#ffc46b'), color: hotColor(COL.flame, 1.3),
        transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      spark.scale.setScalar(30);
      spark.position.copy(isle.position);
      spark.position.y += isle.scale.y * 0.7;
      skyGroup.add(spark);
    }
  }
}

// an aurora, breathing slowly over one shoulder of the night
const auroraMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 p = position;
      // drape the ribbon so it hangs like a curtain, not a billboard
      p.y += sin(uv.x * 9.4) * 60.0;
      p.z += sin(uv.x * 5.1 + 1.7) * 130.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      // slow vertical curtains, folding sideways over minutes
      float n = noise(vec2(vUv.x * 11.0 + uTime * 0.05, uTime * 0.03));
      float n2 = noise(vec2(vUv.x * 23.0 - uTime * 0.03, 7.0 + uTime * 0.02));
      float curtain = smoothstep(0.25, 0.9, n * 0.7 + n2 * 0.45);
      float body = smoothstep(0.02, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
      // the ribbon must dissolve before its plane runs out
      body *= smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
      vec3 c = mix(vec3(0.10, 0.62, 0.34), vec3(0.16, 0.30, 0.58), vUv.y * 1.4);
      float a = curtain * body * 0.42;
      gl_FragColor = vec4(c * a, a);
    }`,
});
{
  const aurora = new THREE.Mesh(new THREE.PlaneGeometry(2000, 520, 96, 10), auroraMat);
  aurora.position.set(-850, 560, -750);
  aurora.lookAt(0, 180, 0);
  skyGroup.add(aurora);
}

// rune glyphs stamped faintly into the flagstones
const RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᛃ', 'ᛈ', 'ᛞ', 'ᛟ'];
const runeTexes = RUNES.map((r) => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.font = '190px serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e0b64a';
  g.fillText(r, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});

// placeholder shown in a frame while its photograph is conjured
const placeholderTex = (() => {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, '#181b33');
  grad.addColorStop(1, '#0d0f20');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 384);
  g.font = '120px serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(224,182,74,0.35)';
  g.fillText('✦', 256, 220);
  g.font = 'italic 26px Georgia, serif';
  g.fillStyle = 'rgba(233,223,198,0.4)';
  g.fillText('conjuring…', 256, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ───────────────────────────────────────── the lantern (Khronos CC0 model) ──
let lanternProto = null;                                // Group, ground at y=0, arm along +X
const lanternHead = new THREE.Vector3(0, 2.55, 0);      // where the flame hangs, local
function loadLantern() {
  return new Promise((resolve) => {
    new GLTFLoader().load('/assets/lantern-slim.glb', (gltf) => {
      const model = gltf.scene;
      const bbox = new THREE.Box3().setFromObject(model);
      const k = 2.9 / (bbox.max.y - bbox.min.y);
      model.scale.setScalar(k);
      model.position.y = -bbox.min.y * k;
      lanternProto = model;
      // the lantern body hangs from the end of the arm, below the crossbar
      lanternHead.set(bbox.max.x * 0.72 * k, bbox.max.y * 0.62 * k, 0);
      resolve();
    }, undefined, () => resolve()); // fall back to the procedural post
  });
}

// ───────────────────────────────────────── photo textures ──
let photos = [];               // [{name, src, wing}]
let wings = [];                // [{name, start, count}] — contiguous subfolder wings
let worldReady = false;        // don't build segments until the plate list arrives

function wingDisplay(name) {
  return name ? name.replace(/[-_]+/g, ' ') : 'the entrance hall';
}
const texCache = new Map();    // src -> { promise, tex, refs }
let loadQueue = [];
let loadsActive = 0;

function acquireTexture(src) {
  let entry = texCache.get(src);
  if (!entry) {
    entry = { refs: 0, tex: null, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      loadQueue.push({ src, entry, resolve, reject });
      pumpLoads();
    });
    texCache.set(src, entry);
  }
  entry.refs++;
  return entry;
}
function releaseTexture(src) {
  const entry = texCache.get(src);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    texCache.delete(src);
    entry.dead = true;
    if (entry.tex) entry.tex.dispose();
  }
}
async function pumpLoads() {
  while (loadsActive < 3 && loadQueue.length) {
    const job = loadQueue.shift();
    loadsActive++;
    loadOne(job).finally(() => { loadsActive--; pumpLoads(); });
  }
}
async function loadOne({ src, entry, resolve, reject }) {
  try {
    const blob = await (await fetch(src)).blob();
    let bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    const maxDim = Math.max(bmp.width, bmp.height);
    if (maxDim > TEX_MAX) {
      const k = TEX_MAX / maxDim;
      const small = await createImageBitmap(bmp, {
        resizeWidth: Math.round(bmp.width * k),
        resizeHeight: Math.round(bmp.height * k),
        resizeQuality: 'high',
      });
      bmp.close();
      bmp = small;
    }
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    if (entry.dead) { tex.dispose(); return resolve(null); }
    entry.tex = tex;
    resolve(tex);
  } catch (err) {
    reject(err);
  }
}

// ───────────────────────────────────────── segments ──
const segments = new Map();   // index -> { group, disposables[], photoSrcs[], bobbers[] }
const photoMeshes = [];       // raycast targets: [{ mesh, seg }]
const _pos = new THREE.Vector3(), _tan = new THREE.Vector3(), _side = new THREE.Vector3();
const _m = new THREE.Matrix4();

function buildSegment(idx) {
  const rand = seededRand(idx * 7919);
  const s0 = idx * SEG_LEN;
  const group = new THREE.Group();
  const seg = { group, disposables: [], photoSrcs: [], bobbers: [], lamps: [], idx };

  // — flagstone floor ribbon, vertex-tinted —
  {
    const rows = Math.round(SEG_LEN / 2) + 1;
    const TILE = 2.6; // metres per paving-texture tile
    const posArr = [], colArr = [], uvArr = [], idxArr = [];
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const s = s0 + r * 2;
      pathFrame(s, _pos, _tan, _side);
      for (let k = 0; k <= 3; k++) {
        const lat = -PATH_W / 2 + (PATH_W * k) / 3;
        posArr.push(
          _pos.x + _side.x * lat,
          _pos.y + (rand() - 0.5) * 0.05,
          _pos.z + _side.z * lat
        );
        // moonlit tint with mild mottling; the paving texture does the rest
        c.setHex(0xb8bdd4).multiplyScalar(0.86 + rand() * 0.28);
        colArr.push(c.r, c.g, c.b);
        uvArr.push(lat / TILE, s / TILE);
      }
    }
    for (let r = 0; r < rows - 1; r++)
      for (let k = 0; k < 3; k++) {
        const a = r * 4 + k;
        idxArr.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    g.setIndex(idxArr);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, floorMat);
    m.receiveShadow = true;
    group.add(m);
    seg.disposables.push(g);

    // underside skirt so the path has visible thickness from below
    const g2 = g.clone();
    const p = g2.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 0.9);
    const m2 = new THREE.Mesh(g2, skirtMat);
    group.add(m2);
    seg.disposables.push(g2);
  }

  // — weathered curb stones along both edges (instanced) —
  {
    const per = Math.floor(SEG_LEN / 1.6);
    const inst = new THREE.InstancedMesh(curbGeo, stoneDarkMat, per * 2);
    inst.castShadow = inst.receiveShadow = true;
    let n = 0;
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    for (let sideSign = -1; sideSign <= 1; sideSign += 2) {
      for (let j = 0; j < per; j++) {
        if (rand() < 0.18) continue; // gaps — the gallery is old
        const s = s0 + j * 1.6 + rand();
        pathFrame(s, _pos, _tan, _side);
        const lat = sideSign * (PATH_W / 2 + 0.15);
        _p0.set(_pos.x + _side.x * lat, _pos.y + 0.1, _pos.z + _side.z * lat);
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _tan);
        sc.setScalar(0.7 + rand() * 0.5);
        _m.compose(_p0, q, sc);
        inst.setMatrixAt(n++, _m);
      }
    }
    inst.count = n;
    group.add(inst);
    seg.disposables.push(inst);
  }

  // — a glowing rune stamped into the flags, sometimes —
  if (rand() < 0.45) {
    const t = runeTexes[Math.floor(rand() * runeTexes.length)];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({
        map: t, transparent: true, opacity: 0.33,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    const s = s0 + 4 + rand() * 8;
    pathFrame(s, _pos, _tan, _side);
    const lat = (rand() - 0.5) * 2.5;
    m.position.set(_pos.x + _side.x * lat, _pos.y + 0.05, _pos.z + _side.z * lat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rand() * Math.PI * 2;
    group.add(m);
    seg.disposables.push(m.geometry, m.material);
  }

  // — the framed photograph on its floating plinth —
  if (photos.length > 0) {
    const sideSign = idx % 2 === 0 ? 1 : -1;
    const sMid = s0 + SEG_LEN * 0.5;
    const photoIdx = mod(idx, photos.length);
    const photo = photos[photoIdx];

    pathFrame(sMid, _pos, _tan, _side);
    const lat = sideSign * (PATH_W / 2 + 1.7);
    const base = new THREE.Vector3(_pos.x + _side.x * lat, _pos.y - 0.15, _pos.z + _side.z * lat);

    const stand = new THREE.Group();
    stand.position.copy(base);
    // face the middle of the path
    stand.lookAt(_pos.x, base.y, _pos.z);
    stand.rotateY((rand() - 0.5) * 0.14);

    const plinth = new THREE.Mesh(plinthGeo, stoneMat);
    plinth.position.y = 0.55;
    const cap = new THREE.Mesh(capGeo, stoneDarkMat);
    cap.position.y = 1.2;
    plinth.castShadow = plinth.receiveShadow = true;
    cap.castShadow = cap.receiveShadow = true;
    stand.add(plinth, cap);

    // frame + photo plane (rescaled to true aspect once loaded)
    const frameGroup = new THREE.Group();
    frameGroup.position.y = 2.55;
    frameGroup.rotation.x = -0.03;
    stand.add(frameGroup);

    const photoMat = new THREE.MeshBasicMaterial({ map: placeholderTex, toneMapped: false });
    const photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), photoMat);
    frameGroup.add(photoMesh);
    seg.disposables.push(photoMesh.geometry, photoMat);

    const border = new THREE.Mesh(boxFrameGeometry(1, 1, 0.14, 0.09), goldMat);
    border.position.z = -0.02;
    border.castShadow = true;
    frameGroup.add(border);
    seg.disposables.push(border.geometry);

    // a soft magical glow behind the plate (a plane, so it never
    // slices through the photo the way a camera-facing sprite would)
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTex, color: 0xd7b46a, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    glow.scale.setScalar(4.6);
    glow.position.z = -0.35;
    frameGroup.add(glow);
    seg.disposables.push(glow.geometry, glow.material);

    const applyAspect = (w, h) => {
      const maxW = 3.3, maxH = 2.5;
      const k = Math.min(maxW / w, maxH / h);
      const W = w * k, H = h * k;
      photoMesh.scale.set(W, H, 1);
      const g = border.geometry;
      border.geometry = boxFrameGeometry(W, H, 0.14, 0.09);
      seg.disposables.push(border.geometry);
      g.dispose();
      glow.scale.set(W + 1.6, H + 1.6, 1);
    };
    applyAspect(3, 2);

    const entry = acquireTexture(photo.src);
    seg.photoSrcs.push(photo.src);
    entry.promise.then((tex) => {
      if (!tex || seg.dead) return;
      photoMat.map = tex;
      photoMat.needsUpdate = true;
      applyAspect(tex.image.width, tex.image.height);
      photoMesh.userData.dims = `${tex.image.width} × ${tex.image.height}`;
    }).catch(() => {});

    // brass plaque with the photograph's name
    const plaque = makePlaque(photo.name);
    plaque.position.set(0, 1.32, 0.12);
    stand.add(plaque);
    seg.disposables.push(plaque.geometry, plaque.material, plaque.material.map);

    photoMesh.userData.photo = photo;
    photoMesh.userData.plate = photoIdx;
    photoMeshes.push({ mesh: photoMesh, segIdx: idx });
    // a soft warm light before the plate, so plinth and frame read at night
    seg.lamps.push({
      x: base.x - _side.x * sideSign * 1.4,
      y: base.y + 1.7,
      z: base.z - _side.z * sideSign * 1.4,
      i: 11, phase: rand() * 9,
    });
    group.add(stand);
  }

  // — lantern on the opposite side —
  {
    const sideSign = idx % 2 === 0 ? -1 : 1;
    const s = s0 + SEG_LEN * (0.3 + rand() * 0.4);
    pathFrame(s, _pos, _tan, _side);
    const lat = sideSign * (PATH_W / 2 - 0.15);
    const lantern = new THREE.Group();
    lantern.position.set(_pos.x + _side.x * lat, _pos.y, _pos.z + _side.z * lat);
    // swing the arm (+X in the model) out over the path
    const dx = _pos.x - lantern.position.x, dz = _pos.z - lantern.position.z;
    lantern.rotation.y = Math.atan2(-dz, dx);

    let headY = 2.75, headX = 0;
    if (lanternProto) {
      const model = lanternProto.clone(true);
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      lantern.add(model);
      headX = lanternHead.x;
      headY = lanternHead.y;
    } else {
      const post = new THREE.Mesh(postGeo, stoneDarkMat);
      post.position.y = 1.35;
      post.castShadow = true;
      const cage = new THREE.Mesh(cageGeo, goldMat);
      cage.position.y = 2.75;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 2.75;
      lantern.add(post, cage, flame);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: hotColor(COL.flame, 1.7), transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(2.6);
    glow.position.set(headX, headY, 0);
    lantern.add(glow);
    seg.disposables.push(glow.material);
    const phase = rand() * 9;
    seg.bobbers.push({ obj: glow, base: headY, amp: 0, flick: glow.material, phase });
    // where a real light may burn, if this lantern is among the nearest
    seg.lamps.push({
      x: lantern.position.x + Math.cos(lantern.rotation.y) * headX,
      y: lantern.position.y + headY,
      z: lantern.position.z - Math.sin(lantern.rotation.y) * headX,
      phase,
    });
    group.add(lantern);
  }

  // — a waygate where a wing begins; a plain stone arch elsewhere —
  const gateWing = waygateWing(idx, photos.length, wings);
  if (gateWing) {
    const s = s0 + 1.4;
    pathFrame(s, _pos, _tan, _side);
    // right-handed basis (side × up = -tan): setFromRotationMatrix expects a
    // pure rotation — a left-handed basis mirrors the geometry and the name
    // plates end up backface-culled
    const basis = _m.makeBasis(_side.clone(), new THREE.Vector3(0, 1, 0), _tan.clone().multiplyScalar(-1));
    const R = PATH_W / 2 + 0.7;
    for (const ss of [-1, 1]) {
      const pillar = new THREE.Mesh(gatePillarGeo, stoneMat);
      pillar.position.set(_pos.x + _side.x * R * ss, _pos.y + 1.8, _pos.z + _side.z * R * ss);
      pillar.quaternion.setFromRotationMatrix(basis);
      pillar.castShadow = pillar.receiveShadow = true;
      const cap = new THREE.Mesh(gateCapGeo, stoneDarkMat);
      cap.position.copy(pillar.position);
      cap.position.y = _pos.y + 3.74;
      cap.quaternion.copy(pillar.quaternion);
      cap.castShadow = true;
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: hotColor(COL.flame, 1.7), transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      flame.scale.setScalar(1.7);
      flame.position.copy(cap.position);
      flame.position.y += 0.45;
      group.add(pillar, cap, flame);
      seg.disposables.push(flame.material);
      const phase = rand() * 9;
      seg.bobbers.push({ obj: flame, base: flame.position.y, amp: 0, flick: flame.material, phase });
      seg.lamps.push({ x: flame.position.x, y: flame.position.y, z: flame.position.z, phase });
    }
    const lintel = new THREE.Mesh(gateLintelGeo, stoneMat);
    lintel.position.set(_pos.x, _pos.y + 4.0, _pos.z);
    lintel.quaternion.setFromRotationMatrix(basis);
    lintel.castShadow = true;
    group.add(lintel);
    // the wing's name, carved on both faces
    // the wing's name, carved on both faces: the basis plane (+Z → -tan)
    // greets the approaching walker; the far face gets the half-turn
    for (const face of [-1, 1]) {
      const plate = new THREE.Mesh(gateNameGeo, gateNameMat(gateWing.name));
      plate.position.set(
        _pos.x + _tan.x * 0.52 * face,
        _pos.y + 4.0,
        _pos.z + _tan.z * 0.52 * face
      );
      plate.quaternion.setFromRotationMatrix(basis);
      if (face > 0) plate.rotateY(Math.PI);
      group.add(plate);
    }
  } else if (idx % 6 === 3) {
    const s = s0 + SEG_LEN * 0.5;
    pathFrame(s, _pos, _tan, _side);
    const R = PATH_W / 2 + 1.3;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R, 0.34, 6, 22, Math.PI), stoneMat);
    // right-handed basis (side × up = -tan) — see the waygate note above;
    // the torus is symmetric, so the old mirrored basis merely got lucky
    _m.makeBasis(_side.clone(), new THREE.Vector3(0, 1, 0), _tan.clone().multiplyScalar(-1));
    arch.quaternion.setFromRotationMatrix(_m);
    arch.position.set(_pos.x, _pos.y + 1.2, _pos.z);
    arch.castShadow = true;
    group.add(arch);
    seg.disposables.push(arch.geometry);
    for (const ss of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), stoneDarkMat);
      pillar.position.set(_pos.x + _side.x * R * ss, _pos.y + 0.6, _pos.z + _side.z * R * ss);
      pillar.castShadow = pillar.receiveShadow = true;
      group.add(pillar);
      seg.disposables.push(pillar.geometry);
    }
  }

  // — floating rocks adrift around the path —
  {
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const s = s0 + rand() * SEG_LEN;
      pathFrame(s, _pos, _tan, _side);
      const lat = (rand() < 0.5 ? -1 : 1) * (9 + rand() * 26);
      const y = _pos.y + (rand() - 0.35) * 16 - 4;
      const rock = new THREE.Mesh(rockGeos[Math.floor(rand() * rockGeos.length)], stoneDarkMat);
      rock.receiveShadow = true;
      rock.position.set(_pos.x + _side.x * lat, y, _pos.z + _side.z * lat);
      rock.scale.setScalar(1 + rand() * 3.2);
      rock.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
      group.add(rock);
      seg.bobbers.push({ obj: rock, base: y, amp: 0.35 + rand() * 0.5, phase: rand() * 9 });

      if (rand() < 0.4) {
        const moss = new THREE.Mesh(capGeo, mossMat);
        moss.receiveShadow = true;
        moss.scale.set(rock.scale.x * 1.5, 0.5, rock.scale.z * 1.5);
        moss.position.copy(rock.position);
        moss.position.y += rock.scale.y * 0.55;
        group.add(moss);
        seg.bobbers.push({ obj: moss, base: moss.position.y, amp: 0.35, phase: seg.bobbers.at(-1).phase });
        if (rand() < 0.6) {
          const tree = new THREE.Group();
          const trunk = new THREE.Mesh(trunkGeo, barkMat);
          const cone = new THREE.Mesh(pineGeo, mossMat);
          trunk.castShadow = cone.castShadow = true;
          cone.position.y = 1.2;
          trunk.position.y = 0.2;
          tree.add(trunk, cone);
          tree.scale.setScalar(0.8 + rand() * 1.4);
          tree.position.copy(moss.position);
          tree.position.y += 0.2;
          group.add(tree);
          seg.bobbers.push({ obj: tree, base: tree.position.y, amp: 0.35, phase: seg.bobbers.at(-1).phase });
        }
      }
    }
  }

  scene.add(group);
  segments.set(idx, seg);
}

function boxFrameGeometry(w, h, thick, depth) {
  // four bars forming a picture frame, merged into one geometry
  const parts = [
    [w + thick * 2, thick, 0, h / 2 + thick / 2],
    [w + thick * 2, thick, 0, -h / 2 - thick / 2],
    [thick, h, -w / 2 - thick / 2, 0],
    [thick, h, w / 2 + thick / 2, 0],
  ];
  const geos = parts.map(([bw, bh, x, y]) => {
    const g = new THREE.BoxGeometry(bw, bh, depth);
    g.translate(x, y, 0);
    return g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}
// minimal merge (all geometries share the same attribute layout)
function mergeGeometries(geos) {
  const pos = [], norm = [], uv = [], index = [];
  let offset = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    norm.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i++) index.push(idx[i] + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(index);
  return out;
}

// carved wing names for the waygates — one material per wing, kept for
// the session (wing count is bounded by the folder structure)
const gateNameMats = new Map();
function gateNameMat(wingName) {
  let mat = gateNameMats.get(wingName);
  if (mat) return mat;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const label = `✦  ${wingDisplay(wingName)}  ✦`;
  let px = 84;
  do { g.font = `600 ${px}px "Iowan Old Style", Palatino, Georgia, serif`; px -= 4; }
  while (px > 30 && g.measureText(label.toUpperCase()).width > 950);
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 7;
  g.strokeText(label.toUpperCase(), 512, 100);
  g.fillStyle = '#e9c96a';
  g.fillText(label.toUpperCase(), 512, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  mat = new THREE.MeshBasicMaterial({ map: t, transparent: true });
  gateNameMats.set(wingName, mat);
  return mat;
}

function makePlaque(name) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,16,8,0.85)';
  roundRect(g, 2, 2, 508, 92, 12);
  g.fill();
  g.strokeStyle = 'rgba(224,182,74,0.8)';
  g.lineWidth = 3;
  roundRect(g, 6, 6, 500, 84, 10);
  g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e9dfc6';
  const label = name.replace(/[-_]+/g, ' ');
  let px = 40;
  do { g.font = `italic ${px}px Georgia, serif`; px -= 2; }
  while (px > 18 && g.measureText(label).width > 470);
  g.fillText(label, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.216),
    new THREE.MeshBasicMaterial({ map: t, transparent: true })
  );
  return m;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function disposeSegment(idx) {
  const seg = segments.get(idx);
  if (!seg) return;
  seg.dead = true;
  scene.remove(seg.group);
  for (const d of seg.disposables) d.dispose?.();
  for (const src of seg.photoSrcs) releaseTexture(src);
  for (let i = photoMeshes.length - 1; i >= 0; i--)
    if (photoMeshes[i].segIdx === idx) photoMeshes.splice(i, 1);
  segments.delete(idx);
}

function updateSegments(playerS) {
  const lo = Math.floor((playerS - BEHIND) / SEG_LEN);
  const hi = Math.floor((playerS + AHEAD) / SEG_LEN);
  for (const idx of segments.keys())
    if (idx < lo || idx > hi) disposeSegment(idx);
  for (let i = Math.max(0, lo); i <= hi; i++)
    if (!segments.has(i)) buildSegment(i);
}

// ───────────────────────────────────────── fireflies ──
const FIREFLIES = 140;
const ffGeo = new THREE.BufferGeometry();
const ffPos = new Float32Array(FIREFLIES * 3);
const ffPhase = new Float32Array(FIREFLIES);
const ffData = []; // {s, lat, y, drift}
for (let i = 0; i < FIREFLIES; i++) {
  ffData.push({ s: Math.random() * AHEAD, lat: (Math.random() - 0.5) * 18, y: Math.random() * 5 - 0.5, drift: Math.random() * 2 });
  ffPhase[i] = Math.random() * Math.PI * 2;
}
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
ffGeo.setAttribute('aPhase', new THREE.BufferAttribute(ffPhase, 1));
const ffMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    attribute float aPhase;
    varying float vA;
    uniform float uTime;
    void main() {
      vA = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 1.7 + aPhase), 2.0);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 90.0 * vA / max(1.0, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.05, d) * vA;
      gl_FragColor = vec4(1.0, 0.82, 0.42, a);
    }`,
});
scene.add(new THREE.Points(ffGeo, ffMat));

function updateFireflies(playerS, t) {
  for (let i = 0; i < FIREFLIES; i++) {
    const f = ffData[i];
    if (f.s < playerS - 15 || f.s > playerS + AHEAD) {
      f.s = playerS + Math.random() * AHEAD * 0.8;
      f.lat = (Math.random() - 0.5) * 18;
      f.y = Math.random() * 5 - 0.5;
    }
    pathFrame(f.s, _pos, _tan, _side);
    const wob = Math.sin(t * 0.4 + ffPhase[i]) * f.drift;
    ffPos[i * 3] = _pos.x + _side.x * (f.lat + wob);
    ffPos[i * 3 + 1] = _pos.y + f.y + Math.sin(t * 0.6 + ffPhase[i] * 2) * 0.8;
    ffPos[i * 3 + 2] = _pos.z + _side.z * (f.lat + wob);
  }
  ffGeo.attributes.position.needsUpdate = true;
}

// ───────────────────────────────────────── burning lanterns ──
// A small pool of real point lights visits the nearest lantern flames,
// so the path is lit by its own lanterns and not only the walker's glow.
const lampPool = [];
if (!LOW_FX) {
  for (let i = 0; i < 6; i++) {
    const l = new THREE.PointLight(COL.flame, 0, 15, 2);
    scene.add(l);
    lampPool.push(l);
  }
}
const _lampsByDist = [];
function updateLamps(t) {
  if (!lampPool.length) return;
  _lampsByDist.length = 0;
  for (const seg of segments.values())
    for (const lamp of seg.lamps) {
      const dx = lamp.x - camera.position.x, dz = lamp.z - camera.position.z;
      _lampsByDist.push([dx * dx + dz * dz, lamp]);
    }
  _lampsByDist.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < lampPool.length; i++) {
    const light = lampPool[i];
    if (!_lampsByDist[i]) { light.intensity = 0; continue; }
    const lamp = _lampsByDist[i][1];
    const base = lamp.i ?? 9;
    light.position.set(lamp.x, lamp.y, lamp.z);
    light.intensity = base + base * 0.26 * Math.sin(t * 7 + lamp.phase) * Math.sin(t * 3.1 + lamp.phase * 2);
  }
}

// ───────────────────────────────────────── the mist sea ──
// A slow sea of moonlit cloud far beneath the causeway. The noise is
// anchored in world space, so the sea stays put while the plane that
// carries it follows the walker.
let mist = null;
if (!LOW_FX) {
  const mistMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      varying vec2 vUv;
      uniform float uTime;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.13; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz * 0.014;
        float m = fbm(p + vec2(uTime * 0.014, uTime * 0.008));
        m = smoothstep(0.32, 0.9, m + 0.18 * fbm(p * 3.1 - uTime * 0.01));
        // the plane's rim must never show
        float rim = smoothstep(0.5, 0.26, distance(vUv, vec2(0.5)));
        vec3 col = mix(vec3(0.030, 0.038, 0.085), vec3(0.155, 0.17, 0.27), m);
        gl_FragColor = vec4(col, m * rim * 0.45);
      }`,
  });
  mist = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), mistMat);
  mist.rotation.x = -Math.PI / 2;
  mist.renderOrder = -1;
  scene.add(mist);
  skyGroup.userData.mistMat = mistMat;
}

// ───────────────────────────────────────── the Keeper's Tour ──
// Press T and a wisp leads a self-playing exhibition: it drifts to the
// next plate, the view flies in to behold it a while, then moves on.
const TOUR_SPEED = 5.5;       // m/s along the path between plates
const TOUR_DWELL = 6;         // seconds spent beholding each plate
const tour = { active: false, phase: 'idle', targetIdx: -1, dwell: 0 };

const wisp = new THREE.Group();
{
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09, 1),
    new THREE.MeshBasicMaterial({ color: hotColor(0xffe9b0, 1.9) })
  );
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture('#ffd98a'), color: hotColor(0xffc46b, 1.5), transparent: true,
    opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(1.4);
  wisp.add(core, glow);
  wisp.visible = false;
  scene.add(wisp);
}
const wispLight = new THREE.PointLight(0xffd98a, 0, 9, 2);
wisp.add(wispLight);

function tourStart() {
  if (photos.length === 0 || tour.active) return;
  tour.active = true;
  tour.phase = 'travel';
  tour.targetIdx = nextPlateIndex(player.s, SEG_LEN);
  tour.dwell = 0;
  wisp.visible = true;
  wispLight.intensity = 4;
  wisp.position.copy(camera.position);
  tourBadge.hidden = false;
  if (mode === 'inspect') returnToPath();
}

function tourStop() {
  if (!tour.active) return;
  tour.active = false;
  tour.phase = 'idle';
  wisp.visible = false;
  wispLight.intensity = 0;
  tourBadge.hidden = true;
  if (mode === 'inspect' || mode === 'flying') returnToPath();
}

function plateMeshForSeg(idx) {
  const hit = photoMeshes.find((p) => p.segIdx === idx);
  return hit ? hit.mesh : null;
}

const _wispTarget = new THREE.Vector3();
function tourUpdate(dt, t) {
  if (!tour.active) return;
  const targetS = plateS(tour.targetIdx, SEG_LEN);

  if (tour.phase === 'travel') {
    // glide the walker along the path toward the plate
    const remaining = targetS - player.s;
    const step = Math.min(Math.abs(remaining), TOUR_SPEED * dt * Math.min(1, 0.25 + Math.abs(remaining) / 8));
    player.s += Math.sign(remaining) * step;
    player.lat *= Math.exp(-dt * 2);
    player.pitch *= Math.exp(-dt * 2);
    // face along the path
    pathFrame(player.s + 2, _pos, _tan, _side);
    const wantYaw = Math.atan2(-_tan.x, -_tan.z);
    let dy = wantYaw - player.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    player.yaw += dy * Math.min(1, dt * 2.5);
    // the wisp leads, a few paces ahead
    pathFrame(player.s + 5, _pos, _tan, _side);
    _wispTarget.set(_pos.x, _pos.y + 2.0 + Math.sin(t * 2.1) * 0.18, _pos.z);
    wisp.position.lerp(_wispTarget, Math.min(1, dt * 3));

    if (Math.abs(remaining) < 1.2) {
      const mesh = plateMeshForSeg(tour.targetIdx);
      if (mesh) {
        tour.phase = 'behold';
        beholdPlate(mesh);
      } else {
        // plate not built (shouldn't happen) — move on
        tour.targetIdx += 1;
      }
    }
  } else if (tour.phase === 'behold') {
    hoverWispByPlate(dt, t);
    if (mode === 'inspect') { tour.phase = 'dwell'; tour.dwell = 0; }
  } else if (tour.phase === 'dwell') {
    hoverWispByPlate(dt, t);
    tour.dwell += dt;
    if (tour.dwell >= TOUR_DWELL) {
      tour.phase = 'depart';
      returnToPath();
    }
  } else if (tour.phase === 'depart') {
    if (mode === 'walk') {
      tour.targetIdx = nextPlateIndex(player.s, SEG_LEN);
      tour.phase = 'travel';
    }
  }
}

function hoverWispByPlate(dt, t) {
  const mesh = plateMeshForSeg(tour.targetIdx);
  if (!mesh) return;
  mesh.getWorldPosition(_wispTarget);
  _wispTarget.y += mesh.scale.y / 2 + 0.55 + Math.sin(t * 2.4) * 0.12;
  wisp.position.lerp(_wispTarget, Math.min(1, dt * 3));
}

// ───────────────────────────────────────── player & controls ──
const player = { s: 4, lat: 0, yaw: 0, pitch: 0, glide: 0 };
// face along the path on arrival
function faceAlongPath() {
  const p = new THREE.Vector3(), t = new THREE.Vector3(), sd = new THREE.Vector3();
  pathFrame(player.s, p, t, sd);
  player.yaw = Math.atan2(-t.x, -t.z);
}
faceAlongPath();
const keys = new Set();
let mode = 'walk'; // walk | flying | inspect | returning
let pendingBehold = false; // debug: ?behold flies to the nearest plate once built
let pendingTour = false;   // ?tour starts the Keeper's Tour once the world is ready
let locked = false;
let hovered = null;
let bobT = 0;

const veil = document.getElementById('veil');
const veilStatus = document.getElementById('veil-status');
const veilHint = document.getElementById('veil-hint');
const enterBtn = document.getElementById('enter-btn');
const hud = document.getElementById('hud');
const hudCount = document.getElementById('hud-count');
const crosshair = document.getElementById('crosshair');
const gazeLabel = document.getElementById('gaze-label');
const hintPill = document.getElementById('hint-pill');
const tourBadge = document.getElementById('tour-badge');
const hudWing = document.getElementById('hud-wing');
const wayMap = document.getElementById('way-map');
const wayList = document.getElementById('way-list');
const plateKicker = document.getElementById('plate-kicker');
const fadeEl = document.getElementById('fade');
const panel = document.getElementById('plate-panel');
const plateName = document.getElementById('plate-name');
const plateNumber = document.getElementById('plate-number');
const plateMeta = document.getElementById('plate-meta');

const CANCEL_TOUR_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape',
]);
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyH') hintPill.classList.toggle('faded');
  if (e.code === 'KeyM') {
    mapOpen ? closeMap() : openMap();
    return;
  }
  if (mapOpen) {
    if (e.code === 'Escape') closeMap();
    return;
  }
  if (e.code === 'KeyT') {
    tour.active ? tourStop() : tourStart();
    return;
  }
  if (tour.active && CANCEL_TOUR_KEYS.has(e.code)) { tourStop(); return; }
  if (e.code === 'KeyE') {
    if (tour.active) { tourStop(); return; }
    if (mode === 'walk' && hovered) beholdPlate(hovered);
    else if (mode === 'inspect') returnToPath();
  }
  if (e.code === 'Escape' && mode === 'inspect') returnToPath();
});
addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', () => {
  if (tour.active) { tourStop(); return; }
  if (mode === 'walk' && locked && hovered) beholdPlate(hovered);
  else if (mode === 'walk' && !locked) canvas.requestPointerLock();
  else if (mode === 'inspect') returnToPath();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
addEventListener('mousemove', (e) => {
  if (!locked || mode !== 'walk') return;
  player.yaw -= e.movementX * 0.0023;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0023, -1.35, 1.35);
});
addEventListener('wheel', (e) => {
  if (tour.active) tourStop();
  if (mode !== 'walk') return;
  player.glide = THREE.MathUtils.clamp(player.glide + e.deltaY * 0.014, -16, 26);
}, { passive: true });

document.getElementById('plate-return').addEventListener('click', returnToPath);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// ───────────────────────────────────────── the Wayfarer's Map ──
// Press M: every wing of the gallery, one step away. Choosing a wing
// fades the night and sets the walker down just before its waygate.
let mapOpen = false;
let currentWingName = null;

function buildMapRows() {
  wayList.innerHTML = '';
  const rows = [
    { label: 'the gatehouse', note: 'where the path begins', s: 2 },
    ...wings.map((w) => ({
      label: wingDisplay(w.name),
      note: `${romanize(w.count)} plate${w.count === 1 ? '' : 's'}`,
      wing: w,
    })),
  ];
  for (const row of rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML =
      `<span class="way-glyph">✦</span><span class="way-name"></span><span class="way-note"></span>`;
    btn.querySelector('.way-name').textContent = row.label;
    btn.querySelector('.way-note').textContent = row.note;
    if (row.wing) btn.dataset.wing = row.wing.name;
    btn.addEventListener('click', () => {
      if (row.wing) teleportToWing(row.wing);
      else teleportTo(row.s);
    });
    li.appendChild(btn);
    wayList.appendChild(li);
  }
}

function openMap() {
  tourStop();
  mapOpen = true;
  wayMap.hidden = false;
  document.exitPointerLock?.();
  // mark where the walker stands
  for (const btn of wayList.querySelectorAll('button')) {
    btn.classList.toggle('here', currentWingName !== null && btn.dataset.wing === currentWingName);
  }
}
function closeMap() {
  mapOpen = false;
  wayMap.hidden = true;
}

function teleportToWing(wing) {
  const idx = segForPlateAhead(player.s, wing.start, photos.length, SEG_LEN, 6);
  teleportTo(Math.max(2, idx * SEG_LEN - 4));
}
async function teleportTo(s) {
  closeMap();
  fadeEl.classList.add('dark');
  await new Promise((r) => setTimeout(r, 380));
  if (mode === 'inspect' || mode === 'flying') { mode = 'walk'; panel.hidden = true; }
  player.s = Math.max(2, s);
  player.lat = 0;
  player.glide = 0;
  player.pitch = 0;
  faceAlongPath();
  updateSegments(player.s);
  fadeEl.classList.remove('dark');
}

// keep the HUD's "wing of…" line current (cheap; runs on the hover tick)
function updateWing() {
  if (wings.length === 0) return;
  const plate = mod(Math.floor(player.s / SEG_LEN), photos.length);
  const wing = wingOfPlate(wings, plate);
  const name = wing ? wing.name : null;
  if (name !== currentWingName) {
    currentWingName = name;
    hudWing.textContent = wings.length > 1 ? `· ${wingDisplay(name)}` : '';
  }
}

// ───────────────────────────────────────── beholding a plate ──
const flyFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const flyTo = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
let flyT = 0;
let beholdMesh = null;

function beholdPlate(mesh) {
  beholdMesh = mesh;
  mode = 'flying';
  flyT = 0;
  document.exitPointerLock?.();

  flyFrom.pos.copy(camera.position);
  flyFrom.quat.copy(camera.quaternion);

  const center = new THREE.Vector3();
  mesh.getWorldPosition(center);
  const normal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
  const size = Math.max(mesh.scale.x, mesh.scale.y * camera.aspect);
  const dist = (size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.5 + 0.6;
  flyTo.pos.copy(center).addScaledVector(normal, dist);
  _m.lookAt(flyTo.pos, center, new THREE.Vector3(0, 1, 0));
  flyTo.quat.setFromRotationMatrix(_m);

  const photo = mesh.userData.photo;
  plateName.textContent = photo.name.replace(/[-_]+/g, ' ');
  if (wings.length > 1) {
    const wing = wingOfPlate(wings, mesh.userData.plate);
    plateKicker.textContent = `From the wing of ${wingDisplay(wing.name)}`;
  } else {
    plateKicker.textContent = 'From the collection';
  }
  plateNumber.textContent = `Plate ${romanize(mesh.userData.plate + 1)} · of ${romanize(photos.length)}`;
  plateMeta.textContent = mesh.userData.dims ? `${mesh.userData.dims} px` : '';
}

function returnToPath() {
  if (mode !== 'inspect' && mode !== 'flying') return;
  mode = 'returning';
  flyT = 0;
  panel.hidden = true;
  flyFrom.pos.copy(camera.position);
  flyFrom.quat.copy(camera.quaternion);
  // walk pose is recomputed every frame, so fly back toward it live
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ───────────────────────────────────────── raycasting ──
const raycaster = new THREE.Raycaster();
raycaster.far = 30;
function updateHover() {
  hovered = null;
  if (mode !== 'walk') { crosshair.classList.remove('hot'); gazeLabel.hidden = true; return; }
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects(photoMeshes.map((p) => p.mesh), false);
  if (hits.length) {
    hovered = hits[0].object;
    crosshair.classList.add('hot');
    gazeLabel.textContent = hovered.userData.photo.name.replace(/[-_]+/g, ' ');
    gazeLabel.hidden = false;
  } else {
    crosshair.classList.remove('hot');
    gazeLabel.hidden = true;
  }
}

// ───────────────────────────────────────── walk pose ──
const walkPos = new THREE.Vector3();
const walkQuat = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
function computeWalkPose(dt) {
  // movement input in world space from yaw
  let fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.8 : 1;
  const moving = fwd !== 0 || strafe !== 0;

  pathFrame(player.s, _pos, _tan, _side);
  if (moving && locked) {
    // world-space wish direction from yaw
    const wish = new THREE.Vector3(
      -Math.sin(player.yaw) * fwd + Math.cos(player.yaw) * strafe,
      0,
      -Math.cos(player.yaw) * fwd - Math.sin(player.yaw) * strafe
    ).normalize();
    const tanXZ = _p0.set(_tan.x, 0, _tan.z).normalize();
    const ds = wish.dot(tanXZ) * WALK_SPEED * sprint * dt;
    const dlat = wish.dot(_side) * WALK_SPEED * sprint * dt;
    player.s = Math.max(2, player.s + ds);
    player.lat = THREE.MathUtils.clamp(player.lat + dlat, -MAX_LAT, MAX_LAT);
    bobT += dt * (sprint > 1 ? 11 : 8);
  }

  // scroll glide with decay
  player.s = Math.max(2, player.s + player.glide * dt);
  player.glide *= Math.exp(-dt * 1.6);

  pathFrame(player.s, _pos, _tan, _side);
  const bob = Math.sin(bobT) * 0.045;
  walkPos.set(
    _pos.x + _side.x * player.lat,
    _pos.y + EYE + bob,
    _pos.z + _side.z * player.lat
  );
  _e.set(player.pitch, player.yaw, 0);
  walkQuat.setFromEuler(_e);
}

// ───────────────────────────────────────── boot ──
async function boot() {
  try {
    const [res] = await Promise.all([fetch('/api/photos'), loadLantern()]);
    const data = await res.json();
    photos = data.photos;
    wings = data.wings || [];
    buildMapRows();
    if (photos.length === 0) {
      veilStatus.textContent = 'The gallery walls are bare.';
      veilHint.innerHTML =
        `No images were found in <code>${escapeHtml(data.dir)}</code>.<br>` +
        `Conjure sample plates with <code>npm run samples</code>, or point the ` +
        `gallery at your own photographs:<br><code>npm start -- ~/Pictures/landscapes</code>`;
      veilHint.hidden = false;
      worldReady = true; // wander the bare path anyway
      return;
    }
    veilStatus.textContent =
      `${photos.length} photograph${photos.length === 1 ? '' : 's'} await along the path.`;
    hudCount.textContent = `· ${photos.length} plates`;
    enterBtn.hidden = false;
    // dev/preview: ?auto skips the veil, ?s=120 starts partway down the path
    const params = new URLSearchParams(location.search);
    if (params.has('s')) {
      player.s = Math.max(2, Number(params.get('s')) || 2);
      faceAlongPath();
    }
    if (params.has('yaw')) player.yaw += THREE.MathUtils.degToRad(Number(params.get('yaw')) || 0);
    if (params.has('auto')) {
      veil.style.display = 'none';
      hud.hidden = false;
    }
    worldReady = true;
    if (params.has('behold')) pendingBehold = true;
    if (params.has('tour')) pendingTour = true;
  } catch (err) {
    veilStatus.textContent = 'The path could not be unrolled.';
    veilHint.textContent = String(err);
    veilHint.hidden = false;
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

enterBtn.addEventListener('click', () => {
  veil.classList.add('gone');
  hud.hidden = false;
  canvas.requestPointerLock();
  setTimeout(() => hintPill.classList.add('faded'), 9000);
});

// ───────────────────────────────────────── main loop ──
const clock = new THREE.Clock();
let hoverTick = 0;

// dev hook: lets tooling read the walker's state
window.__scene = scene;
window.__winding = () => ({
  mode, s: player.s, flyT,
  plates: photoMeshes.length,
  cam: camera.position.toArray().map((v) => +v.toFixed(2)),
  panelHidden: panel.hidden,
  tour: { active: tour.active, phase: tour.phase, targetIdx: tour.targetIdx },
  wing: currentWingName,
  wings: wings.length,
  mapOpen,
  fx: !LOW_FX,
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  tourUpdate(dt, t);
  computeWalkPose(dt);

  if (mode === 'walk') {
    camera.position.copy(walkPos);
    camera.quaternion.copy(walkQuat);
  } else if (mode === 'flying') {
    flyT = Math.min(1, flyT + dt / 1.15);
    const k = ease(flyT);
    camera.position.lerpVectors(flyFrom.pos, flyTo.pos, k);
    camera.quaternion.slerpQuaternions(flyFrom.quat, flyTo.quat, k);
    if (flyT >= 1) { mode = 'inspect'; panel.hidden = false; }
  } else if (mode === 'returning') {
    flyT = Math.min(1, flyT + dt / 0.9);
    const k = ease(flyT);
    camera.position.lerpVectors(flyFrom.pos, walkPos, k);
    camera.quaternion.slerpQuaternions(flyFrom.quat, walkQuat, k);
    if (flyT >= 1) mode = 'walk';
  }

  if (worldReady) updateSegments(player.s);
  if (pendingTour && photoMeshes.length && hud.hidden === false) {
    pendingTour = false;
    tourStart();
  }
  if (pendingBehold && photoMeshes.length) {
    pendingBehold = false;
    const near = photoMeshes
      .map((p) => p.mesh)
      .sort((a, b) =>
        a.getWorldPosition(_p0).distanceTo(camera.position) -
        b.getWorldPosition(_p1).distanceTo(camera.position))[0];
    beholdPlate(near);
  }
  updateFireflies(player.s, t);

  // bobbing rocks & flickering lantern glows
  for (const seg of segments.values()) {
    for (const b of seg.bobbers) {
      if (b.amp > 0) b.obj.position.y = b.base + Math.sin(t * 0.5 + b.phase) * b.amp;
      if (b.flick) b.flick.opacity = 0.6 + 0.22 * Math.sin(t * 7 + b.phase) * Math.sin(t * 3.1 + b.phase * 2);
    }
  }

  // walker's lantern-light drifts just ahead, flickering gently
  pathFrame(player.s + 3, _pos, _tan, _side);
  walkerLight.position.set(_pos.x, _pos.y + 2.4, _pos.z);
  walkerLight.intensity = 18 + Math.sin(t * 9.3) * 2.2 + Math.sin(t * 23.7) * 1.3;

  // the moon's shadow frustum travels with the walker
  if (moonLight.castShadow) {
    moonLight.position.copy(walkPos).addScaledVector(MOON_DIR, 120);
    moonLight.target.position.copy(walkPos);
  }
  updateLamps(t);
  if (mist) {
    mist.position.set(camera.position.x, camera.position.y - 24, camera.position.z);
    mist.material.uniforms.uTime.value = t;
  }
  auroraMat.uniforms.uTime.value = t;

  skyGroup.position.copy(camera.position);
  skyGroup.userData.starMat.uniforms.uTime.value = t;
  ffMat.uniforms.uTime.value = t;

  hoverTick += dt;
  if (hoverTick > 0.08) { hoverTick = 0; updateHover(); updateWing(); }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

boot();
animate();
