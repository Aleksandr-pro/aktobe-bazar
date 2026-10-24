// Рендер «Horizon Aktobe» на Three.js: низкополигональная степь, трасса,
// посёлок, юрты у старта, машина, пыль из-под колёс и следы шин.
//
// Всё строится из геометрии и canvas-текстур — ни одного внешнего ассета,
// поэтому страница весит как обычный лендинг и грузится на телефоне.

import * as THREE from 'three';
import { heightAt, type Prop, type World } from '@/lib/horizon/world';
import { CAR_SPECS, type CarState, type ChaseCamera, type Effects, type CarSpec } from '@/lib/horizon/physics';
import { clamp01, lerp } from '@/lib/horizon/math';

const SKY_TOP = new THREE.Color('#2f6fae');
const SKY_HORIZON = new THREE.Color('#e8d3ae');
const FOG_COLOR = new THREE.Color('#dcc8a6');
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

export type RendererOptions = {
  shadows: boolean;
  pixelRatioCap: number;
};

export type FrameState = {
  car: CarState;
  cam: ChaseCamera;
  fx: Effects;
  spec: CarSpec;
  time: number;
  /** Точка, куда смотрит камера (в гонке — впереди машины, в меню — центр). */
  lookAt: { x: number; y: number; z: number };
  /** Дебаг-наложение: показать низкое разрешение. */
  lowRes: boolean;
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function radialTexture(size: number, stops: Array<[number, string]>): THREE.CanvasTexture {
  return canvasTexture(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [pos, color] of stops) g.addColorStop(pos, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

function bannerTexture(text: string, sub: string): THREE.CanvasTexture {
  return canvasTexture(1024, 160, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 1024, 160);
    grad.addColorStop(0, '#0f3d2e');
    grad.addColorStop(0.5, '#14653f');
    grad.addColorStop(1, '#0f3d2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 160);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 1008, 144);
    ctx.fillStyle = '#f6e7c1';
    ctx.font = 'bold 74px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 68);
    ctx.fillStyle = '#f2c14e';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(sub, 512, 128);
  });
}

// ---------------------------------------------------------------------------
// Машина
// ---------------------------------------------------------------------------

type CarMesh = {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  steerWheels: THREE.Object3D[];
  brakeLights: THREE.MeshBasicMaterial;
  body: THREE.Object3D;
};

function carColorFor(id: CarSpec['id'], variant: number): number {
  if (id === 'nomad') return variant === 1 ? 0xe8712b : 0xd9d2c4;
  return variant === 1 ? 0xb8232c : 0xf2f0ea;
}

function buildCar(spec: CarSpec, variant: number): CarMesh {
  const group = new THREE.Group();
  const isNomad = spec.id === 'nomad';
  const color = carColorFor(spec.id, variant);

  const paint = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262b, flatShading: true });
  const glass = new THREE.MeshLambertMaterial({ color: 0x2b3947, transparent: true, opacity: 0.92 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x8d939b, flatShading: true });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x15171a, flatShading: true });
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xb9c0c8, flatShading: true });

  const body = new THREE.Group();

  // Силуэт в профиль: капот, корма, низ.
  const tub = new THREE.Shape();
  const lift = isNomad ? 0.2 : 0;
  tub.moveTo(-2.0, 0.3 + lift);
  tub.lineTo(-2.02, 0.62 + lift);
  tub.lineTo(-1.35, 0.74 + lift);
  tub.lineTo(0.9, 0.7 + lift);
  tub.lineTo(1.72, 0.6 + lift);
  tub.lineTo(2.02, 0.46 + lift);
  tub.lineTo(2.03, 0.28 + lift);
  tub.lineTo(-2.0, 0.28 + lift);
  const tubGeo = new THREE.ExtrudeGeometry(tub, {
    depth: 1.62,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.07,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 4,
  });
  tubGeo.translate(0, 0, -0.81);
  const tubMesh = new THREE.Mesh(tubGeo, paint);
  tubMesh.castShadow = true;
  body.add(tubMesh);

  // Кабина-«теплица».
  const cab = new THREE.Shape();
  const roofY = (isNomad ? 0.92 : 0.78) + lift;
  cab.moveTo(0.86, 0.68 + lift);
  cab.lineTo(0.28, roofY + lift);
  cab.lineTo(-0.9, roofY + lift);
  cab.lineTo(-1.42, 0.7 + lift);
  cab.lineTo(0.86, 0.68 + lift);
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: 1.5, bevelEnabled: false, steps: 1, curveSegments: 4 });
  cabGeo.translate(0, 0, -0.75);
  const cabMesh = new THREE.Mesh(cabGeo, glass);
  cabMesh.castShadow = true;
  body.add(cabMesh);

  // Крыша в цвет кузова.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.08, 1.5), paint);
  roof.position.set(-0.32, roofY + lift + 0.03, 0);
  roof.castShadow = true;
  body.add(roof);

  // Бамперы и пороги.
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 1.74), dark);
  frontBumper.position.set(2.02, 0.38 + lift, 0);
  body.add(frontBumper);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 1.72), dark);
  rearBumper.position.set(-2.02, 0.4 + lift, 0);
  body.add(rearBumper);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), dark);
    skirt.position.set(-0.1, 0.32 + lift, side * 0.84);
    body.add(skirt);
  }

  // Фары и стопы.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c4 });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.36), headMat);
    head.position.set(2.06, 0.58 + lift, side * 0.55);
    body.add(head);
  }
  const brakeLights = new THREE.MeshBasicMaterial({ color: 0x7a1414 });
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.42), brakeLights);
    tail.position.set(-2.06, 0.66 + lift, side * 0.56);
    body.add(tail);
  }

  // Антикрыло / багажник на крыше — различает машины.
  if (isNomad) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.5), metal);
    bar.position.set(-1.78, 1.06 + lift, 0);
    body.add(bar);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), dark);
      leg.position.set(-1.78, 0.88 + lift, side * 0.6);
      body.add(leg);
    }
    // Каркас безопасности.
    const cageMat = metal;
    for (const side of [-1, 1]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 14, Math.PI), cageMat);
      hoop.position.set(0.05, roofY + lift, side * 0.66);
      hoop.rotation.set(0, Math.PI / 2, 0);
      body.add(hoop);
    }
  } else {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 1.42), dark);
    wing.position.set(-1.95, 1.02 + lift, 0);
    body.add(wing);
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), dark);
      strut.position.set(-1.95, 0.87 + lift, side * 0.55);
      body.add(strut);
    }
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 1.44), metal);
    lightBar.position.set(-0.3, roofY + lift + 0.14, 0);
    body.add(lightBar);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c9 });
    for (let i = 0; i < 4; i++) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), lampMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(-0.3, roofY + lift + 0.14, -0.54 + i * 0.36);
      body.add(lamp);
    }
  }

  // Зеркала.
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.24), dark);
    mirror.position.set(0.78, 0.86 + lift, side * 0.94);
    body.add(mirror);
  }

  group.add(body);

  // Колёса.
  const wheelRadius = isNomad ? 0.44 : 0.36;
  const wheelWidth = isNomad ? 0.34 : 0.28;
  const wheels: THREE.Object3D[] = [];
  const steerWheels: THREE.Object3D[] = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, wheelWidth + 0.02, 8);
  rimGeo.rotateX(Math.PI / 2);
  const axleX = 1.34;
  const axleZ = 0.9;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * axleX, wheelRadius + 0.02, sz * axleZ);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, rubber);
      tyre.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      spin.add(tyre, rim);
      pivot.add(spin);
      group.add(pivot);
      wheels.push(spin);
      if (sx > 0) steerWheels.push(pivot);
    }
  }

  // Контактная тень под машиной.
  const shadowTex = radialTexture(128, [
    [0, 'rgba(0,0,0,0.55)'],
    [0.55, 'rgba(0,0,0,0.28)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 2.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.02;
  group.add(contact);

  return { group, wheels, steerWheels, brakeLights, body };
}

// ---------------------------------------------------------------------------
// Инстансинг декора
// ---------------------------------------------------------------------------

type Placement = { x: number; y: number; z: number; rot: number; scale: number; variant: number };

function instancedMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  items: readonly Placement[],
  opts: {
    offsetY?: number;
    scale?: [number, number, number];
    randomScale?: [number, number];
    palette?: number[];
    castShadow?: boolean;
  } = {},
): THREE.InstancedMesh | null {
  if (!items.length) {
    geo.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = opts.castShadow ?? false;
  mesh.receiveShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const base = opts.scale ?? [1, 1, 1];
  const palette = opts.palette;
  const color = new THREE.Color();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    e.set(0, it.rot, 0);
    q.setFromEuler(e);
    const randScale = opts.randomScale
      ? lerp(opts.randomScale[0], opts.randomScale[1], ((i * 2654435761) % 1000) / 1000)
      : 1;
    const sc = it.scale * randScale;
    p.set(it.x, it.y + (opts.offsetY ?? 0) * sc, it.z);
    s.set(base[0] * sc, base[1] * sc, base[2] * sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (palette && palette.length) {
      color.setHex(palette[it.variant % palette.length]);
      mesh.setColorAt(i, color);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function propsOf(world: World, kind: Prop['kind']): Placement[] {
  const out: Placement[] = [];
  for (const p of world.props) {
    if (p.kind === kind) out.push({ x: p.x, y: p.y, z: p.z, rot: p.rot, scale: p.scale, variant: p.variant });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Рендерер
// ---------------------------------------------------------------------------

export class HorizonRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private world: World | null = null;
  private car: CarMesh | null = null;
  private carId: CarSpec['id'] = 'rally';
  private carVariant = 0;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private dust: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;
  private skids: THREE.InstancedMesh | null = null;
  private skidCount = 0;
  private cloudGroup = new THREE.Group();
  private skyMesh: THREE.Mesh | null = null;
  private clock = 0;
  private opts: RendererOptions;
  private lowResTarget: THREE.WebGLRenderTarget | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) < 1.8,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, opts.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = SKY_HORIZON.clone();
    this.scene.fog = new THREE.Fog(FOG_COLOR.clone(), 220, 900);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.35, 1600);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x9b7f52, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe3b8, 2.15);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.sun.castShadow = opts.shadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.near = 1;
    shadowCam.far = 260;
    shadowCam.left = -46;
    shadowCam.right = 46;
    shadowCam.top = 46;
    shadowCam.bottom = -46;
    shadowCam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  get ok(): boolean {
    return !this.disposed;
  }

  setQuality(opts: RendererOptions): void {
    this.opts = opts;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap));
    this.renderer.shadowMap.enabled = opts.shadows;
    this.sun.castShadow = opts.shadows;
  }

  // --- Мир ---

  setWorld(world: World, carId: CarSpec['id'], carVariant = 0): void {
    this.clearWorld();
    this.world = world;
    this.scene.fog = new THREE.Fog(FOG_COLOR.clone(), 220, 900);

    this.buildSky();
    this.buildTerrain(world);
    this.buildRoad(world);
    this.buildWater(world);
    this.buildDecor(world);
    this.buildGates(world);
    this.buildRamps(world);
    this.buildClouds(world);
    this.setCar(carId, carVariant);
    this.buildParticles();
    this.buildSkids();
  }

  setCar(carId: CarSpec['id'], variant: number): void {
    if (this.car && this.carId === carId && this.carVariant === variant) return;
    if (this.car) {
      this.scene.remove(this.car.group);
      this.disposeObject(this.car.group);
    }
    this.carId = carId;
    this.carVariant = variant;
    this.car = buildCar(CAR_SPECS[carId], variant);
    this.scene.add(this.car.group);
  }

  private clearWorld(): void {
    for (const child of [...this.scene.children]) {
      if (child === this.sun || child === this.sun.target || child === this.hemi) continue;
      this.scene.remove(child);
      this.disposeObject(child);
    }
    this.car = null;
    this.dust = null;
    this.dustGeo = null;
    this.skids = null;
    this.skidCount = 0;
    this.skyMesh = null;
    this.cloudGroup = new THREE.Group();
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }

  private buildSky(): void {
    const skyGeo = new THREE.SphereGeometry(1200, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: SKY_TOP.clone() },
        bottomColor: { value: SKY_HORIZON.clone() },
        offset: { value: 110 },
        exponent: { value: 0.85 },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDir;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          vec3 col = mix(bottomColor, topColor, t);
          float sun = pow(max(dot(normalize(vWorld), normalize(sunDir)), 0.0), 220.0);
          float glow = pow(max(dot(normalize(vWorld), normalize(sunDir)), 0.0), 8.0);
          col += vec3(1.0, 0.85, 0.6) * (sun * 1.6 + glow * 0.22);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.skyMesh = sky;
    this.scene.add(sky);
  }

  private buildTerrain(world: World): void {
    const { terrain } = world;
    const n = terrain.grid;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        positions[i * 3] = -world.terrain.size / 2 + ix * terrain.step;
        positions[i * 3 + 1] = terrain.heights[i];
        positions[i * 3 + 2] = -world.terrain.size / 2 + iz * terrain.step;
      }
    }
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(terrain.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = this.opts.shadows;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
  }

  private buildRoad(world: World): void {
    const { road, terrain } = world;
    const n = road.xs.length;
    const nxArr = new Float32Array(n);
    const nzArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1);
      const dx = road.xs[j] - road.xs[Math.max(0, i - 1)];
      const dz = road.zs[j] - road.zs[Math.max(0, i - 1)];
      const len = Math.hypot(dx, dz) || 1;
      nxArr[i] = -dz / len;
      nzArr[i] = dx / len;
    }

    const build = (halfWidth: number, yOffset: number, colorA: string, colorB: string, shoulderFade: boolean) => {
      const cols = 5;
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const ca = new THREE.Color(colorA);
      const cb = new THREE.Color(colorB);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < cols; s++) {
          const u = s / (cols - 1) - 0.5;
          const x = road.xs[i] + nxArr[i] * u * 2 * halfWidth;
          const z = road.zs[i] + nzArr[i] * u * 2 * halfWidth;
          const y = heightAt(terrain, road, x, z) + yOffset;
          pos.push(x, y, z);
          const edge = Math.abs(u) * 2;
          c.copy(ca).lerp(cb, edge * (shoulderFade ? 1 : 0.5));
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        for (let s = 0; s < cols - 1; s++) {
          const a = i * cols + s;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = this.opts.shadows;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    };

    build(15.5, 0.02, '#a48d63', '#8b7752', true); // обочина
    build(7.5, 0.075, '#4a4a4c', '#5c5a58', false); // асфальт

    // Разметка: пунктир по центру.
    const dashGeo = new THREE.PlaneGeometry(0.32, 3.2);
    dashGeo.rotateX(-Math.PI / 2);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xe9e3d2, transparent: true, opacity: 0.85 });
    const placements: Placement[] = [];
    let acc = 0;
    for (let i = 1; i < n - 1; i++) {
      const seg = Math.hypot(road.xs[i] - road.xs[i - 1], road.zs[i] - road.zs[i - 1]);
      acc += seg;
      if (acc < 11) continue;
      acc = 0;
      const heading = Math.atan2(road.xs[i + 1] - road.xs[i - 1], road.zs[i + 1] - road.zs[i - 1]);
      placements.push({
        x: road.xs[i],
        y: heightAt(terrain, road, road.xs[i], road.zs[i]) + 0.115,
        z: road.zs[i],
        rot: heading,
        scale: 1,
        variant: 0,
      });
    }
    const dashes = instancedMesh(dashGeo, dashMat, placements);
    if (dashes) this.scene.add(dashes);

    // Крайние линии.
    const edgeGeo = new THREE.PlaneGeometry(0.18, 1);
    edgeGeo.rotateX(-Math.PI / 2);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c2, transparent: true, opacity: 0.55 });
    const edges: Placement[] = [];
    for (let i = 1; i < n - 1; i += 2) {
      const j = Math.min(n - 1, i + 1);
      const heading = Math.atan2(road.xs[j] - road.xs[i], road.zs[j] - road.zs[i]);
      for (const u of [-6.5, 6.5]) {
        const ex = road.xs[i] + nxArr[i] * u;
        const ez = road.zs[i] + nzArr[i] * u;
        edges.push({
          x: ex,
          y: heightAt(terrain, road, ex, ez) + 0.1,
          z: ez,
          rot: heading,
          scale: 1,
          variant: 0,
        });
      }
    }
    // Дистанцию между точками удлиняем через масштаб по Z.
    const edgeMesh = instancedMesh(edgeGeo, edgeMat, edges, { scale: [1, 1, 9] });
    if (edgeMesh) this.scene.add(edgeMesh);
  }

  private buildWater(world: World): void {
    const geo = new THREE.CircleGeometry(world.lake.radius * 0.92, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xd9d3c6,
      transparent: true,
      opacity: 0.72,
      emissive: 0x2a2d33,
      emissiveIntensity: 0.15,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(world.lake.x, world.lake.y + 0.04, world.lake.z);
    this.scene.add(water);

    const ringGeo = new THREE.RingGeometry(world.lake.radius * 0.92, world.lake.radius * 1.02, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xefe9dc, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(world.lake.x, world.lake.y + 0.06, world.lake.z);
    this.scene.add(ring);
  }

  private buildDecor(world: World): void {
    const add = (mesh: THREE.InstancedMesh | null) => {
      if (mesh) this.scene.add(mesh);
    };

    const trees = propsOf(world, 'tree');
    const broadleaf = trees.filter((t) => t.variant === 0);
    const conifer = trees.filter((t) => t.variant === 1);

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b5138, flatShading: true });
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 2.6, 6);
    add(instancedMesh(trunkGeo, trunkMat, trees, { offsetY: 1.3, castShadow: false }));

    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const leafMat = new THREE.MeshLambertMaterial({ flatShading: true });
    add(
      instancedMesh(leafGeo, leafMat, broadleaf, {
        offsetY: 3.6,
        scale: [1.5, 2.9, 1.5],
        palette: [0x5c6b35, 0x6d7a3c, 0x54622f, 0x77813f],
        randomScale: [0.9, 1.12],
      }),
    );
    const pineGeo = new THREE.ConeGeometry(1, 1, 6);
    add(
      instancedMesh(pineGeo, leafMat, conifer, {
        offsetY: 4.1,
        scale: [1.7, 5.6, 1.7],
        palette: [0x4a5a30, 0x556234, 0x3f512b],
        randomScale: [0.85, 1.1],
      }),
    );

    const rockItems = propsOf(world, 'rock');
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ flatShading: true });
    add(
      instancedMesh(rockGeo, rockMat, rockItems, {
        offsetY: 0.42,
        scale: [1.2, 0.85, 1.05],
        palette: [0x9d8f78, 0x8a7d68, 0xb2a48c, 0x7a6f5e],
      }),
    );

    const bushItems = propsOf(world, 'bush');
    add(
      instancedMesh(leafGeo, leafMat, bushItems, {
        offsetY: 0.55,
        scale: [1.05, 0.75, 1.05],
        palette: [0x6a7540, 0x77803f, 0x5d6b3a],
      }),
    );

    // Вышки связи: мачта + платформы + красный маяк.
    const towers = propsOf(world, 'tower');
    if (towers.length) {
      const mastGeo = new THREE.CylinderGeometry(0.18, 0.5, 26, 6);
      const mastMat = new THREE.MeshLambertMaterial({ color: 0xa8aeb5, flatShading: true });
      add(instancedMesh(mastGeo, mastMat, towers, { offsetY: 13 }));
      const deckGeo = new THREE.BoxGeometry(3.6, 0.35, 3.6);
      const deckMat = new THREE.MeshLambertMaterial({ color: 0x77808a, flatShading: true });
      add(instancedMesh(deckGeo, deckMat, towers, { offsetY: 21 }));
      const beaconGeo = new THREE.SphereGeometry(0.4, 6, 5);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4b32 });
      add(instancedMesh(beaconGeo, beaconMat, towers, { offsetY: 26.4 }));
    }

    // Посёлок: склады-ангары.
    const hangars = propsOf(world, 'hangar');
    const wallGeo = new THREE.BoxGeometry(14, 7.5, 9);
    const wallMat = new THREE.MeshLambertMaterial({ flatShading: true });
    add(
      instancedMesh(wallGeo, wallMat, hangars, {
        offsetY: 3.75,
        palette: [0x9a8f7d, 0x8d5f4c, 0x7d858a, 0xb0a48e],
        castShadow: this.opts.shadows,
      }),
    );
    const roofGeo = new THREE.ConeGeometry(9.6, 3.2, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1, 1, 0.72);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x5c5f63, flatShading: true });
    add(instancedMesh(roofGeo, roofMat, hangars, { offsetY: 9.1 }));

    // Юрты у старта.
    const yurts = propsOf(world, 'yurt');
    if (yurts.length) {
      const bodyGeo = new THREE.CylinderGeometry(3, 3, 2.4, 12, 1, true);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0xece3d0, side: THREE.DoubleSide, flatShading: true });
      add(instancedMesh(bodyGeo, bodyMat, yurts, { offsetY: 1.2, palette: [0xece3d0, 0xe6d9bf, 0xf2ece0, 0xdccdb3] }));
      const yurtRoofGeo = new THREE.ConeGeometry(3.5, 1.55, 12);
      const yurtRoofMat = new THREE.MeshLambertMaterial({ color: 0xc4b49a, flatShading: true });
      add(instancedMesh(yurtRoofGeo, yurtRoofMat, yurts, { offsetY: 3.2 }));
      const doorGeo = new THREE.BoxGeometry(1.1, 1.9, 0.16);
      const doorMat = new THREE.MeshLambertMaterial({ color: 0x8a4a2e, flatShading: true });
      const doors = yurts.map((y) => ({
        x: y.x + Math.sin(y.rot) * 2.85,
        y: y.y,
        z: y.z + Math.cos(y.rot) * 2.85,
        rot: y.rot,
        scale: y.scale,
        variant: y.variant,
      }));
      add(instancedMesh(doorGeo, doorMat, doors, { offsetY: 1.0 }));
    }

    // Разбитая машина на финише.
    const crash = propsOf(world, 'crash');
    if (crash.length) {
      const bodyGeo = new THREE.BoxGeometry(4, 1.1, 1.8);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x7a5a44, flatShading: true });
      add(instancedMesh(bodyGeo, bodyMat, crash, { offsetY: 0.9 }));
      const cabGeo = new THREE.BoxGeometry(1.9, 0.9, 1.6);
      const cabMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, flatShading: true });
      add(instancedMesh(cabGeo, cabMat, crash, { offsetY: 1.7, scale: [1, 1, 1] }));
    }

    // Флаги вдоль трассы: тонкие плоскости, всегда развеваются от ветра.
    const flagPole = new THREE.CylinderGeometry(0.06, 0.06, 5.2, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xd8d6d0 });
    const flags: Placement[] = [];
    const { road } = world;
    for (let i = 20; i < road.xs.length - 20; i += 46) {
      const j = Math.min(road.xs.length - 1, i + 1);
      const dx = road.xs[j] - road.xs[i];
      const dz = road.zs[j] - road.zs[i];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      for (const side of [-1, 1]) {
        const x = road.xs[i] + nx * 10.5 * side;
        const z = road.zs[i] + nz * 10.5 * side;
        flags.push({ x, y: heightAt(world.terrain, road, x, z), z, rot: Math.atan2(dx, dz), scale: 1, variant: 0 });
      }
    }
    add(instancedMesh(flagPole, poleMat, flags, { offsetY: 2.6 }));
    const flagGeo = new THREE.PlaneGeometry(1.55, 0.9);
    flagGeo.translate(0.77, 0, 0);
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    const flagMesh = instancedMesh(flagGeo, flagMat, flags, { offsetY: 4.6 });
    if (flagMesh) {
      flagMesh.userData.flutter = true;
      flagMesh.frustumCulled = false;
      this.scene.add(flagMesh);
    }
  }

  private buildRamps(world: World): void {
    if (!world.ramps.length) return;
    const wood = new THREE.MeshLambertMaterial({ color: 0x8d6a45, flatShading: true });
    const lipMat = new THREE.MeshLambertMaterial({ color: 0xe4d7bd, flatShading: true });
    const postMat = new THREE.MeshLambertMaterial({ color: 0xd94a3d, flatShading: true });
    for (const ramp of world.ramps) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(ramp.length, ramp.height);
      shape.lineTo(ramp.length, 0);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: ramp.width, bevelEnabled: false, steps: 1 });
      geo.translate(0, 0, -ramp.width / 2);
      const mesh = new THREE.Mesh(geo, wood);
      mesh.castShadow = this.opts.shadows;
      mesh.receiveShadow = this.opts.shadows;
      mesh.position.set(
        ramp.x - Math.sin(ramp.rot) * (ramp.length / 2),
        ramp.y,
        ramp.z - Math.cos(ramp.rot) * (ramp.length / 2),
      );
      mesh.rotation.y = ramp.rot - Math.PI / 2;
      this.scene.add(mesh);

      // Светлая кромка на срезе и красные стойки по краям — видно издалека.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, ramp.width), lipMat);
      lip.position.set(ramp.x + Math.sin(ramp.rot) * (ramp.length / 2), ramp.y + ramp.height + 0.02, ramp.z + Math.cos(ramp.rot) * (ramp.length / 2));
      lip.rotation.y = ramp.rot;
      this.scene.add(lip);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6), postMat);
        post.position.set(
          ramp.x + Math.sin(ramp.rot) * (ramp.length / 2 + 0.4) + Math.cos(ramp.rot) * side * (ramp.width / 2),
          ramp.y + ramp.height + 0.6,
          ramp.z + Math.cos(ramp.rot) * (ramp.length / 2 + 0.4) - Math.sin(ramp.rot) * side * (ramp.width / 2),
        );
        this.scene.add(post);
      }
    }
  }

  private buildGates(world: World): void {
    const tex = bannerTexture('HORIZON AKTOBE', 'старт · воскресенье · 12:00');
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    for (const gate of world.props.filter((p) => p.kind === 'gate')) {
      const group = new THREE.Group();
      group.position.set(gate.x, gate.y, gate.z);
      group.rotation.y = gate.rot;
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 7.4, 8), poleMat);
        pole.position.set(side * 8.4, 3.7, 0);
        pole.castShadow = this.opts.shadows;
        group.add(pole);
      }
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(17, 2.7), mat);
      banner.position.set(0, 6.2, 0);
      group.add(banner);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(17, 0.16, 0.16), poleMat);
      beam.position.set(0, 7.5, 0);
      group.add(beam);
      // Флажки на воротах.
      const flagMat = new THREE.MeshBasicMaterial({ color: 0x1c6b45, side: THREE.DoubleSide });
      for (let i = -4; i <= 4; i++) {
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), flagMat);
        flag.position.set(i * 1.85, 5.6, 0.15);
        group.add(flag);
      }
      this.scene.add(group);
    }
  }

  private buildClouds(world: World): void {
    const tex = radialTexture(128, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.5, 'rgba(255,255,255,0.45)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      fog: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cloudGroup = new THREE.Group();
    let seed = 12345;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 26; i++) {
      const cloud = new THREE.Mesh(geo, mat);
      const angle = rand() * Math.PI * 2;
      const radius = 380 + rand() * 620;
      const scale = 120 + rand() * 260;
      cloud.position.set(Math.cos(angle) * radius, 150 + rand() * 190, Math.sin(angle) * radius);
      cloud.scale.set(scale, scale * (0.32 + rand() * 0.22), 1);
      cloud.rotation.z = rand() * Math.PI;
      cloud.renderOrder = -5;
      this.cloudGroup.add(cloud);
    }
    this.scene.add(this.cloudGroup);
    void world;
  }

  // --- Частицы ---

  private buildParticles(): void {
    const geo = new THREE.BufferGeometry();
    const max = 300;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(max), 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPixel: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uPixel;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixel * (260.0 / max(1.0, -mv.z));
          vAlpha = aAlpha;
          vColor = aColor;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.06, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.dustGeo = geo;
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.scene.add(this.dust);
  }

  private buildSkids(): void {
    const geo = new THREE.PlaneGeometry(0.34, 1.7);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1712,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, 900);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    this.skids = mesh;
    this.skidCount = 0;
    this.scene.add(mesh);
  }

  // --- Кадр ---

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixel = this.renderer.getPixelRatio();
    const mat = this.dust?.material as THREE.ShaderMaterial | undefined;
    if (mat) mat.uniforms.uPixel.value = pixel * (height / 720);
  }

  render(state: FrameState): void {
    if (!this.world || !this.car) return;
    const { car, cam, fx, time, lowRes } = state;
    this.clock = time;

    // Машина.
    const g = this.car.group;
    g.position.set(car.x, car.y, car.z);
    g.rotation.set(0, 0, 0);
    // Локальный «нос» машины — +X, поэтому к курсу добавляем -90°.
    g.rotateY(car.heading - Math.PI / 2);
    g.rotateZ(car.pitch * 0.85);
    g.rotateX(-car.roll * 0.85);
    g.position.y += car.suspension * 0.06 - (car.bog > 0.3 ? 0.12 : 0);

    const wheelSpin = car.distance / (state.spec.id === 'nomad' ? 0.44 : 0.36);
    for (const wheel of this.car.wheels) wheel.rotation.z = -wheelSpin;
    for (const pivot of this.car.steerWheels) pivot.rotation.y = car.steer * 0.42;
    this.car.brakeLights.color.setHex(car.brakeStrength > 0.3 || car.speed < -0.5 ? 0xff2a1a : 0x7a1414);

    // Камера.
    this.camera.position.set(cam.x, cam.y, cam.z);
    const shake = cam.shake * (car.airborne ? 0.04 : 0.09);
    const sx = Math.sin(time * 37.1) * shake;
    const sy = Math.sin(time * 41.7 + 1.7) * shake * 0.6;
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    const { lookAt } = state;
    if (cam.mode === 'bonnet') {
      this.camera.position.set(car.x + Math.sin(car.heading) * 0.2, car.y + 1.25, car.z + Math.cos(car.heading) * 0.2);
    }
    this.camera.lookAt(lookAt.x + sx, lookAt.y + sy, lookAt.z);

    // Солнце едет за машиной, чтобы тени были резкими и не «уезжали».
    this.sun.position.set(car.x + SUN_DIR.x * 100, car.y + SUN_DIR.y * 100, car.z + SUN_DIR.z * 100);
    this.sun.target.position.set(car.x, car.y, car.z);
    this.sun.target.updateMatrixWorld();

    // Небо и облака держатся вокруг камеры, иначе на краю карты видно «купол».
    if (this.skyMesh) this.skyMesh.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.cloudGroup.rotation.y = time * 0.006;
    this.cloudGroup.position.set(
      this.camera.position.x + Math.sin(time * 0.01) * 40,
      0,
      this.camera.position.z + Math.cos(time * 0.008) * 40,
    );

    // Пыль.
    this.updateDust(fx);
    this.updateSkids(fx);

    // Низкое разрешение: рендерим в маленькую мишень и растягиваем.
    if (lowRes) {
      this.renderLowRes();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateDust(fx: Effects): void {
    if (!this.dust || !this.dustGeo) return;
    const pos = this.dustGeo.getAttribute('position') as THREE.BufferAttribute;
    const size = this.dustGeo.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = this.dustGeo.getAttribute('aAlpha') as THREE.BufferAttribute;
    const color = this.dustGeo.getAttribute('aColor') as THREE.BufferAttribute;
    const list = fx.dust;
    const n = Math.min(list.length, pos.count);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const t = clamp01(p.life / p.maxLife);
      pos.setXYZ(i, p.x, p.y, p.z);
      size.setX(i, p.size * (1.4 - t * 0.5));
      alpha.setX(i, t * (p.kind === 1 ? 0.55 : 0.38));
      if (p.kind === 1) color.setXYZ(i, 0.92, 0.9, 0.86);
      else color.setXYZ(i, 0.78, 0.68, 0.5);
    }
    pos.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    color.needsUpdate = true;
    this.dustGeo.setDrawRange(0, n);
  }

  private updateSkids(fx: Effects): void {
    if (!this.skids) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const list = fx.skids;
    const n = Math.min(list.length, 900);
    for (let i = 0; i < n; i++) {
      const sk = list[i];
      e.set(0, sk.angle, 0);
      q.setFromEuler(e);
      p.set(sk.x, sk.y, sk.z);
      const fade = clamp01(sk.life / 9);
      s.set(0.8 + sk.strength * 0.6, 1, 0.75 + fade * 0.45);
      m.compose(p, q, s);
      this.skids.setMatrixAt(i, m);
    }
    this.skids.count = n;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  private renderLowRes(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const scale = 1 / 3.2;
    const w = Math.max(64, Math.floor(size.x * scale));
    const h = Math.max(36, Math.floor(size.y * scale));
    if (!this.lowResTarget) {
      this.lowResTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
      });
    } else if (this.lowResTarget.width !== w || this.lowResTarget.height !== h) {
      this.lowResTarget.setSize(w, h);
    }
    this.renderer.setRenderTarget(this.lowResTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    // Блит с nearest: видно каждый «пиксель» низкого разрешения.
    this.renderer.render(this.blitScene(), this.blitCamera());
  }

  private _blit: { scene: THREE.Scene; camera: THREE.OrthographicCamera; mesh: THREE.Mesh } | null = null;
  private blitScene(): THREE.Scene {
    const blit = this.blit();
    return blit.scene;
  }
  private blitCamera(): THREE.OrthographicCamera {
    return this.blit().camera;
  }
  private blit() {
    if (!this._blit) {
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: this.lowResTarget?.texture ?? null }),
      );
      scene.add(mesh);
      this._blit = { scene, camera, mesh };
    }
    if (this.lowResTarget) {
      (this._blit.mesh.material as THREE.MeshBasicMaterial).map = this.lowResTarget.texture;
      (this._blit.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    return this._blit;
  }

  dispose(): void {
    this.disposed = true;
    this.clearWorld();
    this.lowResTarget?.dispose();
    this.renderer.dispose();
  }
}

export function specOf(id: CarSpec['id']): CarSpec {
  return CAR_SPECS[id];
}
