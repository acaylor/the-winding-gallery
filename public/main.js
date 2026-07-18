// ✦ The Winding Gallery ✦
// An endless winding sky-path hung with your photographs.
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/vendor/three-addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from '/vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from '/vendor/three-addons/postprocessing/GTAOPass.js';
import { ShaderPass } from '/vendor/three-addons/postprocessing/ShaderPass.js';
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
  // a dim, cool slate that leans toward the mist/horizon rather than the
  // old near-black indigo, so distant path fades into the sea as one
  // ribbon instead of leaving dark stone stranded against the pale mist
  fog: 0x1b2140,
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
// AgX rolls the highlights off more gracefully than ACES and keeps the
// night's colours from oversaturating under the lantern glow. It is free
// (applied in the OutputPass at default quality, in the renderer at low),
// so it grades every pipeline. Exposure lifted to compensate for AgX's
// darker mid-tones.
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (!LOW_FX) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const scene = new THREE.Scene();
// default quality runs a touch denser — the height-fog curve thins it
// again above the walker, so only the middle distance gains breath
scene.fog = new THREE.FogExp2(COL.fog, LOW_FX ? 0.0105 : 0.0125);

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 2500);

// post: bloom so the flames, moon and wisp genuinely glow (tone mapping
// moves into the OutputPass; the multisampled HDR target keeps the AA)
let composer = null;
let gradePass = null;
if (!LOW_FX) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType, samples: 4,
  });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  composer.addPass(new RenderPass(scene, camera));
  // ground-truth ambient occlusion: corners, seams and contact points
  // darken the way night stone should (before bloom, so glows stay clean)
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.7, thickness: 1.2, scale: 1.1 });
  gtao.blendIntensity = 0.85;
  // the stock pass keeps only points and lines out of its depth/normal
  // pre-pass; here glows, aurora, mist and the photos themselves are
  // transparent or unlit quads, and rendered opaque they poison the
  // occlusion buffer (and the plates must never gather AO dirt)
  gtao._overrideVisibility = function () {
    const cache = this._visibilityCache;
    this.scene.traverse((object) => {
      const mat = object.material;
      // objects tagged aoSolid stay in the pre-pass: a hidden photo plate
      // leaves the geometry *behind* it in the depth buffer, and the pass
      // then shades the plate with a ghost imprint of islands it occludes
      const skip = (object.isPoints || object.isLine || object.isSprite ||
        (mat && (mat.transparent || mat.isMeshBasicMaterial || mat.isShaderMaterial))) &&
        !object.userData.aoSolid;
      if (skip && object.visible) {
        object.visible = false;
        cache.push(object);
      }
    });
  };
  composer.addPass(gtao);
  // threshold sits above the photos' peak brightness (unlit plates reach
  // ~exposure = 1.05) so only deliberate HDR emitters — flames at 1.7x, the
  // moon, the keeper's wisp, fireflies — cross it and bloom. Photographs and
  // gold-frame speculars stay crisp instead of washing into halos.
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.4, 1.1));
  // a single cheap final pass: a soft vignette to settle the eye toward
  // the path, and fine animated film grain to break up the smooth night
  // gradients. Both are meant to be felt, not seen. Runs before the
  // OutputPass so the tone-map still has the last word.
  gradePass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uVignette: { value: 0.34 },
      uGrain: { value: 0.02 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime, uVignette, uGrain;
      uniform vec2 uResolution;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 q = vUv - 0.5;
        float vig = 1.0 - uVignette * dot(q, q) * 2.1;
        c.rgb *= vig;
        // luminance-matched grain, re-seeded each frame so it shimmers
        float g = hash(vUv * uResolution + fract(uTime) * vec2(37.0, 17.0)) - 0.5;
        c.rgb += g * uGrain;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());
}

const MOON_DIR = new THREE.Vector3(-0.4, 0.8, -0.5).normalize();
// the ambient floor is lifted enough that unlit stone reads as cool
// moon-blue rather than black — dark, but its texture legible. The
// lantern pools (point lights, intensity 9–26) still dominate by a wide
// margin, so the night is kept.
scene.add(new THREE.HemisphereLight(0x5d6c9c, 0x373049, 1.5));
const moonLight = new THREE.DirectionalLight(0x9fb2ec, 1.55);
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

// a cool fill from the moonless side, raised so off-path silhouettes keep
// their shape and gain a legible moon-blue edge against the sky instead
// of collapsing to black. Lifted a touch overhead so it catches the top
// arris of curbs, arches and posts.
const rimLight = new THREE.DirectionalLight(0x6f83c8, 1.0);
rimLight.position.set(0.55, 0.45, 0.6);
scene.add(rimLight);

// Warm lantern-light that travels with the walker — and casts real
// shadows, so plinths, curbs and arches are grounded by their own dark
const walkerLight = new THREE.PointLight(COL.flame, 26, 30, 2);
if (!LOW_FX) {
  walkerLight.castShadow = true;
  walkerLight.shadow.mapSize.set(1024, 1024);
  walkerLight.shadow.camera.near = 0.5;
  walkerLight.shadow.camera.far = 30;
  walkerLight.shadow.bias = -0.006;
}
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
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int k = 0; k < 3; k++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
      return v;
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
      // the great river of stars: an elongated, tilted band whose light is
      // broken up by FBM so it clumps and thins like real galactic dust —
      // warmer in its dense core, cooler along its ragged edges
      vec3 mwAxis = normalize(vec3(0.62, 0.34, -0.42));
      float band = abs(dot(dir, mwAxis));
      float mw = exp(-band * band * 20.0) * smoothstep(0.0, 0.22, h);
      vec3 along = normalize(cross(mwAxis, vec3(0.0, 1.0, 0.0)));
      float u = dot(dir, along) * 3.0;
      float clump = fbm(vec2(u * 1.5, band * 8.0));
      clump *= clump;
      float dust = smoothstep(0.15, 0.7, fbm(vec2(u * 2.3 + 5.0, band * 5.0)));
      float mwI = mw * (0.12 + 0.88 * clump) * (0.45 + 0.55 * dust);
      col += mix(vec3(0.048, 0.062, 0.11), vec3(0.10, 0.086, 0.10), clump) * mwI * 1.35;
      // one or two barely-there nebula patches, one warm and one cool
      float neb = fbm(dir.xz * 2.0 + 11.0) * fbm(dir.xy * 1.6 - 3.0);
      neb = smoothstep(0.42, 0.82, neb) * smoothstep(0.02, 0.32, h);
      col += vec3(0.085, 0.028, 0.06) * neb * 0.5;
      float neb2 = smoothstep(0.55, 0.9, fbm(dir.xz * 1.5 - 21.0)) * smoothstep(0.06, 0.42, h);
      col += vec3(0.018, 0.05, 0.08) * neb2 * 0.45;
      // dither, or the long gradients ribbon into visible bands
      col += (hash(gl_FragCoord.xy) - 0.5) / 160.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
skyGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 20), skyMat));

// stars — varied in size, brightness and colour temperature, only some
// of them breathing (a sky where every point pulses in unison reads fake)
{
  const N = 1600;
  const pos = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const size = new Float32Array(N);
  const bright = new Float32Array(N);
  const twk = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.96 + 0.03;
    v.normalize().multiplyScalar(1500);
    pos.set([v.x, v.y, v.z], i * 3);
    phase[i] = Math.random() * Math.PI * 2;
    // a power law: mostly faint pinpricks, a rare few large and brilliant
    size[i] = 1.3 + Math.pow(Math.random(), 3.4) * 6.2;
    bright[i] = 0.38 + Math.pow(Math.random(), 1.7) * 0.95;
    // a minority carry a temperature: warm amber giants, cool blue stars
    const tk = Math.random();
    if (tk < 0.11) c.setHex(0xffd3a0);
    else if (tk < 0.22) c.setHex(0xb9ccff);
    else c.setRGB(0.85, 0.88, 1.0);
    col.set([c.r, c.g, c.b], i * 3);
    // roughly half twinkle, and gently; the rest hang steady
    twk[i] = Math.random() < 0.5 ? 0.18 + Math.random() * 0.4 : 0.0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  g.setAttribute('aTwk', new THREE.BufferAttribute(twk, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aPhase; attribute float aSize;
      attribute float aBright; attribute float aTwk; attribute vec3 aColor;
      varying float vA; varying vec3 vColor;
      uniform float uTime;
      void main() {
        float tw = 1.0 - aTwk + aTwk * (0.5 + 0.5 * sin(uTime * 0.8 + aPhase));
        // atmospheric extinction: stars die toward the horizon, so none
        // speckle the mist line or hang beside the lanterns (dome y in m)
        vA = aBright * tw * smoothstep(45.0, 170.0, position.y);
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vA;
        gl_FragColor = vec4(vColor, a);
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
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
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
// break the paving's repeat: blend in a second, offset sample of the
// same stone wherever a low-frequency noise mask says so, and the grid
// never resolves — the walk goes on for kilometres over one texture
floorMat.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      float wgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wgNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wgHash(i), wgHash(i + vec2(1, 0)), f.x),
                   mix(wgHash(i + vec2(0, 1)), wgHash(i + vec2(1, 1)), f.x), f.y);
      }`)
    .replace('#include <map_fragment>', `
      vec4 texA = texture2D(map, vMapUv);
      vec4 texB = texture2D(map, vMapUv * 0.831 + vec2(0.353, 0.679));
      float wgMask = smoothstep(0.35, 0.65, wgNoise(vMapUv * 0.5));
      diffuseColor *= mix(texA, texB, wgMask);
    `);
};
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
// real gilding: full metal under varied roughness, so lantern-light
// slides across the molding in streaks instead of one even sheen
const goldRoughTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#575757';
  g.fillRect(0, 0, 128, 128);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 240; i++) {
    const v = 60 + Math.floor(Math.random() * 95);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const w = 3 + Math.random() * 24;
    g.fillRect(Math.random() * 128, Math.random() * 128, w, w * (0.25 + Math.random()));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xd8ab3c, metalness: 1.0, roughness: 0.9,
  roughnessMap: goldRoughTex, emissive: 0x2c1f06, envMapIntensity: 1.25,
});
const flameMat = new THREE.MeshBasicMaterial({ color: hotColor(COL.flame, 2.2) });

// standing stones darken toward the ground they meet — baked into the
// vertices, since the screen-space AO can't reach around silhouettes
const stoneVertMat = stoneMat.clone();
stoneVertMat.vertexColors = true;
const stoneDarkVertMat = stoneDarkMat.clone();
stoneDarkVertMat.vertexColors = true;
function bakeVerticalAO(geo, yLow, yHigh, floor = 0.5) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = THREE.MathUtils.clamp((p.getY(i) - yLow) / (yHigh - yLow), 0, 1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = floor + (1 - floor) * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// stone textures are roughly a metre of surface — stretch a whole one
// over a 7 m lintel or a 3.6 m pillar and it reads as plastic, so the
// UVs are scaled to keep the grain near world size
function scaleUV(geo, sx, sy) {
  const a = geo.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * sx, a.getY(i) * sy);
  return geo;
}

const glowTex = makeGlowTexture('#ffc46b');
const curbGeo = bakeVerticalAO(new THREE.BoxGeometry(0.55, 0.3, 1.15), -0.15, 0.12, 0.5);
const gatePillarGeo = scaleUV(bakeVerticalAO(new THREE.BoxGeometry(0.9, 3.6, 0.9), -1.8, -0.2, 0.55), 1, 2.6);
const gateCapGeo = new THREE.BoxGeometry(1.2, 0.28, 1.2);
const gateLintelGeo = scaleUV(new THREE.BoxGeometry(PATH_W + 2.2, 0.75, 1.0), 4.5, 0.7);
const gateNameGeo = new THREE.PlaneGeometry(4.8, 0.9);
const plinthGeo = scaleUV(bakeVerticalAO(new THREE.CylinderGeometry(0.5, 0.72, 1.15, 6), -0.575, 0.4, 0.55), 2.4, 1);
const capGeo = new THREE.CylinderGeometry(0.62, 0.5, 0.18, 6);
const plinthBaseGeo = scaleUV(bakeVerticalAO(new THREE.CylinderGeometry(0.82, 0.96, 0.22, 6), -0.11, 0.11, 0.6), 3.2, 0.25);
const plinthNeckGeo = new THREE.CylinderGeometry(0.6, 0.54, 0.1, 6);
const postGeo = bakeVerticalAO(new THREE.CylinderGeometry(0.07, 0.1, 2.7, 6), -1.35, -0.3, 0.55);
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
// roots trailing beneath the islands, point-down
const rootGeo = new THREE.ConeGeometry(0.1, 1, 5);
rootGeo.rotateX(Math.PI);
rootGeo.translate(0, -0.5, 0); // origin where the root meets the rock

// a tuft of grass: two crossed cards, painted blades, origin at the base.
// Each blade a tapered filled sliver — reads as grass, not a smudge.
const grassTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blade = (x0, lean, top, w, base, tip) => {
    const cx = x0 + lean * 0.3, cy = 84;   // control point of the arc
    const tx = x0 + lean, ty = top;
    const grad = g.createLinearGradient(x0, 128, tx, ty);
    grad.addColorStop(0, base); grad.addColorStop(1, tip);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, 128);
    g.quadraticCurveTo(cx - w * 0.5, cy, tx, ty);       // up the leaning edge
    g.quadraticCurveTo(cx + w * 0.5, cy, x0 + w, 128);  // down the other
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 60; i++) {
    const x = 10 + Math.random() * 108;
    const lean = (Math.random() - 0.5) * 52;
    const top = 8 + Math.random() * 54;
    const s = 30 + Math.floor(Math.random() * 44);       // deep, in-shadow blades first
    blade(x, lean, top, 1.4 + Math.random() * 1.6,
      `rgb(${Math.floor(s * 0.72)},${s + 10},${Math.floor(s * 0.46)})`,
      `rgb(${Math.floor(s * 0.9)},${s + 26},${Math.floor(s * 0.58)})`);
  }
  for (let i = 0; i < 34; i++) {
    const x = 14 + Math.random() * 100;
    const lean = (Math.random() - 0.5) * 44;
    const top = 6 + Math.random() * 40;
    const s = 58 + Math.floor(Math.random() * 46);       // sunward tips catch light
    blade(x, lean, top, 1.0 + Math.random() * 1.3,
      `rgb(${Math.floor(s * 0.7)},${s + 8},${Math.floor(s * 0.44)})`,
      `rgb(${Math.floor(s * 0.95)},${Math.min(255, s + 40)},${Math.floor(s * 0.6)})`);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const grassMat = new THREE.MeshStandardMaterial({
  map: grassTex, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1,
});
const grassTuftGeo = (() => {
  const pos = [], uv = [], idx = [];
  for (const rot of [0, Math.PI / 2]) {
    const c = Math.cos(rot) * 0.26, s = Math.sin(rot) * 0.26;
    const base = pos.length / 3;
    pos.push(-c, 0, -s, c, 0, s, c, 0.34, s, -c, 0.34, -s);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
})();

// ───────────────────────────────────────── the deep distance ──
// Far islands adrift on the horizon — some carrying a lantern-town
// spark — so the vista has landmarks instead of empty fog. Built once
// the rock model has loaded (boot), so they share its silhouette.
// far shapes must not read as black cardboard cut into the sky: blend
// each isle toward the horizon haze near its base (where it meets the
// mist sea) and let only its crown keep a faint silhouette, so the deep
// distance reads as receding atmospheric layers, not a hard border
const horizonIsleMat = new THREE.ShaderMaterial({
  fog: false,
  uniforms: {
    uHaze: { value: new THREE.Color(0x171628) },
    uSil:  { value: new THREE.Color(0x24243e) },
  },
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vWorld;
    uniform vec3 uHaze;
    uniform vec3 uSil;
    void main() {
      // skyGroup rides with the camera, so height above the eye is the
      // reliable cue: bases sink into the haze, crowns lift out of it
      float rel = vWorld.y - cameraPosition.y;
      float k = smoothstep(-30.0, 46.0, rel);
      gl_FragColor = vec4(mix(uHaze, uSil, k), 1.0);
    }`,
});
function buildHorizonIsles() {
  const isleMat = horizonIsleMat;
  const isleRand = seededRand(4099);
  for (let i = 0; i < 10; i++) {
    const a = isleRand() * Math.PI * 2;
    const d = 1050 + isleRand() * 320;
    const proto = rockProtos.length ? rockProtos[i % rockProtos.length] : null;
    const isle = proto
      ? new THREE.Mesh(proto.geometry, isleMat)
      : new THREE.Mesh(rockGeos[i % rockGeos.length], isleMat);
    const w = 36 + isleRand() * 60, h = 20 + isleRand() * 26;
    isle.position.set(Math.cos(a) * d, (-0.015 + isleRand() * 0.05) * d, Math.sin(a) * d);
    if (proto) {
      isle.scale.set(w / proto.half, h / proto.height, w / proto.half);
      isle.position.y -= h * 0.4; // origin at the rock's base, not its middle
    } else {
      isle.scale.set(w, h, w);
    }
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
      spark.position.y += h * 0.9;
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

// ───────────────────────────────────────── height fog ──
// The night thickens below the walker: distant stretches of path and
// low islands sink into the mist sea instead of fading evenly. Patched
// into each world material's fog math; ?quality=low keeps plain fog.
function wgShaderTag(mat, tag) {
  mat.userData.wgTags = (mat.userData.wgTags || '') + '|' + tag;
  mat.customProgramCacheKey = function () { return this.userData.wgTags; };
}
wgShaderTag(floorMat, 'antitile');
function heightFogify(mat) {
  if (LOW_FX) return;
  const prev = mat.onBeforeCompile;
  wgShaderTag(mat, 'heightfog');
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying float wgFogY;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wgFogP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wgFogP = instanceMatrix * wgFogP;
        #endif
        wgFogY = (modelMatrix * wgFogP).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nvarying float wgFogY;')
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
        // ~1.0 at the walker's own height, swelling below, thinning above
        float wgSink = mix(2.4, 0.45, smoothstep(-16.0, 8.0, wgFogY - cameraPosition.y));
        float wgFogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * wgSink);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, wgFogFactor);
      #endif`);
  };
}
for (const m of [floorMat, skirtMat, stoneMat, stoneDarkMat, stoneVertMat,
  stoneDarkVertMat, barkMat, goldMat, grassMat]) heightFogify(m);

// ──────────────────────────────── the drifting rocks (Poly Haven CC0) ──
// Photoscanned boulders; every island adrift around the path is an
// instance of one. Falls back to the old jittered shards if none load.
const rockProtos = [];       // { geometry, material, half, height } — origin on the footprint
// moss takes the upward faces of the drifting rocks, in patches, the
// way weather would leave it — blended in the shader by world normal
function mossify(mat) {
  wgShaderTag(mat, 'moss');
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 wgWNor;\nvarying vec3 wgWPos;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        wgWNor = normalize(mat3(modelMatrix) * objectNormal);
        wgWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 wgWNor;
        varying vec3 wgWPos;
        float wgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wgNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wgHash(i), wgHash(i + vec2(1, 0)), f.x),
                     mix(wgHash(i + vec2(0, 1)), wgHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float wgUp = smoothstep(0.4, 0.85, normalize(wgWNor).y);
        float wgN = wgNoise(wgWPos.xz * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb,
          vec3(0.16, 0.22, 0.09) * (0.7 + 0.6 * wgN),
          wgUp * smoothstep(0.3, 0.7, wgN) * 0.85);`);
  };
}
function loadIsleRocks() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // the rocks are meshopt-compressed
  return Promise.all(['/assets/isle-rock-1.glb', '/assets/isle-rock-2.glb', '/assets/isle-rock-3.glb']
    .map((url) => new Promise((resolve) => {
      loader.load(url, (gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            const g = o.geometry;
            g.computeBoundingBox();
            const bb = g.boundingBox;
            // center each rock on its own footprint, sitting on y=0
            g.translate(
              -(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
            const half = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
            mossify(o.material);
            heightFogify(o.material);
            rockProtos.push({ geometry: g, material: o.material, half, height: bb.max.y - bb.min.y });
          }
        });
        resolve();
      }, undefined, () => resolve());
    })));
}

// ─────────────────── the mountain pines (procedural, Huangshan style) ──
// Windswept pines of the eastern high ranges: a leaning S-curved trunk
// grown toward the wind, and flat cloud-pruned needle pads. Each is
// grown from its segment's seed — no two alike, no asset to ship. The
// geometry is per-tree, so it goes into the segment's disposables.
// the solid lump is now only a dimmed silhouette core beneath the needle
// cards — kept dark so mass reads at distance without showing as a blob
const padMat = new THREE.MeshStandardMaterial({
  color: 0x25311c, roughness: 1, vertexColors: true,
  emissive: 0x0d150a, emissiveIntensity: 0.3,
});
heightFogify(padMat);

// needle-pad texture: clustered fans of fine radiating slivers, deep green
// to dusty sage with warm tips, darker toward each cluster base, clean alpha
const needleTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const R = () => Math.random();
  const needle = (x0, y0, ang, len, w, base, tip) => {
    const tx = x0 + Math.cos(ang) * len, ty = y0 + Math.sin(ang) * len;
    const nx = Math.cos(ang + Math.PI / 2) * w, ny = Math.sin(ang + Math.PI / 2) * w;
    const grad = g.createLinearGradient(x0, y0, tx, ty);
    grad.addColorStop(0, base); grad.addColorStop(1, tip);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - nx, y0 - ny); g.lineTo(x0 + nx, y0 + ny); g.lineTo(tx, ty);
    g.closePath(); g.fill();
  };
  // clustered fans spread across the sheet, drawn dark-base first
  for (let cl = 0; cl < 15; cl++) {
    const cx = 18 + R() * 220, cy = 18 + R() * 220;
    const dir = R() * Math.PI * 2, spread = 0.7 + R() * 1.4;
    const hue = R();                                  // 0 deep green … 1 dusty sage
    const gr = 44 + Math.floor(hue * 34);
    const base = `rgb(${Math.floor(gr * 0.44)},${Math.floor(gr * 0.86)},${Math.floor(gr * 0.4)})`;
    const warm = R() < 0.4;                           // some fans warm at the tip
    const tip = warm
      ? `rgb(${Math.floor(gr * 1.5)},${Math.floor(gr * 1.35)},${Math.floor(gr * 0.7)})`
      : `rgb(${Math.floor(gr * 0.9)},${Math.floor(gr * 1.4)},${Math.floor(gr * 0.72)})`;
    const n = 22 + Math.floor(R() * 20);
    for (let i = 0; i < n; i++) {
      const a = dir + (R() - 0.5) * spread;
      needle(cx, cy, a, 26 + R() * 46, 1.1 + R() * 1.1, base, tip);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const needleMat = new THREE.MeshStandardMaterial({
  map: needleTex, alphaTest: 0.42, transparent: true, depthWrite: true,
  side: THREE.DoubleSide, roughness: 1, vertexColors: true,
  emissive: 0x0d150a, emissiveIntensity: 0.3,
});
heightFogify(needleMat);

// one cupped fan card: a horizontal quad drooping at its edges, vertex-darkened
// toward the rim so the fan feels dense at its heart and shaded beneath
const needleCardGeo = (() => {
  const N = 5, pos = [], uv = [], col = [], idx = [];
  for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) {
    const u = ix / N, v = iy / N;
    const x = (u - 0.5) * 2, z = (v - 0.5) * 2;
    const rr = x * x + z * z;
    pos.push(x, -0.42 * rr, z);                       // cup the rim downward
    uv.push(u, v);
    const shade = 0.5 + 0.5 * (1 - Math.min(1, rr)); // rim darker than heart
    col.push(shade, shade, shade);
  }
  const row = N + 1;
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const a = iy * row + ix;
    idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
})();

// a TubeGeometry that narrows toward its tip, like wood does
function taperedTube(curve, segs, radius, tipK) {
  const geo = new THREE.TubeGeometry(curve, segs, radius, 6, false);
  const p = geo.attributes.position;
  const per = 7; // radialSegments + 1
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let ri = 0; ri <= segs; ri++) {
    const t = ri / segs;
    curve.getPoint(t, c);
    const k = 1 - (1 - tipK) * t;
    for (let j = 0; j < per; j++) {
      const i = ri * per + j;
      v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(c).multiplyScalar(k).add(c);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function makeMountainPine(rand, disposables) {
  const g = new THREE.Group();
  const leanA = rand() * Math.PI * 2;
  const lean = 0.2 + rand() * 0.38;    // crown drift, as a share of height
  const lx = Math.cos(leanA), lz = Math.sin(leanA);

  // the trunk: kinked toward the lean like wind-trained wood
  const pts = [];
  const kinkA = 1.2 + rand() * 0.8, kinkP = rand() * Math.PI;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const drift = lean * t * t + Math.sin(t * Math.PI * kinkA + kinkP) * 0.07;
    pts.push(new THREE.Vector3(
      lx * drift + (rand() - 0.5) * 0.04,
      t * (0.92 + rand() * 0.12),
      lz * drift + (rand() - 0.5) * 0.04));
  }
  const trunkCurve = new THREE.CatmullRomCurve3(pts);
  const trunkGeo = taperedTube(trunkCurve, 10, 0.045 + rand() * 0.02, 0.3);
  disposables.push(trunkGeo);
  const trunk = new THREE.Mesh(trunkGeo, barkMat);
  trunk.castShadow = true;
  g.add(trunk);

  // a cloud-pruned tier of needles: a cluster of lumpy squashed
  // spheres, darker underneath (baked), so the edge breaks like dense
  // foliage instead of curving like a lily pad
  const addLump = (at, r) => {
    const geo = new THREE.SphereGeometry(1, 9, 5);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rand() - 0.5) * 0.55;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    geo.scale(r, r * 0.3, r * (0.75 + rand() * 0.4));
    geo.computeVertexNormals();
    bakeVerticalAO(geo, -r * 0.3, r * 0.22, 0.35);
    disposables.push(geo);
    const m = new THREE.Mesh(geo, padMat);
    m.position.copy(at);
    m.rotation.y = rand() * Math.PI * 2;
    m.castShadow = true;
    g.add(m);
  };
  // a cupped needle card, jittered in yaw/tilt/scale, shared geometry
  const addCard = (cx, cy, cz, s, yaw, tiltAxis, tilt) => {
    const m = new THREE.Mesh(needleCardGeo, needleMat);
    m.position.set(cx, cy, cz);
    m.rotation.y = yaw;
    if (tilt) m.rotateOnAxis(tiltAxis, tilt);
    m.scale.set(s, s, s);
    g.add(m);
  };
  const yAxis = new THREE.Vector3(1, 0, 0);
  const addPad = (at, r) => {
    // dimmed lump cores carry silhouette and mass from every angle
    addLump(new THREE.Vector3(at.x, at.y + r * 0.1, at.z), r);
    const lumps = 1 + Math.floor(rand() * 2);
    for (let li = 0; li < lumps; li++) {
      const a = rand() * Math.PI * 2, d = r * (0.5 + rand() * 0.45);
      addLump(new THREE.Vector3(
        at.x + Math.cos(a) * d,
        at.y + r * (0.02 + rand() * 0.1),
        at.z + Math.sin(a) * d), r * (0.45 + rand() * 0.3));
    }
    // needle cards over the core: a couple of flat canopy fans on top,
    // a ring of tilted skirt fans to fill the silhouette edge-on
    const canopy = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < canopy; i++) {
      addCard(
        at.x + (rand() - 0.5) * r * 0.5,
        at.y + r * (0.16 + rand() * 0.12),
        at.z + (rand() - 0.5) * r * 0.5,
        r * (0.85 + rand() * 0.5), rand() * Math.PI * 2,
        yAxis, (rand() - 0.5) * 0.5);
    }
    const skirt = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < skirt; i++) {
      const a = (i / skirt + rand() * 0.2) * Math.PI * 2;
      addCard(
        at.x + Math.cos(a) * r * 0.55,
        at.y + r * (0.02 + rand() * 0.08),
        at.z + Math.sin(a) * r * 0.55,
        r * (0.6 + rand() * 0.35), a,
        yAxis, 0.9 + rand() * 0.5);
    }
  };

  // crown pad at the trunk's tip, then a pad at each branch tip
  const tip = trunkCurve.getPoint(1);
  addPad(tip, 0.3 + rand() * 0.14);
  // always at least two lower tiers — a lone crown on a bare trunk
  // reads as broccoli, not a wind-trained pine
  const branches = 2 + Math.floor(rand() * 2);
  const at = new THREE.Vector3();
  for (let b = 0; b < branches; b++) {
    trunkCurve.getPoint(0.45 + rand() * 0.4, at);
    const az = leanA + (rand() - 0.5) * 2.8;  // mostly leeward
    const len = 0.2 + rand() * 0.28;
    const bTip = new THREE.Vector3(
      at.x + Math.cos(az) * len,
      at.y + len * (0.02 + rand() * 0.3),
      at.z + Math.sin(az) * len);
    const mid = at.clone().lerp(bTip, 0.55);
    mid.y -= len * 0.1;  // droop, then rise to the pad
    const bGeo = taperedTube(new THREE.CatmullRomCurve3([at.clone(), mid, bTip]), 5, 0.018, 0.4);
    disposables.push(bGeo);
    g.add(new THREE.Mesh(bGeo, barkMat));
    addPad(bTip, 0.15 + rand() * 0.15);
  }
  return g;
}

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
const _mossTint = new THREE.Color(0x4a6033);
const _pos = new THREE.Vector3(), _tan = new THREE.Vector3(), _side = new THREE.Vector3();

// settle a dressing piece onto an island: cast straight down and stand
// it where the rock actually is, instead of guessing from the bounds
const _dropRay = new THREE.Raycaster();
const _dropOrigin = new THREE.Vector3();
const _DOWN = new THREE.Vector3(0, -1, 0);
function dropOnto(rock, wx, wz, fromY) {
  _dropOrigin.set(wx, fromY, wz);
  _dropRay.set(_dropOrigin, _DOWN);
  const hit = _dropRay.intersectObject(rock, false)[0];
  return hit ? hit.point.y : null;
}
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
        // a gentle crown so the deck sheds moonlight like a real road
        const crown = 0.05 * (1 - (lat / (PATH_W / 2)) ** 2);
        posArr.push(
          _pos.x + _side.x * lat,
          _pos.y + crown + (rand() - 0.5) * 0.05,
          _pos.z + _side.z * lat
        );
        // moonlit tint: per-stone mottle over slow drifts of tone, plus
        // moss creeping in from the edges in patches — the low
        // frequencies are what kill the tiled look from a distance
        const drift = 1 + 0.11 * Math.sin(s * 0.13) + 0.09 * Math.sin(s * 0.047 + lat * 0.9);
        c.setHex(0xb8bdd4).multiplyScalar((0.86 + rand() * 0.28) * drift);
        const mossK = Math.max(0, Math.sin(s * 0.09 + idx * 2.1)) *
          (Math.abs(lat) / (PATH_W / 2)) ** 2 * 0.35;
        c.lerp(_mossTint, mossK);
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

    // the causeway's stone hull: ragged sides and a keel beneath the
    // deck, so the path reads as a floating bridge and not a ribbon
    const HULL = [
      [-PATH_W / 2 - 0.24, 0.12],
      [-PATH_W / 2 - 0.34, 0.55],
      [-PATH_W / 2 + 0.95, 1.3],
      [0, 1.75],
      [PATH_W / 2 - 0.95, 1.3],
      [PATH_W / 2 + 0.34, 0.55],
      [PATH_W / 2 + 0.24, 0.12],
    ];
    const hp = [], huv = [], hidx = [];
    for (let r = 0; r < rows; r++) {
      const s = s0 + r * 2;
      pathFrame(s, _pos, _tan, _side);
      for (let k = 0; k < HULL.length; k++) {
        const lat = HULL[k][0] * (1 + 0.05 * (rand() - 0.5));
        const drop = HULL[k][1] * (1 + 0.24 * (rand() - 0.5)) + 0.02;
        hp.push(_pos.x + _side.x * lat, _pos.y - drop, _pos.z + _side.z * lat);
        huv.push(s / 3.2, (k / (HULL.length - 1)) * 2.4);
      }
    }
    const HL = HULL.length;
    for (let r = 0; r < rows - 1; r++)
      for (let k = 0; k < HL - 1; k++) {
        const a = r * HL + k;
        hidx.push(a, a + HL, a + 1, a + 1, a + HL, a + HL + 1);
      }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    hg.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2));
    hg.setIndex(hidx);
    hg.computeVertexNormals();
    const hull = new THREE.Mesh(hg, skirtMat);
    hull.receiveShadow = true;
    group.add(hull);
    seg.disposables.push(hg);
  }

  // — weathered curb stones along both edges (instanced) —
  {
    const per = Math.floor(SEG_LEN / 1.6);
    const inst = new THREE.InstancedMesh(curbGeo, stoneDarkVertMat, per * 2);
    inst.castShadow = inst.receiveShadow = true;
    let n = 0;
    const q = new THREE.Quaternion(), qt = new THREE.Quaternion(), sc = new THREE.Vector3();
    const eul = new THREE.Euler(), tint = new THREE.Color();
    for (let sideSign = -1; sideSign <= 1; sideSign += 2) {
      for (let j = 0; j < per; j++) {
        if (rand() < 0.18) continue; // gaps — the gallery is old
        const s = s0 + j * 1.6 + rand();
        pathFrame(s, _pos, _tan, _side);
        const lat = sideSign * (PATH_W / 2 + 0.08 + rand() * 0.16);
        // sunk into the deck, not floated above it
        _p0.set(_pos.x + _side.x * lat, _pos.y + 0.04 + rand() * 0.07, _pos.z + _side.z * lat);
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _tan);
        // settled, not placed: every stone leans a little differently
        eul.set((rand() - 0.5) * 0.14, (rand() - 0.5) * 0.22, (rand() - 0.5) * 0.16);
        q.multiply(qt.setFromEuler(eul));
        sc.set(0.75 + rand() * 0.5, 0.75 + rand() * 0.55, 0.7 + rand() * 0.6);
        _m.compose(_p0, q, sc);
        inst.setMatrixAt(n, _m);
        inst.setColorAt(n, tint.setScalar(0.8 + rand() * 0.55));
        n++;
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

    const plinth = new THREE.Mesh(plinthGeo, stoneVertMat);
    plinth.position.y = 0.55;
    const cap = new THREE.Mesh(capGeo, stoneDarkMat);
    cap.position.y = 1.2;
    // carved footing and a neck under the cap, so the pedestal is
    // built masonry rather than one extruded lump
    const footing = new THREE.Mesh(plinthBaseGeo, stoneVertMat);
    footing.position.y = 0.09;
    const neck = new THREE.Mesh(plinthNeckGeo, stoneDarkMat);
    neck.position.y = 1.08;
    plinth.castShadow = plinth.receiveShadow = true;
    cap.castShadow = cap.receiveShadow = true;
    footing.castShadow = footing.receiveShadow = true;
    stand.add(plinth, cap, footing, neck);

    // frame + photo plane (rescaled to true aspect once loaded)
    const frameGroup = new THREE.Group();
    frameGroup.position.y = 2.55;
    frameGroup.rotation.x = -0.03;
    stand.add(frameGroup);

    const photoMat = new THREE.MeshBasicMaterial({ map: placeholderTex, toneMapped: false });
    const photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), photoMat);
    // the plate writes its own depth in the AO pre-pass; a flat plane
    // gathers no occlusion of its own, but without this the pass reads
    // the world behind the photo and prints its silhouette on the image
    photoMesh.userData.aoSolid = true;
    frameGroup.add(photoMesh);
    seg.disposables.push(photoMesh.geometry, photoMat);

    const border = new THREE.Mesh(moldedFrameGeometry(1, 1), goldMat);
    border.position.z = -0.02;
    border.castShadow = true;
    frameGroup.add(border);
    seg.disposables.push(border.geometry);

    // a soft magical glow behind the plate (a plane, so it never
    // slices through the photo the way a camera-facing sprite would)
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTex, color: 0xd7b46a, transparent: true,
        // real bloom carries the plate's glow now, so on the default pipeline
        // this sprite-based halo is halved (it used to double up and swallow
        // the plaques). LOW_FX has no composer, so this fake glow is its only
        // one — keep the original strength there.
        opacity: LOW_FX ? 0.3 : 0.16,
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
      border.geometry = moldedFrameGeometry(W, H);
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
      const post = new THREE.Mesh(postGeo, stoneDarkVertMat);
      post.position.y = 1.35;
      post.castShadow = true;
      const cage = new THREE.Mesh(cageGeo, goldMat);
      cage.position.y = 2.75;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 2.75;
      lantern.add(post, cage, flame);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: hotColor(COL.flame, 1.7), transparent: true,
      // bloom picks up the 1.7x flame now; halve the sprite halo on the
      // default pipeline. LOW_FX keeps the full sprite as its only glow.
      opacity: LOW_FX ? 0.75 : 0.38,
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
      const pillar = new THREE.Mesh(gatePillarGeo, stoneVertMat);
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
    // stand the arch at the segment's start, well clear of the photo
    // plate that always occupies the midpoint
    const s = s0 + 1.6;
    pathFrame(s, _pos, _tan, _side);
    const R = PATH_W / 2 + 1.3;
    // weathered stone bow — grain repeating along the arc at world
    // scale, not one rock texture stretched over the whole span
    const archGeo = scaleUV(new THREE.TorusGeometry(R, 0.34, 6, 22, Math.PI), 6, 1.4);
    const arch = new THREE.Mesh(archGeo, stoneDarkMat);
    // right-handed basis (side × up = -tan) — see the waygate note above;
    // the torus is symmetric, so the old mirrored basis merely got lucky
    _m.makeBasis(_side.clone(), new THREE.Vector3(0, 1, 0), _tan.clone().multiplyScalar(-1));
    arch.quaternion.setFromRotationMatrix(_m);
    arch.position.set(_pos.x, _pos.y + 1.2, _pos.z);
    arch.castShadow = true;
    group.add(arch);
    seg.disposables.push(arch.geometry);
    for (const ss of [-1, 1]) {
      const pillar = new THREE.Mesh(
        bakeVerticalAO(new THREE.BoxGeometry(0.8, 1.6, 0.8), -0.8, 0.2, 0.55), stoneDarkVertMat);
      pillar.position.set(_pos.x + _side.x * R * ss, _pos.y + 0.6, _pos.z + _side.z * R * ss);
      pillar.castShadow = pillar.receiveShadow = true;
      group.add(pillar);
      seg.disposables.push(pillar.geometry);
    }
  }

  // — floating islands adrift around the path —
  // photoscanned mossy rock (Poly Haven), yawed and stretched per island;
  // the jittered shards remain only as a fallback if the model failed
  {
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const s = s0 + rand() * SEG_LEN;
      pathFrame(s, _pos, _tan, _side);
      const lat = (rand() < 0.5 ? -1 : 1) * (9 + rand() * 26);
      const y = _pos.y + (rand() - 0.35) * 16 - 4;
      const phase = rand() * 9;
      let rock, topY, footR;
      if (rockProtos.length) {
        const proto = rockProtos[Math.floor(rand() * rockProtos.length)];
        rock = new THREE.Mesh(proto.geometry, proto.material);
        const k = (1.6 + rand() * 3.2) / proto.half;
        rock.scale.set(
          k * (0.8 + rand() * 0.5),
          k * (0.7 + rand() * 0.55),
          k * (0.8 + rand() * 0.5));
        rock.rotation.y = rand() * Math.PI * 2; // yaw only — the weathered top stays up
        topY = proto.height * rock.scale.y;
        footR = proto.half * rock.scale.x;
      } else {
        rock = new THREE.Mesh(rockGeos[Math.floor(rand() * rockGeos.length)], stoneDarkMat);
        rock.scale.setScalar(1 + rand() * 3.2);
        rock.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
        topY = rock.scale.y * 0.55;
        footR = rock.scale.x * 0.8;
      }
      rock.receiveShadow = true;
      rock.position.set(_pos.x + _side.x * lat, y, _pos.z + _side.z * lat);
      group.add(rock);
      // everything standing on (or hanging from) the island shares its
      // bob, or the dressing would drift apart from the ground
      const rockAmp = 0.35 + rand() * 0.5;
      seg.bobbers.push({ obj: rock, base: y, amp: rockAmp, phase });
      rock.updateMatrixWorld();

      // — a windswept mountain pine where the island can carry one —
      if (footR > 1.4 && rand() < 0.7) {
        const tree = makeMountainPine(rand, seg.disposables);
        // never tiny: a crown a few pixels tall reads as dead sticks
        tree.scale.setScalar(2.4 + rand() * 2.2);
        const ox = (rand() - 0.5) * footR * 0.5, oz = (rand() - 0.5) * footR * 0.5;
        const ty = dropOnto(rock, rock.position.x + ox, rock.position.z + oz, rock.position.y + topY + 5);
        if (ty !== null) {
          tree.position.set(rock.position.x + ox, ty - 0.06, rock.position.z + oz);
          group.add(tree);
          seg.bobbers.push({ obj: tree, base: tree.position.y, amp: rockAmp, phase });
        }
      }

      // — grass tufts and fallen stones on the weathered top —
      const tufts = footR > 0.9 ? 2 + Math.floor(rand() * 4) : 0;
      for (let ti = 0; ti < tufts; ti++) {
        const ox = (rand() - 0.5) * footR * 1.1, oz = (rand() - 0.5) * footR * 1.1;
        const ty = dropOnto(rock, rock.position.x + ox, rock.position.z + oz, rock.position.y + topY + 5);
        if (ty === null) continue;
        const isStone = rand() < 0.3;
        const bit = isStone
          ? new THREE.Mesh(rockGeos[Math.floor(rand() * rockGeos.length)], stoneDarkMat)
          : new THREE.Mesh(grassTuftGeo, grassMat);
        bit.scale.setScalar(isStone ? 0.07 + rand() * 0.1 : 0.7 + rand() * 1.1);
        bit.rotation.y = rand() * Math.PI * 2;
        bit.position.set(rock.position.x + ox, ty - 0.03, rock.position.z + oz);
        group.add(bit);
        seg.bobbers.push({ obj: bit, base: bit.position.y, amp: rockAmp, phase });
      }

      // — roots trailing into the sky beneath —
      const roots = footR > 1.1 ? 1 + Math.floor(rand() * 3) : 0;
      for (let ri = 0; ri < roots; ri++) {
        const root = new THREE.Mesh(rootGeo, stoneDarkMat);
        root.scale.set(0.5 + rand() * 0.8, 0.6 + rand() * 1.6, 0.5 + rand() * 0.8);
        root.rotation.set((rand() - 0.5) * 0.35, 0, (rand() - 0.5) * 0.35);
        root.position.set(
          rock.position.x + (rand() - 0.5) * footR * 0.6,
          rock.position.y + 0.18,
          rock.position.z + (rand() - 0.5) * footR * 0.6);
        group.add(root);
        seg.bobbers.push({ obj: root, base: root.position.y, amp: rockAmp, phase });
      }
    }
  }

  scene.add(group);
  segments.set(idx, seg);
}

// picture-frame molding swept around the plate: a stepped ogee profile
// (u outward from the photo's edge, z proud of it), mitred at the
// corners by construction since every ring is a concentric rectangle
const FRAME_PROFILE = [
  [0.000, -0.030],  // closed back against the plate
  [0.132, -0.020],  // outer edge
  [0.128, 0.058],   // outer bead
  [0.108, 0.096],
  [0.086, 0.080],   // trough of the ogee
  [0.056, 0.088],   // crown
  [0.030, 0.052],   // step down
  [0.012, 0.062],   // inner bead
  [-0.014, 0.034],  // lip overhanging the photo's edge, as a rabbet does
];
function moldedFrameGeometry(w, h) {
  const P = FRAME_PROFILE;
  const pos = [], uv = [], idx = [];
  const sides = [
    (u) => [-(w / 2 + u), h / 2 + u, w / 2 + u, h / 2 + u],       // top
    (u) => [w / 2 + u, h / 2 + u, w / 2 + u, -(h / 2 + u)],       // right
    (u) => [w / 2 + u, -(h / 2 + u), -(w / 2 + u), -(h / 2 + u)], // bottom
    (u) => [-(w / 2 + u), -(h / 2 + u), -(w / 2 + u), h / 2 + u], // left
  ];
  for (const side of sides) {
    const base = pos.length / 3;
    for (let k = 0; k < P.length; k++) {
      const [xa, ya, xb, yb] = side(P[k][0]);
      pos.push(xa, ya, P[k][1], xb, yb, P[k][1]);
      const v = k / (P.length - 1);
      uv.push(0, v, 2, v);
    }
    for (let k = 0; k < P.length - 1; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // fireflies belong to the near path: they carry no fog, so without
      // this fade they read as crisp specks floating over the distant mist
      vA = (0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 1.7 + aPhase), 2.0))
        * smoothstep(55.0, 24.0, -mv.z);
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
    // the two lights that visit the nearest flames burn hard enough to
    // throw true shadows; the rest of the pool stays cheap
    if (i < 2) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 0.3;
      l.shadow.camera.far = 15;
      l.shadow.bias = -0.006;
    }
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
// A slow, breathing cloud sea far beneath the causeway. Domain-warped
// FBM gives it real billows and troughs; two scroll velocities layer
// large slow forms under smaller faster detail; billows that rise toward
// the moon catch a cool highlight while troughs sink toward the fog. The
// noise is anchored in world space, so the sea stays put while the plane
// that carries it follows the walker. Two planes at different heights and
// speeds give the parallax of weather with depth.
// horizontal bearing of the moon, for the highlight on moon-facing slopes
const _mh = new THREE.Vector2(MOON_DIR.x, MOON_DIR.z).normalize();
const mistLayers = [];
function makeMistMat({ scale, speed, opacity, seed }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 }, uSpeed: { value: speed }, uScale: { value: scale },
      uOpacity: { value: opacity }, uSeed: { value: seed },
      uMoon: { value: _mh.clone() },
    },
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
      uniform float uTime, uSpeed, uScale, uOpacity, uSeed;
      uniform vec2 uMoon;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 3; k++) { v += a * noise(p); p *= 2.11; a *= 0.5; }
        return v;
      }
      void main() {
        float T = uTime * uSpeed;
        vec2 p = vWorld.xz * uScale;
        // domain warp: large slow forms fold the field into billows
        vec2 warp = vec2(fbm(p * 0.5 + T * 0.9),
                         fbm(p * 0.5 + 5.2 - T * 0.7)) - 0.5;
        vec2 pw = p + warp * 1.5 + vec2(T, T * 0.6);
        float big = fbm(pw);
        // smaller, faster detail riding on top of the slow swell
        float detail = fbm(p * 3.2 - vec2(T * 2.3, T * 1.4));
        float field = big * 0.72 + detail * 0.28 + uSeed;
        float m = smoothstep(0.30, 0.86, field);
        // a cheap surface slope from two offset taps of the warped field,
        // so billows leaning toward the moon catch its cool light
        float e = 0.55;
        vec2 grad = vec2(fbm(pw + vec2(e, 0.0)) - big, fbm(pw + vec2(0.0, e)) - big);
        float toMoon = clamp(dot(normalize(grad + 1e-4), uMoon) * 0.5 + 0.5, 0.0, 1.0);
        vec3 trough = vec3(0.05, 0.062, 0.115);
        vec3 crest  = vec3(0.20, 0.235, 0.33);
        vec3 col = mix(trough, crest, m);
        // moon-facing crests catch a cool highlight; troughs stay in shade
        col += vec3(0.10, 0.13, 0.185) * toMoon * m;
        // the plane's rim must never show; a low alpha floor keeps the
        // troughs present as haze instead of punching back to bare sky
        float rim = smoothstep(0.5, 0.22, distance(vUv, vec2(0.5)));
        gl_FragColor = vec4(col, (0.12 + 0.88 * m) * rim * uOpacity);
      }`,
  });
}
let mist = null;
if (!LOW_FX) {
  // the near sea: broad moonlit billows just below the deck
  const nearMat = makeMistMat({ scale: 0.010, speed: 0.011, opacity: 0.8, seed: 0.0 });
  mist = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), nearMat);
  mist.rotation.x = -Math.PI / 2;
  mist.renderOrder = -2;
  scene.add(mist);
  mistLayers.push({ mesh: mist, mat: nearMat, drop: 18 });
  // a fainter, slower deep layer for parallax
  const farMat = makeMistMat({ scale: 0.006, speed: 0.006, opacity: 0.42, seed: 0.06 });
  const mistFar = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), farMat);
  mistFar.rotation.x = -Math.PI / 2;
  mistFar.renderOrder = -3;
  scene.add(mistFar);
  mistLayers.push({ mesh: mistFar, mat: farMat, drop: 46 });
  skyGroup.userData.mistMat = nearMat;
}

// stray wisps of the mist sea, lapping at the causeway's flanks
const mistWisps = [];
if (!LOW_FX) {
  const wispTex = makeGlowTexture('#aeb8d8');
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: wispTex, color: 0x9fb0d8, transparent: true, opacity: 0.05,
      depthWrite: false,
    }));
    // wide and squat, held off the deck's flanks — a wisp that wanders
    // over the walkway reads as a glowing orb, not weather
    sp.scale.set(16 + i * 3, 3.6, 1);
    scene.add(sp);
    mistWisps.push({ sp, off: 18 + i * 31, lat: (i % 2 ? -1 : 1) * (5.5 + i * 1.6), ph: i * 2.1 });
  }
}
function updateMistWisps(t) {
  for (const w of mistWisps) {
    const s = player.s + w.off + Math.sin(t * 0.05 + w.ph) * 6;
    pathFrame(s, _pos, _tan, _side);
    const drift = w.lat + Math.sin(t * 0.11 + w.ph * 3) * 2;
    w.sp.position.set(
      _pos.x + _side.x * drift,
      _pos.y - 0.6 + Math.sin(t * 0.13 + w.ph) * 0.5,
      _pos.z + _side.z * drift);
  }
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
  gradePass?.uniforms.uResolution.value.set(innerWidth, innerHeight);
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
// Depth-of-field for the inspect view was evaluated and deferred: three's
// BokehPass re-renders the whole scene through its own depth material, so
// it cannot compose with this pipeline's GTAO + bloom HDR passes without
// either discarding them or paying for a second full scene render — a
// poor trade against the 60fps-on-integrated-GPU target. A screen-space
// DOF would need a depth texture the composer doesn't expose after GTAO.
// The gold frame's own glow and the dimmed, distant backdrop already give
// the beheld plate ample separation, so the grade ships without DOF.
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
    const [res] = await Promise.all([fetch('/api/photos'), loadLantern(), loadIsleRocks()]);
    buildHorizonIsles();
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
  updateMistWisps(t);
  for (const layer of mistLayers) {
    layer.mesh.position.set(camera.position.x, camera.position.y - layer.drop, camera.position.z);
    layer.mat.uniforms.uTime.value = t;
  }
  auroraMat.uniforms.uTime.value = t;

  skyGroup.position.copy(camera.position);
  skyGroup.userData.starMat.uniforms.uTime.value = t;
  ffMat.uniforms.uTime.value = t;
  if (gradePass) gradePass.uniforms.uTime.value = t;

  hoverTick += dt;
  if (hoverTick > 0.08) { hoverTick = 0; updateHover(); updateWing(); }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

boot();
animate();
