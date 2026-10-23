/**
 * BazarFX — shader sources (WebGL2 / GLSL ES 3.00).
 *
 * Every shader here is written against GLSL ES 3.00 so the exact same source
 * compiles in an Android OpenGL ES 3.0 context (see docs/BAZARFX.md).
 */

export const FULLSCREEN_VERT = `#version 300 es
precision highp float;

out vec2 vUV;

void main() {
  // One big triangle that covers the whole screen (no vertex buffers needed).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  Scene: a procedural neon city flythrough, rendered at LOW resolution.     */
/*  Outputs colour + screen-space motion vectors (velocity) via MRT.          */
/* ------------------------------------------------------------------------- */

export const SCENE_FRAG = `#version 300 es
precision highp float;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outVelocity;

uniform vec2  uResolution;   // low-res size in pixels
uniform vec2  uJitter;       // sub-pixel jitter in low-res pixels (TAA style)
uniform float uCamZ;         // how far the camera has travelled
uniform float uTime;         // seconds
uniform float uCamMove;      // world units the camera travelled this frame

#define MAX_STEPS 64
#define VEL_RANGE 0.09

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Infinite corridor of boxy buildings, repeating every 16 units along Z.
float mapCity(vec3 p) {
  const float CELL = 16.0;
  float id = floor(p.z / CELL + 0.5);
  vec3 q = p;
  q.z -= id * CELL;

  float r1 = hash11(id * 1.7 + 0.31);
  float r2 = hash11(id * 2.3 + 7.11);

  float h1 = 6.0 + 18.0 * r1;
  float h2 = 4.0 + 15.0 * r2;

  float d1 = sdBox(q - vec3(-9.5 - 2.5 * r1, h1 * 0.5, 0.0), vec3(3.0, h1 * 0.5, 5.5));
  float d2 = sdBox(q - vec3( 9.5 + 2.5 * r2, h2 * 0.5, 3.0), vec3(3.0, h2 * 0.5, 5.5));

  // Street level + two thin "monorail" beams for extra fine detail.
  float ground = p.y;
  float beam1 = sdBox(q - vec3(0.0, 7.5, 0.0), vec3(1.1, 0.18, 8.0));
  float beam2 = sdBox(q - vec3(0.0, 11.0, 0.0), vec3(0.7, 0.12, 8.0));

  return min(min(d1, d2), min(ground, min(beam1, beam2)));
}

float trace(vec3 ro, vec3 rd, out vec3 hitPos) {
  float t = 0.06;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = mapCity(p);
    if (d < 0.0015 * t + 0.0008) {
      hitPos = p;
      return t;
    }
    t += d;
    if (t > 170.0) break;
  }
  hitPos = ro + rd * t;
  return -1.0;
}

vec3 skyColor(vec3 rd) {
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 top = vec3(0.015, 0.012, 0.055);
  vec3 horizon = vec3(0.32, 0.07, 0.42);
  vec3 col = mix(horizon, top, pow(h, 0.85));

  // molten horizon glow
  col += vec3(1.0, 0.22, 0.45) * pow(max(0.0, 1.0 - abs(rd.y) * 2.2), 9.0) * 0.85;

  // stars — high frequency detail, great for testing the upscaler
  vec2 starUV = rd.xy / max(0.18, abs(rd.z)) * 24.0;
  float s = hash21(floor(starUV));
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
  float star = step(0.986, s) * twinkle * smoothstep(0.05, 0.5, rd.y);
  col += vec3(0.8, 0.9, 1.0) * star;

  // distant moon
  float moon = length(rd.xy - vec2(-0.38, 0.46));
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.115, 0.10, moon) * 0.75;
  return col;
}

vec3 buildingColor(vec3 p, vec3 n) {
  float u = (abs(n.x) > 0.5) ? p.z : p.x;
  vec2 cell = vec2(1.15, 1.65);
  vec2 g = vec2(u, p.y);
  vec2 id = floor(g / cell);
  vec2 f = fract(g / cell);

  float r = hash21(id * 1.31 + 5.0);
  float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.74);
  float lit = step(0.42, r);

  vec3 warm = vec3(1.0, 0.62, 0.26);
  vec3 cold = vec3(0.30, 0.85, 1.0);
  vec3 lamp = mix(warm, cold, step(0.55, hash21(id * 3.7)));

  vec3 base = vec3(0.028, 0.03, 0.055);
  base += vec3(0.02, 0.02, 0.05) * (0.5 + 0.5 * n.y);

  vec3 col = mix(base, lamp, win * lit);
  // neon band near the top of each block
  float band = smoothstep(0.90, 1.0, fract(p.y / 9.0)) * (1.0 - win * 0.6);
  // bright parapet line where the facade meets the roof
  col += vec3(0.35, 0.9, 1.0) * smoothstep(0.06, 0.0, abs(fract(p.y / 9.0) - 0.0)) * 0.25;
  col += vec3(1.0, 0.15, 0.6) * band * 0.55;
  return col;
}

vec3 groundColor(vec3 p) {
  vec2 gp = p.xz;
  // perspective grid
  vec2 grid = abs(fract(gp * 0.5) - 0.5) / max(fwidth(gp * 0.5), vec2(1e-5));
  float line = 1.0 - min(min(grid.x, grid.y), 1.0);

  vec3 col = vec3(0.012, 0.014, 0.03);
  col += vec3(0.1, 0.75, 1.0) * line * 0.55 * exp(-length(gp) * 0.012);

  // road lane markings running along Z
  float lane = smoothstep(0.42, 0.5, abs(fract(gp.x * 0.5) - 0.5));
  float dash = step(0.5, fract(gp.y * 0.25));
  col += vec3(1.0, 0.85, 0.4) * lane * dash * 0.35;

  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy + uJitter) / uResolution;

  float aspect = uResolution.x / uResolution.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);

  vec3 ro = vec3(0.0, 1.75, uCamZ);
  vec3 rd = normalize(vec3(c * 1.05, 1.0));

  vec3 hit;
  float t = trace(ro, rd, hit);

  vec3 col;
  float depth;
  if (t < 0.0) {
    col = skyColor(rd);
    depth = 4000.0;
  } else if (hit.y < 0.02) {
    col = groundColor(hit);
    depth = t * rd.z;
  } else {
    // cheap normal from the SDF
    vec3 e = vec3(0.02, 0.0, 0.0);
    vec3 ep = vec3(0.0, 0.02, 0.0);
    vec3 ez = vec3(0.0, 0.0, 0.02);
    vec3 n = normalize(vec3(
      mapCity(hit + e) - mapCity(hit - e),
      mapCity(hit + ep) - mapCity(hit - ep),
      mapCity(hit + ez) - mapCity(hit - ez)
    ));
    col = buildingColor(hit, n);
    depth = t * rd.z;
  }

  // fog + distance fade
  float fog = 1.0 - exp(-t * 0.014);
  vec3 fogCol = vec3(0.09, 0.045, 0.18);
  col = mix(col, fogCol, clamp(fog, 0.0, 1.0));

  // vignette
  float vig = 1.0 - 0.35 * dot(c, c);
  col *= vig;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);

  // ---- motion vectors -----------------------------------------------------
  // Pinhole camera translating forward: screen velocity in UV space is
  // (uv - 0.5) * (dz / depth). This is exact for translation, so the
  // temporal pass gets true motion vectors instead of a guessed optical flow.
  vec2 vel = (uv - 0.5) * (uCamMove / max(depth, 1.0));
  vec2 enc = clamp(vel / VEL_RANGE * 0.5 + 0.5, 0.0, 1.0);
  outVelocity = vec4(enc, 0.0, 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  Spatial upscaler (BSU): Catmull-Rom reconstruction + edge-aware clamp.    */
/* ------------------------------------------------------------------------- */

export const UPSCALE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tLow;
uniform vec2 uLowRes;
uniform float uSharpClamp;   // 0 = no clamp, 1 = hard clamp to local range

float cr(float x) {
  x = abs(x);
  if (x < 1.0) return 1.5 * x * x * x - 2.5 * x * x + 1.0;
  if (x < 2.0) return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0;
  return 0.0;
}

void main() {
  vec2 texel = 1.0 / uLowRes;
  vec2 p = vUV / texel - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 2; y++) {
    for (int x = -1; x <= 2; x++) {
      vec2 o = vec2(float(x), float(y));
      float w = cr(o.x - f.x) * cr(o.y - f.y);
      vec2 st = (i + o + 0.5) * texel;
      acc += texture(tLow, clamp(st, texel * 0.5, 1.0 - texel * 0.5)).rgb * w;
      wsum += w;
    }
  }
  vec3 col = acc / max(wsum, 1e-4);

  // Edge guard: keep the overshoot of the bicubic kernel in check so we gain
  // sharpness without ringing halos around bright neon edges.
  vec3 mn = vec3(1e4);
  vec3 mx = vec3(-1e4);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 st = vUV + vec2(float(x), float(y)) * texel;
      vec3 s = texture(tLow, clamp(st, texel * 0.5, 1.0 - texel * 0.5)).rgb;
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }
  float range = max(mx.r - mn.r, max(mx.g - mn.g, mx.b - mn.b));
  vec3 lo = mn - range * 0.35 * (1.0 - uSharpClamp);
  vec3 hi = mx + range * 0.35 * (1.0 - uSharpClamp);
  col = clamp(col, lo, hi);

  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  Simple bilinear copy — used when the spatial upscaler is disabled.        */
/* ------------------------------------------------------------------------- */

export const COPY_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tSrc;

void main() {
  fragColor = vec4(texture(tSrc, vUV).rgb, 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  Temporal reconstruction: reproject history with motion vectors and blend  */
/*  with variance clipping (this is what kills shimmer / aliasing).          */
/* ------------------------------------------------------------------------- */

export const TEMPORAL_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tVelocity;
uniform vec2 uFullRes;
uniform vec2 uLowRes;
uniform float uAlpha;        // weight of the new frame (0.05 .. 1.0)
uniform float uHistoryValid; // 0 on the first frame / after a reset

vec3 decodeVelocity(vec4 v) {
  return vec3(v.rg * 2.0 - 1.0, 0.0) * 0.09;
}

void main() {
  vec2 texel = 1.0 / uFullRes;

  // neighbourhood statistics of the current frame
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  vec3 mn = vec3(1e4);
  vec3 mx = vec3(-1e4);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = texture(tCurrent, vUV + vec2(float(x), float(y)) * texel).rgb;
      m1 += s;
      m2 += s * s;
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, 0.0));

  vec2 vel = decodeVelocity(texture(tVelocity, vUV)).xy;
  vec3 hist = texture(tHistory, clamp(vUV - vel, vec2(0.0), vec2(1.0))).rgb;

  vec3 lo = max(mn, m1 - sigma * 1.6);
  vec3 hi = min(mx, m1 + sigma * 1.6);
  hist = clamp(hist, lo, hi);

  // Fast motion or a fresh history buffer => trust the new frame more.
  float motion = clamp(length(vel) * 30.0, 0.0, 1.0);
  float alpha = mix(uAlpha, 1.0, motion * 0.5);
  alpha = mix(1.0, alpha, uHistoryValid);

  vec3 outc = mix(hist, texture(tCurrent, vUV).rgb, alpha);
  fragColor = vec4(outc, 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  RCAS-lite: contrast-adaptive sharpening with soft halo protection.        */
/* ------------------------------------------------------------------------- */

export const SHARPEN_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tSrc;
uniform vec2 uFullRes;
uniform float uStrength;

void main() {
  vec2 texel = 1.0 / uFullRes;
  vec3 e = texture(tSrc, vUV).rgb;
  vec3 b = texture(tSrc, vUV + vec2(0.0, -texel.y)).rgb;
  vec3 d = texture(tSrc, vUV + vec2(-texel.x, 0.0)).rgb;
  vec3 f = texture(tSrc, vUV + vec2(texel.x, 0.0)).rgb;
  vec3 h = texture(tSrc, vUV + vec2(0.0, texel.y)).rgb;

  vec3 mn = min(min(b, d), min(f, h));
  vec3 mx = max(max(b, d), max(f, h));

  // low contrast areas get the full boost, harsh edges almost none
  vec3 contrast = mx - mn;
  vec3 adaptive = vec3(1.0) / (1.0 + contrast * 9.0);

  vec3 laplacian = (b + d + f + h) * 0.25 - e;
  vec3 col = e - laplacian * uStrength * adaptive * 2.0;
  col = clamp(col, mn - 0.02, mx + 0.02);

  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/* ------------------------------------------------------------------------- */
/*  Presentation: split-screen comparison + frame interpolation.              */
/* ------------------------------------------------------------------------- */

export const DISPLAY_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tRaw;      // low-res scene colour (bilinear = "classic" look)
uniform sampler2D tCurrent;  // fully reconstructed frame
uniform sampler2D tPrevious; // previous reconstructed frame
uniform sampler2D tVelocity; // motion vectors
uniform sampler2D tLowRaw;   // low-res scene colour, nearest (for pixel view)
uniform float uPhase;        // 0 = real frame, (0,1) = generated frame
uniform float uSplit;        // 0..1 x position of the divider, <0 = no split
uniform float uPixelView;    // 1 = show the low-res pixels raw (debug)

vec3 sampleFrame(sampler2D tex, vec2 uv) {
  return texture(tex, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

vec3 reconstruct(vec2 uv) {
  vec2 vel = (texture(tVelocity, uv).rg * 2.0 - 1.0) * 0.09;

  vec3 cur = sampleFrame(tCurrent, uv + vel * (1.0 - uPhase));
  if (uPhase <= 0.001) return cur;

  vec3 prev = sampleFrame(tPrevious, uv - vel * uPhase);
  return mix(prev, cur, uPhase);
}

void main() {
  vec3 classic = texture(tRaw, vUV).rgb;
  vec3 fx = reconstruct(vUV);

  if (uPixelView > 0.5) {
    vec2 texel = 1.0 / vec2(textureSize(tLowRaw, 0));
    classic = texture(tLowRaw, (floor(vUV / texel) + 0.5) * texel).rgb;
  }

  vec3 col = fx;
  if (uSplit >= 0.0) {
    float side = step(uSplit, vUV.x);
    col = mix(classic, fx, side);
    // divider
    float d = smoothstep(0.0018, 0.0, abs(vUV.x - uSplit));
    col = mix(col, vec3(0.1, 1.0, 0.75), d * 0.85);
  }

  // subtle filmic curve + dither to avoid banding
  col = pow(max(col, 0.0), vec3(0.95));
  float dither = (fract(sin(dot(vUV, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  fragColor = vec4(col + dither, 1.0);
}
`;
