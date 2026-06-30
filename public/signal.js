import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// === DOM ===
const $ = id => document.getElementById(id);
const container = $('canvasWrap');
const statusTextEl = $('statusText');
const statusSubEl = $('statusSub');

// === State ===
let state = 'idle';            // 'idle' | 'running' | 'waiting'
let lastActivity = null;       // ms
let fallbackWindow = 30;       // seconds
let hooksActive = false;

// === Three.js scene ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232a3a);
scene.fog = new THREE.Fog(0x232a3a, 11, 26);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 0.4, 8.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
container.appendChild(renderer.domElement);

// PBR environment — generated asynchronously after first paint so initial load
// isn't blocked by PMREM compilation (~150-300ms on cold start). Materials look
// slightly flatter for the first 1-2 frames, then snap into reflective mode.
let envInstalled = false;
function installEnvironment() {
  if (envInstalled) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  envInstalled = true;
}

// Lighting — env handles fill, these add direction + rim separation
scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.65);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xaaccff, 0.25);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0x8fa3c6, 0.4);
rimLight.position.set(0, 1, -5);
scene.add(rimLight);

const root = new THREE.Group();
scene.add(root);

// === Housing ===
const HOUSING_H = 4.2;
const HOUSING_W = 1.5;
const HOUSING_D = 0.75;

// Main housing — slightly more metallic, with PBR env reflections
const housingMat = new THREE.MeshStandardMaterial({
  color: 0x1f232b, roughness: 0.42, metalness: 0.78,
  envMapIntensity: 0.85
});
root.add(new THREE.Mesh(
  new RoundedBoxGeometry(HOUSING_W, HOUSING_H, HOUSING_D, 8, 0.16), housingMat
));

// Side mounting flanges — small rectangular protrusions on left/right
const flangeMat = new THREE.MeshStandardMaterial({
  color: 0x16191f, roughness: 0.5, metalness: 0.75
});
for (const dir of [-1, 1]) {
  const flange = new THREE.Mesh(
    new RoundedBoxGeometry(0.18, 0.6, 0.55, 3, 0.04), flangeMat
  );
  flange.position.set(dir * (HOUSING_W / 2 + 0.04), 0, 0);
  root.add(flange);
  // small bolts on flange
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.3, metalness: 0.95 });
  for (const dy of [-0.18, 0.18]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8), boltMat);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(dir * (HOUSING_W / 2 + 0.13), dy, 0);
    root.add(bolt);
  }
}

// Top mounting bracket — small bracket on the back-top suggesting wall/pole mount
const bracketMat = new THREE.MeshStandardMaterial({
  color: 0x1a1d23, roughness: 0.55, metalness: 0.8
});
const bracket = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.18, 0.45, 3, 0.05), bracketMat);
bracket.position.set(0, HOUSING_H / 2 + 0.05, -0.12);
root.add(bracket);
const bracketArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12), bracketMat);
bracketArm.position.set(0, HOUSING_H / 2 + 0.32, -0.12);
root.add(bracketArm);
const bracketCap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), bracketMat);
bracketCap.position.set(0, HOUSING_H / 2 + 0.5, -0.12);
root.add(bracketCap);

// Front bezel — slightly recessed panel + 4 corner screws
const bezelMat = new THREE.MeshStandardMaterial({
  color: 0x0c0e12, roughness: 0.6, metalness: 0.35,
  envMapIntensity: 0.6
});
const bezel = new THREE.Mesh(
  new RoundedBoxGeometry(1.3, HOUSING_H - 0.2, 0.05, 4, 0.1), bezelMat
);
bezel.position.z = 0.38;
root.add(bezel);

const screwMat = new THREE.MeshStandardMaterial({
  color: 0xaab2c0, roughness: 0.32, metalness: 0.92
});
for (const sx of [-0.55, 0.55]) {
  for (const sy of [-HOUSING_H / 2 + 0.22, HOUSING_H / 2 - 0.22]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 14), screwMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(sx, sy, 0.42);
    root.add(screw);
    // Phillips slot — tiny dark crosshair using thin boxes
    const slot1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.008, 0.005),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    slot1.position.set(sx, sy, 0.438);
    root.add(slot1);
    const slot2 = slot1.clone();
    slot2.rotation.z = Math.PI / 2;
    root.add(slot2);
  }
}

// === Pole + base ===
const poleMat = new THREE.MeshStandardMaterial({
  color: 0x262b34, roughness: 0.5, metalness: 0.78
});
// upper connector ring under housing
const connector = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 24), poleMat);
connector.position.y = -HOUSING_H / 2 - 0.06;
root.add(connector);
// main pole — taller and more substantial
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 20), poleMat);
pole.position.y = -HOUSING_H / 2 - 0.35;
root.add(pole);
// decorative ring midway on pole
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 10, 28),
  new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.4, metalness: 0.9 }));
ring.rotation.x = Math.PI / 2;
ring.position.y = -HOUSING_H / 2 - 0.35;
root.add(ring);
// pedestal — two-tier base for a more grounded look
const baseTop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.48, 0.07, 36), poleMat);
baseTop.position.y = -HOUSING_H / 2 - 0.66;
root.add(baseTop);
const baseBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.1, 36),
  new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.7, metalness: 0.5 }));
baseBottom.position.y = -HOUSING_H / 2 - 0.78;
root.add(baseBottom);

// Soft radial-gradient halo texture (shared by all lenses)
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const GLOW_TEX = makeGlowTexture();

// Lens factory
function makeLens(yOffset, hex) {
  const group = new THREE.Group();

  // Recessed cavity ring (dark inset behind the lens) — adds depth
  const cavity = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.06, 36, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x06080b, roughness: 0.85, metalness: 0.4, side: THREE.DoubleSide })
  );
  cavity.rotation.x = Math.PI / 2;
  cavity.position.set(0, yOffset, 0.38);
  group.add(cavity);
  const cavityBack = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 36),
    new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9, metalness: 0.2 })
  );
  cavityBack.position.set(0, yOffset, 0.355);
  group.add(cavityBack);

  // Glassy dome lens — MeshPhysicalMaterial with clearcoat for a polished glass look
  const lensGeom = new THREE.SphereGeometry(0.42, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  lensGeom.rotateX(Math.PI / 2);
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: hex, emissive: hex, emissiveIntensity: 0.08,
    roughness: 0.18, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: 0.6
  });
  const lens = new THREE.Mesh(lensGeom, lensMat);
  lens.position.set(0, yOffset, 0.42);
  group.add(lens);

  // Inner bright "hot core" — flat disc with MeshBasicMaterial, fully unlit
  const coreMat = new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0
  });
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.32, 48), coreMat);
  core.position.set(0, yOffset, 0.78);
  group.add(core);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.045, 16, 64),
    new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.4, metalness: 0.92, envMapIntensity: 1.0 })
  );
  rim.position.set(0, yOffset, 0.42);
  group.add(rim);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.2, 32, 1, true, -Math.PI / 2, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.65, metalness: 0.55, side: THREE.DoubleSide })
  );
  visor.rotation.x = -Math.PI / 2;
  visor.position.set(0, yOffset + 0.46, 0.55);
  group.add(visor);

  // Halo sprite (additive blend) — sits in front of the lens
  const haloMat = new THREE.SpriteMaterial({
    map: GLOW_TEX,
    color: hex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(2.4, 2.4, 1);
  halo.position.set(0, yOffset, 0.85);
  group.add(halo);

  const glowLight = new THREE.PointLight(hex, 0, 7, 1.8);
  glowLight.position.set(0, yOffset, 1.2);
  group.add(glowLight);

  const spillLight = new THREE.PointLight(hex, 0, 2.5, 2);
  spillLight.position.set(0, yOffset, 0.05);
  group.add(spillLight);

  root.add(group);
  return { material: lensMat, core: coreMat, halo: haloMat, glow: glowLight, spill: spillLight };
}

const LENS_Y = 1.25;
const redLens    = makeLens( LENS_Y, 0xff3030);
const yellowLens = makeLens( 0,      0xffc233);
const greenLens  = makeLens(-LENS_Y, 0x35ff7a);

// Floor
{
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6, 64),
    new THREE.MeshBasicMaterial({ color: 0x161a24, transparent: true, opacity: 0.55 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -HOUSING_H / 2 - 0.58;
  root.add(floor);
}

// OrbitControls — manual rotation only
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableZoom = false;
controls.autoRotate = false;
controls.minPolarAngle = Math.PI / 2.6;
controls.maxPolarAngle = Math.PI / 1.8;
controls.target.set(0, 0, 0);

function resize() {
  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();

function setLensOff(L) {
  L.material.emissiveIntensity = 0.06;
  L.core.opacity = 0;
  L.halo.opacity = 0;
  L.glow.intensity = 0;
  L.spill.intensity = 0;
}

function pulseLens(L, t, periodSec, baseEm, peakEm, baseGlow, peakGlow) {
  const omega = (2 * Math.PI) / periodSec;
  const pulse = 0.5 * Math.sin(t * omega) + 0.5; // 0..1
  L.material.emissiveIntensity = baseEm + pulse * (peakEm - baseEm);
  L.core.opacity = 0.55 + pulse * 0.35;       // bright inner disc, ~0.55..0.9
  L.halo.opacity = 0.5 + pulse * 0.4;         // additive bloom halo, ~0.5..0.9
  L.glow.intensity = baseGlow + pulse * (peakGlow - baseGlow);
  L.spill.intensity = 0.8 + pulse * 0.6;
}

function applyLensState(t) {
  setLensOff(redLens);
  setLensOff(yellowLens);
  setLensOff(greenLens);

  if (state === 'running') {
    pulseLens(greenLens, t, 1.3, 2.4, 4.2, 4.5, 7.5);
  } else if (state === 'waiting') {
    pulseLens(yellowLens, t, 0.9, 2.6, 4.6, 5.0, 8.0);
  } else {
    pulseLens(redLens, t, 2.4, 2.2, 3.6, 3.8, 6.0);
  }
}

let firstFrameDrawn = false;
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  applyLensState(t);
  controls.update();
  renderer.render(scene, camera);
  if (!firstFrameDrawn) {
    firstFrameDrawn = true;
    // Schedule env install after the browser has shown something
    (window.requestIdleCallback || window.requestAnimationFrame)(installEnvironment);
  }
}
animate();

// === Text + body class ===
function renderText() {
  const body = document.body;
  body.classList.remove('state-idle', 'state-running', 'state-waiting');
  body.classList.add('state-' + state);

  const secs = lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : null;
  if (state === 'running') {
    statusTextEl.textContent = '正在调用';
    document.title = '● Claude 运行中';
    statusSubEl.textContent =
      secs === null ? '—' : secs <= 0 ? '刚刚有事件' : `${secs} 秒前有事件`;
  } else if (state === 'waiting') {
    statusTextEl.textContent = '等待用户授权';
    document.title = '⚠ Claude 等待中';
    statusSubEl.textContent =
      secs === null ? '—' : `${secs} 秒前请求授权`;
  } else {
    statusTextEl.textContent = '空闲';
    document.title = '○ Claude 空闲';
    if (lastActivity) {
      const tStr = new Date(lastActivity).toLocaleTimeString();
      statusSubEl.textContent = `上次活动 ${tStr}`;
    } else {
      statusSubEl.textContent = '尚未检测到活动';
    }
  }
}

// === Data plumbing ===
function applySnapshot(s) {
  if (!s) return;
  state = s.state || 'idle';
  lastActivity = s.lastActivityTs || (s.lastActivity ? Date.parse(s.lastActivity) : null);
  hooksActive = !!s.hooksActive;
  if (s.fallbackWindowSeconds) fallbackWindow = s.fallbackWindowSeconds;
  renderText();
}

async function refreshStatus() {
  try {
    const r = await fetch('/api/status');
    applySnapshot(await r.json());
  } catch (e) {
    console.error('refreshStatus', e);
  }
}

function connectSSE() {
  const es = new EventSource('/events');
  es.addEventListener('hello', evt => {
    try { applySnapshot(JSON.parse(evt.data)); } catch {}
  });
  es.addEventListener('state-change', evt => {
    try { applySnapshot(JSON.parse(evt.data)); } catch {}
  });
  es.addEventListener('file-change', evt => {
    try {
      const data = JSON.parse(evt.data);
      // file-change payload includes a full snapshot
      applySnapshot(data);
    } catch {}
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// Local tick: in fallback (no hooks) flip running→idle once window elapsed
setInterval(() => {
  if (!hooksActive && state === 'running' && lastActivity
      && Date.now() - lastActivity >= fallbackWindow * 1000) {
    state = 'idle';
  }
  renderText();
}, 1000);

refreshStatus();
setInterval(refreshStatus, 5000);
connectSSE();
