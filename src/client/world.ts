// The 3D view: isometric camera, the house, props, players and effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MapDef } from '../shared/map';
import { PROPS, propExtents } from '../shared/props';

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();

function loadModel(path: string): Promise<THREE.Group> {
  let p = modelCache.get(path);
  if (!p) {
    p = loader.loadAsync(`/models/${path}.gltf`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      return g.scene;
    });
    modelCache.set(path, p);
  }
  return p;
}

/** A positioned, scaled copy of a prop's model whose base sits on y = 0. */
async function propObject(type: string): Promise<THREE.Object3D> {
  const t = PROPS[type];
  const src = await loadModel(t.model);
  const inner = src.clone(true);
  inner.scale.setScalar(t.scale);
  inner.position.set(t.offset[0], t.offset[1], t.offset[2]);
  const holder = new THREE.Group();
  holder.add(inner);
  return holder;
}

export interface RenderPlayer {
  id: string;
  x: number;
  z: number;
  r: number;
  d: string;
  color: string;
  name: string;
  showName: boolean;
  seeker: boolean;
  self: boolean;
}

interface PlayerView {
  root: THREE.Group;
  body: THREE.Object3D | null;
  disguise: string | null;
  label: THREE.Sprite | null;
  labelText: string;
  ring: THREE.Mesh | null;
  pending: boolean;
}

interface Effect { obj: THREE.Object3D; born: number; life: number; update(t: number, k: number): void }

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private sun: THREE.DirectionalLight;
  private mapGroup = new THREE.Group();
  private propsGroup = new THREE.Group();
  private playersGroup = new THREE.Group();
  private walls: { mesh: THREE.Mesh; x: number; z: number; hx: number; hz: number }[] = [];
  private propObjects = new Map<string, THREE.Object3D>();
  private players = new Map<string, PlayerView>();
  private effects: Effect[] = [];
  private selectRing: THREE.Mesh;
  private camTarget = new THREE.Vector3(14, 0, 10);
  private viewHeight = 13;
  map: MapDef | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Phones have 3x screens; 1.5x looks the same at this zoom and draws far fewer pixels.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#241d45');

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7fa8, 1.7));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.mapGroup, this.propsGroup, this.playersGroup);

    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.95, depthTest: false }));
    this.selectRing.renderOrder = 10;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Keep at least ~11 units across on a narrow phone.
    const vh = Math.max(this.viewHeight, 11 / aspect);
    this.camera.top = vh / 2; this.camera.bottom = -vh / 2;
    this.camera.left = (-vh * aspect) / 2; this.camera.right = (vh * aspect) / 2;
    this.camera.updateProjectionMatrix();
  }

  async loadMap(map: MapDef) {
    if (this.map?.id === map.id) return;
    this.map = map;
    this.mapGroup.clear();
    this.propsGroup.clear();
    this.propObjects.clear();
    this.walls = [];

    // Ground around the house.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width + 40, map.depth + 40), new THREE.MeshStandardMaterial({ color: '#8fc27a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(map.width / 2, -0.06, map.depth / 2);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);

    for (const room of map.rooms) {
      const w = room.x1 - room.x0, d = room.z1 - room.z0;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), new THREE.MeshStandardMaterial({ color: room.floor, roughness: 0.9 }));
      floor.position.set(room.x0 + w / 2, -0.05, room.z0 + d / 2);
      floor.receiveShadow = true;
      this.mapGroup.add(floor);
    }
    const wallMat = new THREE.MeshStandardMaterial({ color: map.wallColor, roughness: 0.85 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#a8876a', roughness: 0.9 });
    for (const w of map.walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2, map.wallHeight, w.hz * 2), wallMat.clone());
      mesh.position.set(w.x, map.wallHeight / 2, w.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2 + 0.02, 0.06, w.hz * 2 + 0.02), capMat.clone());
      cap.position.y = map.wallHeight / 2 + 0.03;
      mesh.add(cap);
      this.mapGroup.add(mesh);
      this.walls.push({ mesh, ...w });
    }

    const s = Math.max(map.width, map.depth);
    this.sun.position.set(map.width / 2 + 10, 22, map.depth / 2 + 6);
    this.sun.target.position.set(map.width / 2, 0, map.depth / 2);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
    this.sun.shadow.camera.updateProjectionMatrix();

    await Promise.all(map.props.map(async (p) => {
      const obj = await propObject(p.type);
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = (p.rot * Math.PI) / 2;
      obj.userData.entity = p.id;
      // Props never move, so skip their per-frame matrix updates.
      obj.updateMatrixWorld(true);
      obj.traverse((o) => { o.matrixAutoUpdate = false; });
      this.propsGroup.add(obj);
      this.propObjects.set(p.id, obj);
    }));
  }

  /** Create, update and remove player views to match this frame's list. */
  setPlayers(list: RenderPlayer[]) {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.players.get(p.id);
      if (!v) {
        v = { root: new THREE.Group(), body: null, disguise: null, label: null, labelText: '', ring: null, pending: false };
        v.root.userData.entity = p.id;
        this.playersGroup.add(v.root);
        this.players.set(p.id, v);
      }
      v.root.position.set(p.x, 0, p.z);
      if (v.disguise !== (p.d || null) && !v.pending) this.rebuildBody(v, p);
      if (v.body) v.body.rotation.y = p.r;
      const text = p.showName ? (p.self ? 'You' : p.name) : '';
      if (text !== v.labelText) this.setLabel(v, text, p.color, p.d ? PROPS[p.d].height : 1.6);
      if (p.self && !v.ring) {
        const g = new THREE.RingGeometry(0.55, 0.7, 40);
        g.rotateX(-Math.PI / 2);
        v.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.9 }));
        v.ring.position.y = 0.02;
        v.root.add(v.ring);
      }
      if (v.ring) {
        const t = p.d ? PROPS[p.d] : null;
        v.ring.scale.setScalar(t ? Math.max(t.hx, t.hz) * 1.6 + 0.4 : 1);
      }
    }
    for (const [id, v] of this.players) {
      if (!seen.has(id)) { this.playersGroup.remove(v.root); this.players.delete(id); }
    }
  }

  private rebuildBody(v: PlayerView, p: RenderPlayer) {
    const want = p.d || null;
    if (v.body) { v.root.remove(v.body); v.body = null; }
    v.disguise = want;
    if (!want) {
      v.body = makeCharacter(p.color, p.seeker);
      v.root.add(v.body);
      return;
    }
    v.pending = true;
    void propObject(want).then((obj) => {
      v.pending = false;
      if (v.disguise !== want) return;
      if (v.body) v.root.remove(v.body);
      v.body = obj;
      v.root.add(obj);
    });
  }

  private setLabel(v: PlayerView, text: string, color: string, height: number) {
    if (v.label) { v.root.remove(v.label); v.label.material.map?.dispose(); v.label.material.dispose(); v.label = null; }
    v.labelText = text;
    if (!text) return;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '800 30px Nunito, system-ui, sans-serif';
    const w = Math.min(240, g.measureText(text).width + 28);
    g.fillStyle = 'rgba(43,35,80,0.85)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 10, w, 44, 22);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(2.4, 0.6, 1);
    s.position.y = height + 0.6;
    s.renderOrder = 20;
    v.root.add(s);
    v.label = s;
  }

  /** Highlight an entity (prop id or player id) with a ring on the floor. */
  select(id: string | null) {
    if (!id) { this.selectRing.visible = false; return; }
    const ext = this.extents(id);
    if (!ext) { this.selectRing.visible = false; return; }
    this.selectRing.visible = true;
    this.selectRing.position.set(ext.x, 0.04, ext.z);
    this.selectRing.scale.setScalar(Math.max(ext.hx, ext.hz) * 1.25 + 0.3);
  }

  /** Floor position and half extents of an entity. */
  extents(id: string): { x: number; z: number; hx: number; hz: number } | null {
    const prop = this.map?.props.find((p) => p.id === id);
    if (prop) {
      const [hx, hz] = propExtents(PROPS[prop.type], prop.rot);
      return { x: prop.x, z: prop.z, hx, hz };
    }
    const v = this.players.get(id);
    if (v) {
      const t = v.disguise ? PROPS[v.disguise] : null;
      return { x: v.root.position.x, z: v.root.position.z, hx: t ? t.hx : 0.4, hz: t ? t.hz : 0.4 };
    }
    return null;
  }

  /** The entity under a screen point, if any. */
  pick(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([this.playersGroup, this.propsGroup], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.entity) o = o.parent;
      if (o?.userData.entity) return o.userData.entity as string;
    }
    return null;
  }

  /** Screen x of a world point in -1..1 (for stereo panning). */
  screenX(x: number, z: number): number {
    const v = new THREE.Vector3(x, 0.5, z).project(this.camera);
    return Math.max(-1, Math.min(1, v.x));
  }

  follow(x: number, z: number, snap = false) {
    const t = new THREE.Vector3(x, 0, z);
    if (snap) this.camTarget.copy(t);
    else this.camTarget.lerp(t, 0.15);
  }

  /** Musical note bubble rising from a spot. */
  ping(x: number, z: number, color = '#ffcc33') {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2350';
    g.font = '800 80px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('♪', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.renderOrder = 30;
    s.position.set(x, 1.5, z);
    this.scene.add(s);
    this.effects.push({ obj: s, born: performance.now(), life: 1800, update(_t, k) {
      s.position.y = 1.5 + k * 1.6;
      s.scale.setScalar(0.8 + Math.sin(k * Math.PI) * 0.4);
      (s.material as THREE.SpriteMaterial).opacity = 1 - k * k;
    } });
  }

  /** Brief glowing column showing where a hider is. */
  reveal(x: number, z: number) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 4, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, 2, z);
    this.scene.add(m);
    this.effects.push({ obj: m, born: performance.now(), life: 1200, update(_t, k) {
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    } });
  }

  /** Puff of confetti when a hider is found. */
  poof(x: number, z: number) {
    const group = new THREE.Group();
    const colors = ['#ff7a59', '#ffcc33', '#4cb5ff', '#7ed957', '#c58bff'];
    const parts: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      m.position.set(0, 0.8, 0);
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      parts.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 3, Math.sin(a) * s) });
      group.add(m);
    }
    group.position.set(x, 0, z);
    this.scene.add(group);
    let last = 0;
    this.effects.push({ obj: group, born: performance.now(), life: 1400, update(_t, k) {
      const dt = (k - last) * 1.4; last = k;
      for (const p of parts) {
        p.v.y -= 9.8 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0.06) { p.m.position.y = 0.06; p.v.set(0, 0, 0); }
        p.m.rotation.x += dt * 8;
      }
    } });
  }

  render() {
    const now = performance.now();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const k = (now - e.born) / e.life;
      if (k >= 1) { this.scene.remove(e.obj); disposeTree(e.obj); this.effects.splice(i, 1); continue; }
      e.update(now, k);
    }
    if (this.selectRing.visible) {
      (this.selectRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(now / 160) * 0.3;
    }
    // Fade walls standing between the camera and the followed spot.
    const tx = this.camTarget.x, tz = this.camTarget.z;
    for (const w of this.walls) {
      const near = Math.abs(w.x - tx) < w.hx + 3.2 && Math.abs(w.z - tz) < w.hz + 3.2;
      const inFront = w.x + w.z > tx + tz + 0.3;
      const mat = w.mesh.material as THREE.MeshStandardMaterial;
      const target = near && inFront ? 0.22 : 1;
      mat.transparent = true;
      mat.opacity += (target - mat.opacity) * 0.2;
      mat.depthWrite = mat.opacity > 0.9;
    }
    const d = 30;
    this.camera.position.set(this.camTarget.x + d, d * 0.82, this.camTarget.z + d);
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }
}

// Characters share geometry and materials so swapping and respawning never
// allocates new GPU buffers.
const charGeo = {
  body: new THREE.CapsuleGeometry(0.38, 0.55, 6, 16),
  eye: new THREE.SphereGeometry(0.1, 12, 12),
  pupil: new THREE.SphereGeometry(0.05, 10, 10),
  cap: new THREE.CylinderGeometry(0.3, 0.36, 0.22, 20),
  brim: new THREE.BoxGeometry(0.5, 0.05, 0.3),
};
const charMat = new Map<string, THREE.MeshStandardMaterial>();
function sharedMat(color: string, roughness: number) {
  const key = color + roughness;
  let m = charMat.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness }); charMat.set(key, m); }
  return m;
}

function makeCharacter(color: string, seeker: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(charGeo.body, sharedMat(color, 0.6));
  body.position.y = 0.38 + 0.275;
  body.castShadow = true;
  g.add(body);
  const white = sharedMat('#ffffff', 0.4);
  const black = sharedMat('#2b2350', 0.4);
  for (const sx of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(charGeo.eye, white);
    eye.position.set(sx, 0.95, 0.31);
    const pupil = new THREE.Mesh(charGeo.pupil, black);
    pupil.position.set(sx, 0.95, 0.4);
    g.add(eye, pupil);
  }
  if (seeker) {
    // A little detective cap so everyone knows who's seeking.
    const red = sharedMat('#e85f3d', 1);
    const cap = new THREE.Mesh(charGeo.cap, red);
    cap.position.y = 1.36;
    const brim = new THREE.Mesh(charGeo.brim, red);
    brim.position.set(0, 1.27, 0.3);
    g.add(cap, brim);
  }
  return g;
}

/** Free the GPU memory of a one-off object (effects), including textures. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry) return;
    m.geometry.dispose();
    for (const mat of ([] as THREE.Material[]).concat(m.material)) {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
