export const FORWARD_VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aKind;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform highp float uTime;
uniform mediump float uWind;
uniform mediump float uRain;
uniform mediump vec3 uEye;
varying vec3 vNormal;
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec3 vWorld;
varying highp vec2 vUv;
varying highp float vRind;
varying highp float vMask;
#else
varying mediump vec3 vWorld;
varying mediump vec2 vUv;
varying mediump float vRind;
varying mediump float vMask;
#endif
varying vec3 vColor;
varying float vKind;
// Mali reduces sin() in a loop. Hours of clock make every blade slower.
float wave(float x) {
  return sin(mod(x, 6.2831853));
}
void main() {
  vRind = 0.0;
  vMask = 0.0;
  vec3 pos = aPos;
  if (aKind > 1.5 && aKind < 2.5) {
    float tip = clamp((aColor.g - 0.46) / 0.42, 0.0, 1.0);
    float gust = wave(aPos.x * 0.07 - uTime * 0.45) * 0.5 + 0.5;
    float flut = wave(uTime * 1.9 + aPos.x * 0.7 + aPos.z * 0.4);
    float w = flut * tip * uWind * (0.07 + gust * 0.12);
    pos.x += w * 0.92;
    pos.z += w * 0.39;
  }
  if (aKind > 5.5 && aKind < 6.5 && aUv.y > 0.02) {
    float tip = aUv.y * aUv.y;
    float gust = wave(uTime * (0.95 + uWind * 0.4) + aPos.x * 0.7 + aPos.z * 0.45);
    float w = gust * tip * uWind * 0.08;
    pos.x += w * 0.92;
    pos.z += w * 0.39;
  }
  if (aKind > 3.15 && aKind < 3.45) {
    float cycle = fract(uTime * 0.85 + aUv.y);
    float life = clamp((cycle - 0.72) / 0.28, 0.0, 1.0);
    vColor = aColor;
    vKind = aKind;
    if (cycle < 0.72 || aUv.x > uRain) {
      vWorld = vec3(0.0);
      vNormal = vec3(0.0, 0.0, 1.0);
      vUv = vec2(0.0);
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    float rad = mix(0.045, 0.26, life) * (0.75 + 0.35 * uRain);
    vec3 center = vec3(uEye.x + aPos.x, uEye.y - 1.66, uEye.z + aPos.z);
    float far = length(vec2(aPos.x, aPos.z));
    float dx = aNormal.x / max(abs(aNormal.z), 0.001);
    float dz = aNormal.y / max(abs(aNormal.z), 0.001);
    vec3 p = center + vec3(dx * rad, 0.04, dz * rad);
    vWorld = p;
    vNormal = vec3(life, 0.0, 1.0);
    vUv = vec2(dx, dz);
    if (far > 6.5) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    gl_Position = uViewProj * vec4(p, 1.0);
    return;
  }
  if (aKind > 2.5 && aKind < 3.15) {
    float column = 16.0;
    float speed = 9.0 + uRain * 8.0;
    float fall = aUv.y * column - uTime * speed;
    float head = fall - column * floor(fall / column);
    float dx = aNormal.x / max(abs(aNormal.z), 0.001);
    float dy = aNormal.y / max(abs(aNormal.z), 0.001);
    float stretch = 0.62 + uRain * 0.95;
    vec3 center = vec3(uEye.x + aPos.x, uEye.y - 1.4 + head, uEye.z + aPos.z);
    vColor = aColor;
    vKind = aKind;
    vUv = aUv;
    vec3 toEye = vec3(uEye.x - center.x, 0.0, uEye.z - center.z);
    float span = length(toEye);
    if (span < 2.0 || aUv.x > uRain) {
      vWorld = center;
      vNormal = vec3(0.0, 0.0, 1.0);
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    vec3 right = cross(vec3(0.0, 1.0, 0.0), toEye / span);
    float wide = sign(dx) * max(abs(dx), span * 0.0012);
    vec3 p = center + right * wide + vec3(0.0, dy * stretch, 0.0);
    vWorld = p;
    vNormal = vec3(0.0, 0.0, 1.0);
    gl_Position = uViewProj * vec4(p, 1.0);
    return;
  }
  if (aKind > 7.5 && aKind < 8.5) {
    pos.x += wave(uTime * 2.2 + aPos.y * 1.4) * 0.03;
  }
  if (aKind > 8.5 && aKind < 9.5) {
    vec3 center = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 Nn = normalize(mat3(uModel) * aNormal);
    vec3 dir = aColor;
    float dl = length(dir);
    dir = dl > 0.001 ? dir / dl : vec3(0.0, 1.0, 0.0);
    vec3 toEye = uEye - center;
    float dist = length(toEye);
    vec3 toCam = dist > 0.001 ? toEye / dist : vec3(0.0, 0.0, 1.0);
    if (dot(Nn, toCam) < 0.02) {
      vWorld = center;
      vNormal = Nn;
      vColor = vec3(0.0);
      vKind = aKind;
      vUv = vec2(0.0);
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    vec3 along = dir - toCam * dot(dir, toCam);
    float al = length(along);
    if (al < 0.12) {
      vec3 hint = abs(toCam.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      along = normalize(cross(hint, toCam));
    } else {
      along /= al;
    }
    vec3 across = cross(along, toCam);
    float clen = length(across);
    across = clen > 0.001 ? across / clen : vec3(1.0, 0.0, 0.0);
    float px = dist * 0.00125;
    float hx = max(abs(aUv.x), 3.0 * px);
    float hy = max(abs(aUv.y), 11.0 * px);
    float sx = aUv.x >= 0.0 ? 1.0 : -1.0;
    float sy = aUv.y >= 0.0 ? 1.0 : -1.0;
    float seed = fract(sin(dot(aPos, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    if (fract(seed * 7.13) > 0.5) sy = -sy;
    center += Nn * 0.035 + toCam * 0.05;
    vec3 p = center + across * (sx * hx) + along * (sy * hy);
    float cell = floor(fract(seed * 3.17) * 4.0);
    float col = mod(cell, 4.0);
    float flip = seed > 0.5 ? -1.0 : 1.0;
    float su = sx * flip;
    float uu = (col + (su > 0.0 ? 1.0 : 0.0)) / 4.0;
    float vv = sy > 0.0 ? 1.0 : 0.5;
    vWorld = p;
    vNormal = Nn;
    vColor = vec3(0.42, 0.30, 0.20);
    vKind = aKind;
    vUv = vec2(uu, vv);
    gl_Position = uViewProj * vec4(p, 1.0);
    return;
  }
  if (aKind > 13.5 && aKind < 14.5) {
    vec3 center = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 Nn = normalize(mat3(uModel) * aNormal);
    float hx = abs(aUv.x);
    float hy = abs(aUv.y);
    float sx = aUv.x >= 0.0 ? 1.0 : -1.0;
    float sy = aUv.y >= 0.0 ? 1.0 : -1.0;
    float seed = fract(sin(dot(aPos, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float high = clamp(center.y * 0.06, 0.12, 1.0);
    float gust = 0.5 + 0.5 * wave(uTime * 1.15 + aPos.x * 0.17 + aPos.z * 0.11);
    float sway = wave(uTime * (1.1 + seed) + seed * 30.0) * (0.04 + 0.12 * gust) * uWind * high;
    center.x += 0.92 * sway;
    center.z += 0.39 * sway;
    center.y += wave(uTime * (1.7 + seed) + seed * 20.0) * (0.02 + 0.06 * gust) * uWind * high;
    vec3 toCam = uEye - center;
    float dist = length(toCam);
    toCam = dist > 0.001 ? toCam / dist : vec3(0.0, 0.0, 1.0);
    vec3 axis = cross(Nn, toCam);
    float al = length(axis);
    axis = al > 0.0001 ? axis / al : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(toCam, axis));
    float spin = (seed - 0.5) * 2.0 + wave(uTime * 3.0 + seed * 50.0) * 0.5 * uWind;
    float cs = cos(spin);
    float sn = sin(spin);
    vec3 along = axis * cs + side * sn;
    vec3 across = cross(along, toCam);
    center += toCam * max(hx, hy) * 0.35;
    vec3 leaf = center + across * (sx * hx) + along * (sy * hy);
    float cell = fract(seed * 3.17) > 0.5 ? 5.0 : 4.0;
    float col = mod(cell, 4.0);
    float row = floor(cell / 4.0);
    float flip = seed > 0.5 ? -1.0 : 1.0;
    float endf = fract(seed * 7.13) > 0.5 ? -1.0 : 1.0;
    float su = sx * flip;
    float sv = sy * endf;
    float uu = (col + (su > 0.0 ? 1.0 : 0.0)) / 4.0;
    float vTop = (2.0 - row) / 2.0;
    float vv = sv > 0.0 ? vTop : vTop - 0.5;
    vWorld = leaf;
    vNormal = Nn;
    vColor = aColor;
    vKind = aKind;
    vUv = vec2(uu, vv);
    gl_Position = uViewProj * vec4(leaf, 1.0);
    return;
  }
  if (aKind > 12.5 && aKind < 13.5) {
    vec3 center = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 toCam = normalize(uEye - center);
    vec3 hint = abs(toCam.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(hint, toCam));
    vec3 upv = cross(toCam, right);
    float hx = abs(aNormal.x / max(abs(aNormal.z), 0.05));
    float hy = abs(aNormal.y / max(abs(aNormal.z), 0.05));
    float sx = aNormal.x >= 0.0 ? 1.0 : -1.0;
    float sy = aNormal.y >= 0.0 ? 1.0 : -1.0;
    float ff = clamp(aPos.y * 0.05, 0.0, 1.0);
    float pace = 0.85 + uWind * 0.45;
    float gust = wave(uTime * 1.15 * pace + aPos.x * 0.17 + aPos.z * 0.13);
    float lift = 0.35 + 0.65 * ff;
    center += vec3(0.92, -0.05, 0.39) * gust * 0.1 * uWind * lift;
    vec3 leaf = center + right * (sx * hx) + upv * (sy * hy);
    leaf += right * wave(uTime * (2.2 + uWind) + aPos.x * 3.0) * hx * 0.03 * uWind;
    float tip = clamp(aNormal.y / max(abs(aNormal.z), 0.05), 0.0, 1.0);
    float blade = smoothstep(1.2, 2.6, hy / max(hx, 0.02));
    float bend = wave(uTime * (1.3 + uWind * 0.7) + aPos.x * 0.8 + aPos.z * 0.5);
    float amp = uWind * (0.045 + blade * 0.12) * tip;
    leaf.x += 0.92 * bend * amp;
    leaf.z += 0.39 * bend * amp;
    vWorld = leaf;
    vNormal = vec3(0.0, 1.0, 0.0);
    vColor = aColor;
    vKind = aKind;
    vUv = aUv;
    gl_Position = uViewProj * vec4(leaf, 1.0);
    return;
  }
  if (aKind > 15.5 && aKind < 16.5) {
    vec3 root = (uModel * vec4(aPos, 1.0)).xyz;
    float seed = fract(sin(dot(aPos.xz, vec2(127.1, 311.7))) * 43758.5453);
    float seedw = fract(sin(dot(aPos.xz, vec2(269.5, 183.3))) * 43758.5453);
    float sp = floor((aKind - 16.0) * 10.0 + 0.5);
    float lobe = 0.10;
    if (sp > 0.5 && sp < 1.5) lobe = 0.26;
    else if (sp > 1.5 && sp < 2.5) lobe = 0.16;
    else if (sp > 2.5 && sp < 3.5) lobe = 0.12;
    else if (sp > 3.5) lobe = 0.20;
    bool stem = aUv.y < 0.0;
    float rise = stem ? -aUv.y : aUv.y;
    float along = stem ? clamp(aNormal.y, 0.0, 1.0) : 1.0;
    vec3 p = root + vec3(0.0, rise * along, 0.0);
    float flut = wave(uTime * (2.1 + seedw) + seed * 6.2832);
    float sway = wave(uTime * (1.5 + seed) + seedw * 4.0);
    float amp = uWind * 0.14 * along;
    p.x += (0.92 * flut - 0.39 * sway * 0.4) * amp;
    p.z += (0.39 * flut + 0.92 * sway * 0.4) * amp;
    vec3 toEye = uEye - p;
    float dist = length(toEye);
    vec3 toCam = dist > 0.001 ? toEye / dist : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(0.0001, 0.0, 0.0));
    vec3 upv = cross(toCam, right);
    if (stem) {
      p += right * (aNormal.x * max(aUv.x, dist * 0.0007));
      vColor = vec3(0.46, 0.62, 0.30) * (0.94 + seed * 0.12);
      vUv = vec2(2.0, 2.0);
    } else {
      vec2 q = aNormal.xy;
      if (aNormal.z > 1.5) q *= (1.0 - lobe);
      q.y *= 0.66 + 0.34 * seedw;
      float rot = seed * 6.2832;
      float cr = cos(rot);
      float sr = sin(rot);
      q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
      p += (right * q.x + upv * q.y) * aUv.x + toCam * 0.02;
      vColor = vec3(0.92 + seedw * 0.16);
      vUv = aNormal.xy;
    }
    vWorld = p;
    vNormal = vec3(0.0, 1.0, 0.0);
    vKind = aKind;
    gl_Position = uViewProj * vec4(p, 1.0);
    return;
  }
  vec4 world = uModel * vec4(pos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vKind = aKind;
  vUv = aUv;
  // Height in the high 10 bits, grid strength in the low 6. 0.4/65536 matches the actor.
  if (aKind > 14.5 && aKind < 15.5) {
    float e = floor((aKind - 15.0) * (65536.0 / 0.4) + 0.5);
    float zi = floor(e / 64.0);
    vRind = zi / 1023.0;
    vMask = (e - zi * 64.0) / 63.0;
  }
  gl_Position = uViewProj * world;
}
`

export const FORWARD_FS = `
precision mediump float;
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define WATER_P highp
#else
#define WATER_P mediump
#endif
varying vec3 vNormal;
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec3 vWorld;
varying highp vec2 vUv;
varying highp float vRind;
varying highp float vMask;
#else
varying mediump vec3 vWorld;
varying mediump vec2 vUv;
varying mediump float vRind;
varying mediump float vMask;
#endif
varying vec3 vColor;
varying float vKind;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uEye;
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp float uTime;
#else
uniform float uTime;
#endif
uniform float uRain;
uniform float uMist;
uniform float uDim;
uniform float uLook;
uniform sampler2D uLeaf;
uniform sampler2D uFace;
uniform vec3 uFirePos;
uniform float uFire;

float cloudSdf(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  float d = 1e3;
  d = min(d, length((p - vec2(-0.22, 0.02)) / vec2(0.58, 0.40)) - 1.0);
  d = min(d, length((p - vec2(0.26, 0.10)) / vec2(0.50, 0.34)) - 1.0);
  d = min(d, length((p - vec2(0.02, -0.16)) / vec2(0.66, 0.30)) - 1.0);
  d = min(d, length((p - vec2(-0.02, 0.30)) / vec2(0.38, 0.28)) - 1.0);
  d = min(d, length((p - vec2(0.18, 0.34)) / vec2(0.28, 0.22)) - 1.0);
  return d;
}

// 127.1 is not exact in mediump, and 43758 overflows it, so fract() is 0.
// Desktop GPUs promote mediump to fp32 and the hash still looks like noise.
// Phones do not: value noise then collapses into a cross on the fog and the water.
// These factors are exact in fp16, and every product stays inside 2048.
WATER_P vec2 waterHash2(WATER_P vec2 p) {
  p = mod(p, vec2(113.0, 127.0));
  WATER_P float u = mod(mod(p.x * 7.0, 113.0) + mod(p.y * 5.0, 127.0), 113.0) * (1.0 / 113.0);
  WATER_P float v = mod(mod(p.y * 11.0, 127.0) + mod(p.x * 3.0, 113.0), 127.0) * (1.0 / 127.0);
  WATER_P float s = mod(mod(p.x * 17.0, 113.0) + mod(p.y * 13.0, 127.0), 113.0) * (1.0 / 113.0);
  WATER_P float t = mod(mod(p.y * 13.0, 127.0) + mod(p.x * 9.0, 113.0), 127.0) * (1.0 / 127.0);
  return vec2(fract(u * 7.0 + t * 3.0 + u * t), fract(v * 5.0 + s * 3.0 + v * s));
}
WATER_P float waterSmin(WATER_P float a, WATER_P float b, WATER_P float k) {
  WATER_P float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k / 6.0;
}
WATER_P vec2 waterCell(WATER_P vec2 seed, WATER_P float speed) {
  WATER_P float t = uTime;
  WATER_P vec2 ang = mod(t * speed + 6.2831853 * seed, 6.2831853);
  return 0.5 + 0.5 * sin(ang);
}
WATER_P float waterEdge(WATER_P vec2 p, WATER_P float speed, WATER_P float smoothK) {
  WATER_P vec2 cell = floor(p);
  WATER_P vec2 f = fract(p);
  WATER_P float nearest = 8.0;
  WATER_P float smoothNearest = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      WATER_P vec2 n = vec2(float(x), float(y));
      WATER_P vec2 pt = waterCell(waterHash2(cell + n), speed);
      WATER_P float d = length(n + pt - f);
      nearest = min(nearest, d);
      smoothNearest = waterSmin(smoothNearest, d, smoothK);
    }
  }
  return nearest - smoothNearest;
}
WATER_P float waterNHash(WATER_P vec2 p) {
  p = mod(p, vec2(113.0, 127.0));
  WATER_P float u = mod(mod(p.x * 7.0, 113.0) + mod(p.y * 5.0, 127.0), 113.0) * (1.0 / 113.0);
  WATER_P float v = mod(mod(p.y * 11.0, 127.0) + mod(p.x * 3.0, 113.0), 127.0) * (1.0 / 127.0);
  return fract(u * 7.0 + v * 3.0 + u * v);
}
WATER_P float waterVnoise(WATER_P vec2 p) {
  WATER_P vec2 cell = floor(p);
  WATER_P vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(waterNHash(cell), waterNHash(cell + vec2(1.0, 0.0)), f.x),
    mix(waterNHash(cell + vec2(0.0, 1.0)), waterNHash(cell + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
WATER_P float waterFbm(WATER_P vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 2; i++) {
    v += a * waterVnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}
float pondRadius(float theta) {
  return 50.0
    + 8.0 * sin(2.0 * theta + 1.0)
    + 5.5 * sin(3.0 * theta + 0.3)
    + 3.5 * sin(5.0 * theta + 2.1);
}
float shoreStep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  bool stroke = (vKind > 12.5 && vKind < 14.5) || (vKind > 8.5 && vKind < 9.5);
  vec4 mark = vec4(1.0);
  if (stroke) {
    mark = texture2D(uLeaf, vUv);
    if (mark.g < 0.32) discard;
  }
  vec3 n = normalize(vNormal);
  if ((vKind > 1.5 && vKind < 2.5) || (vKind > 5.5 && vKind < 6.5) || (vKind > 7.5 && vKind < 8.5) || (vKind > 9.5 && vKind < 12.5)) {
    if (!gl_FrontFacing) n = -n;
  }
  vec3 albedo = vColor;
  if (vKind > 14.5 && vKind < 15.5) {
    // Diamond fruitlets. uv is a unit angle, so the face fade cannot bend it.
    // vRind is bind height. The seam of atan sits on a groove, so it does not show.
    float span = dot(vUv, vUv);
    if (span > 0.5 && vMask > 0.02) {
      float inv = inversesqrt(span);
      float s = vUv.x * inv;
      float c = vUv.y * inv;
      float s2 = 2.0 * s * c;
      float c2 = c * c - s * s;
      float s4 = 2.0 * s2 * c2;
      float c4 = c2 * c2 - s2 * s2;
      float s8 = 2.0 * s4 * c4;
      float c8 = c4 * c4 - s4 * s4;
      float sn = s8 * c2 + c8 * s2;
      float cs = c8 * c2 - s8 * s2;
      float kz = mod((vRind - 0.58) * 52.36, 6.2831853);
      float sk = sin(kz);
      float ck = cos(kz);
      float b1 = abs(atan(sn * ck + cs * sk, cs * ck - sn * sk)) * 0.31831;
      float b2 = abs(atan(sn * ck - cs * sk, cs * ck + sn * sk)) * 0.31831;
      float edge = max(b1, b2);
      float groove = smoothstep(0.74, 0.98, edge);
      float pit = 1.0 - smoothstep(0.0, 0.08, length(vec2(b1, b2)));
      float mask = clamp(vMask, 0.0, 1.0);
      vec3 painted = albedo;
      if (uLook > 1.5) {
        float cell = floor(b1 * 8.0) + floor(b2 * 8.0) * 9.0;
        float h = fract(sin(mod(cell, 50.0) * 0.7) * 13.0);
        float star = step(0.86, h) * (0.55 + 0.45 * sin(uTime * 2.4 + cell));
        painted = mix(vec3(0.08, 0.1, 0.26), vec3(1.0, 0.94, 0.7), star * (1.0 - groove));
      } else if (uLook > 0.5) {
        vec3 flesh = vec3(0.86, 0.18, 0.24) * mix(0.82, 1.08, 1.0 - edge);
        painted = mix(flesh, vec3(0.98, 0.86, 0.28), pit);
      } else {
        vec3 seam = albedo * vec3(0.84, 0.70, 0.48);
        painted = mix(albedo, seam, groove * 0.5);
        painted = mix(painted, albedo * vec3(0.78, 0.62, 0.42), pit * 0.35);
      }
      albedo = mix(albedo, painted, mask);
    }
  }
  if (vKind > 15.5 && vKind < 16.5 && dot(vUv, vUv) < 2.0) {
    float sp = floor((vKind - 16.0) * 10.0 + 0.5);
    vec3 petal = vec3(0.941, 0.337, 0.180);
    vec3 ctr = vec3(0.227, 0.114, 0.235);
    float ctrR = 0.27;
    if (sp > 0.5 && sp < 1.5) {
      petal = vec3(1.0, 0.988, 0.949);
      ctr = vec3(1.0, 0.847, 0.290);
      ctrR = 0.43;
    } else if (sp > 1.5 && sp < 2.5) {
      petal = vec3(1.0, 0.498, 0.690);
      ctr = vec3(1.0, 0.839, 0.894);
      ctrR = 0.36;
    } else if (sp > 2.5 && sp < 3.5) {
      petal = vec3(0.541, 0.373, 0.816);
      ctr = vec3(0.714, 0.584, 0.933);
      ctrR = 0.50;
    } else if (sp > 3.5) {
      petal = vec3(1.0, 0.847, 0.290);
      ctr = vec3(1.0, 0.651, 0.180);
      ctrR = 0.38;
    }
    petal *= vColor.r;
    albedo = mix(ctr, petal, smoothstep(ctrR - 0.05, ctrR + 0.05, length(vUv)));
  }
  float alpha = 1.0;
  bool unlit = false;
  if (vKind > 3.15 && vKind < 3.45) {
    float r = length(vUv);
    float ring = smoothstep(1.05, 0.76, r) * smoothstep(0.4, 0.66, r);
    float life = clamp(vNormal.x, 0.0, 1.0);
    float dist = length(vWorld.xz - uEye.xz);
    alpha = ring * (1.0 - life) * (0.22 + 0.28 * uRain) * (1.0 - smoothstep(3.2, 6.2, dist));
    if (alpha < 0.04) discard;
    albedo = vec3(0.82, 0.9, 0.98);
    unlit = true;
  }
  if (vKind > 2.5 && vKind < 3.15) {
    if (vUv.x > uRain) discard;
    float dist = length(vWorld - uEye);
    alpha = (0.16 + 0.18 * uRain) * smoothstep(0.4, 1.4, dist) * (1.0 - smoothstep(14.0, 22.0, dist));
    unlit = true;
  }
  if (vKind > 4.5 && vKind < 5.5) {
    unlit = true;
    if (vUv.x + vUv.y < 0.001) {
      alpha = 0.7;
    } else {
      float d = cloudSdf(vUv);
      alpha = 1.0 - smoothstep(-0.16, 0.16, d);
      if (alpha < 0.04) discard;
    }
  }
  if (vKind > 7.5 && vKind < 8.5) {
    alpha = 0.72;
    unlit = true;
  }
  if (vKind > 16.5 && vKind < 17.5) unlit = true;
  if (vKind < 0.5) {
    float sd = length(vWorld.xz) - pondRadius(atan(vWorld.z, vWorld.x));
    albedo = mix(albedo, vec3(0.50, 0.52, 0.36), shoreStep(2.4, 0.3, sd) * 0.7);
    albedo = mix(albedo, vec3(0.101, 0.356, 0.580), shoreStep(0.3, -1.6, sd));
    albedo *= mix(1.0, 0.8, uRain);
  }
  if (vKind > 8.5 && vKind < 9.5) {
    float species = floor((vKind - 9.0) * 5.0 + 0.5);
    float roll = fract(sin(dot(vWorld, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float r2 = fract(sin(dot(vWorld.zy, vec2(269.5, 183.3))) * 43758.5453);
    bool birch = species > 0.5 && species < 1.5;
    vec3 c = vec3(0.50, 0.35, 0.23);
    if (birch) c = vec3(0.98, 0.97, 0.94);
    else if (species > 1.5) c = vec3(0.42, 0.27, 0.17);
    if (birch) {
      float scar = fract(vWorld.y * 5.5 + r2 * 4.0);
      if (scar < 0.035) c = vec3(0.20, 0.16, 0.15);
      c *= 0.96 + 0.04 * roll;
    } else if (r2 < 0.14 && dot(n, normalize(uSunDir)) < 0.05) c = mix(c, vec3(0.28, 0.36, 0.16), 0.7);
    else if (roll > 0.92) c = mix(c, vec3(0.56, 0.57, 0.40), 0.5);
    if (!birch) c *= 0.7 + 0.55 * roll;
    c = mix(c, c * vec3(1.16, 1.08, 0.94) + vec3(0.02, 0.012, 0.0), smoothstep(0.52, 0.78, mark.b));
    albedo = c * (birch ? 0.97 + 0.06 * mark.r : 0.90 + 0.18 * mark.r);
  }
  float ndl = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
  if (vKind > 13.5 && vKind < 14.5) ndl = ndl * 0.5 + 0.55;
  if (vKind > 8.5 && vKind < 9.5) {
    float barkSpecies = floor((vKind - 9.0) * 5.0 + 0.5);
    if (barkSpecies > 0.5 && barkSpecies < 1.5) ndl = ndl * 0.18 + 0.84;
  }
  vec3 lit = mix(vec3(0.46, 0.56, 0.66), uSunColor, ndl);
  lit *= mix(1.0, 0.28, clamp(uDim, 0.0, 1.0));
  vec3 col = unlit ? albedo : albedo * lit;
  if (vKind > 15.5 && vKind < 16.5) col = mix(col, albedo, dot(vUv, vUv) < 2.0 ? 0.34 : 0.22);
  if (vKind < 0.5 && uRain > 0.02) {
    col += vec3(0.62, 0.7, 0.78) * pow(ndl, 10.0) * uRain * 0.2;
  }
  if (vKind > 0.5 && vKind < 1.5) {
    WATER_P vec2 wpos = vWorld.xz;
    WATER_P float wtime = uTime;
    WATER_P float noiseFac = waterFbm(wpos * 0.87 + vec2(wtime * 0.11, 0.0));
    WATER_P vec2 uv = wpos * 0.23 + vec2(0.07, -0.23) * wtime + vec2(noiseFac - 0.5) * 0.26;
    float t = smoothstep(-0.01, 0.19, waterEdge(uv, 0.55, 0.46));
    float seg0 = clamp(t / 0.31, 0.0, 1.0);
    float seg1 = clamp((t - 0.31) / 0.69, 0.0, 1.0);
    vec3 surf = mix(
      mix(vec3(0.153, 0.639, 0.847), vec3(0.349, 0.753, 0.910), seg0),
      mix(vec3(0.349, 0.753, 0.910), vec3(1.0), seg1),
      step(0.31, t)
    );
    vec3 bed = mix(vec3(0.102, 0.667, 0.910), vec3(0.090, 0.439, 0.588), smoothstep(0.35, 0.65, noiseFac));
    col = mix(bed, surf, mix(0.37, 1.0, t));
    float depth = max(vUv.x, 0.0);
    float shal = 1.0 - smoothstep(0.03, 0.4, depth);
    vec3 bank = vec3(0.42, 0.48, 0.34);
    col = mix(col, mix(bank, col, 0.35), shal * 0.8);
    float line = (1.0 - smoothstep(0.0, 0.06, abs(depth - 0.015))) * step(0.42, waterVnoise(wpos * 0.55 + 9.1));
    col = mix(col, vec3(0.82, 0.94, 1.0), line * 0.55);
  }
  if (uFire > 0.001 && (vKind < 2.5 || (vKind > 5.5 && vKind < 16.5) || vKind > 17.5)) {
    vec3 toF = uFirePos - vWorld;
    float fd = length(toF);
    float atten = clamp(1.0 - fd * (1.0 / 14.0), 0.0, 1.0);
    atten *= atten;
    vec3 ldir = toF / max(fd, 0.001);
    float wrap = clamp(dot(n, ldir) * 0.65 + 0.35, 0.0, 1.0);
    float flick = 0.94 + 0.06 * sin(mod(uTime * 9.0, 6.2831853));
    vec3 surface = (vKind > 0.5 && vKind < 1.5) ? col : albedo;
    col += surface * vec3(1.0, 0.42, 0.08) * wrap * atten * uFire * flick * 1.15;
  }
  float dist = length(vWorld - uEye);
  float fog = 1.0 - exp(-uFogDensity * dist);
  if (uMist > 0.02) {
    float h = max(vWorld.y - (uEye.y - 1.7), 0.0);
    float n = waterVnoise(vWorld.xz * 0.08 + vec2(0.92, 0.39) * uTime * 0.12);
    float hf = exp(-h * mix(0.7, 0.28, clamp(uMist, 0.0, 1.0)));
    fog = max(fog, hf * (0.6 + 0.4 * n) * uMist * (1.0 - exp(-dist * 0.08)));
  }
  if (vKind > 2.5 && vKind < 3.5) fog *= 0.22;
  if (vKind > 16.5 && vKind < 17.5) fog *= 0.12;
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.92));
  gl_FragColor = vec4(col, alpha);
}
`

export const SKY_VS = `
attribute vec2 aPos;
varying vec2 vClip;
void main() {
  vClip = aPos;
  gl_Position = vec4(aPos, 1.0, 1.0);
}
`

export const SKY_FS = `
precision mediump float;
varying vec2 vClip;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uAspect;
uniform float uTan;
uniform vec3 uSunDir;
uniform float uSunEl;
uniform vec3 uMoonDir;
uniform float uMoonEl;
uniform vec2 uMoonLit;
uniform float uMoonCos;
uniform float uNight;
uniform float uRain;
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp float uDrift;
uniform highp float uLift;
#else
uniform float uDrift;
uniform float uLift;
#endif
uniform float uMist;
uniform float uFlash;
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uHor;
uniform vec3 uHorSun;
uniform vec3 uDisc;
uniform vec3 uCloudLit;
uniform vec3 uCloudMid;
uniform vec3 uCloudSh;
uniform float uCover;

float hash(vec2 p) {
#ifdef GL_FRAGMENT_PRECISION_HIGH
  // mediump only reaches about ±16384. A star cell dotted with (127.1, 311.7)
  // already passes that, and 43758 overflows it outright, so fract() is 0 and
  // step() never lights a star. Desktop GPUs promote mediump to fp32; phones do not.
  highp float x = p.x;
  highp float y = p.y;
  highp float s = 127.1;
  highp float t = 311.7;
  highp float k = 43758.5453;
  return fract(sin(x * s + y * t) * k);
#else
  float x = mod(p.x, 113.0);
  float y = mod(p.y, 127.0);
  float a = mod(mod(x * 7.0, 113.0) + mod(y * 5.0, 127.0), 113.0);
  float b = mod(mod(y * 11.0, 127.0) + mod(x * 3.0, 113.0), 127.0);
  float u = a * (1.0 / 113.0);
  float v = b * (1.0 / 127.0);
  return fract(u * 7.0 + v * 3.0 + u * v);
#endif
}
// Value noise that repeats on x every period cells. period must stay a whole number.
// atan(z, x) jumps by 2π on the -X meridian, so a plain fbm sample splits the sky there.
float noiseRing(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x + period, period);
  float x1 = mod(i.x + 1.0 + period, period);
  float a = hash(vec2(x0, i.y));
  float b = hash(vec2(x1, i.y));
  float c = hash(vec2(x0, i.y + 1.0));
  float d = hash(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbmRing(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  float period = 7.0;
  for (int i = 0; i < 3; i++) {
    s += a * noiseRing(p, period);
    p = p * 2.0 + vec2(17.1, 9.3);
    period *= 2.0;
    a *= 0.5;
  }
  return s * 1.07;
}

void main() {
  vec3 dir = normalize(uForward + uRight * (vClip.x * uAspect * uTan) + uUp * (vClip.y * uTan));
  vec3 sun = normalize(uSunDir);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float e = max(el, 0.0);
  float az = atan(dir.z, dir.x);
  vec3 c = mix(uHor, uLow, smoothstep(0.0, 0.21, e));
  c = mix(c, uMid, smoothstep(0.12, 0.52, e));
  c = mix(c, uZen, smoothstep(0.34, 1.12, e));
  // Horizon angle between the ray and the sun. atan(az - sunAz) splits on the -X
  // meridian, and sunset sits 4° off that cut, so the wash was sliced in half.
  vec2 rayH = dir.xz;
  vec2 sunH = sun.xz;
  float rayN = length(rayH);
  float sunN = length(sunH);
  vec2 rayU = rayH / max(rayN, 1e-4);
  vec2 sunU = sunH / max(sunN, 1e-4);
  float dAz = atan(abs(rayU.x * sunU.y - rayU.y * sunU.x), dot(rayU, sunU));
  dAz *= step(1e-4, rayN) * step(1e-4, sunN);
  float g = exp(-(dAz * dAz) / 1.1) * exp(-e / 0.27);
  c = mix(c, uHorSun, g * 0.9 * smoothstep(-0.35, 0.05, uSunEl));
  float antiD = dAz - 3.14159265;
  float anti = exp(-(antiD * antiD) / 1.6) * exp(-e / 0.35);
  c = mix(c, mix(uLow, uMid, 0.5), anti * 0.35);
  float cover = clamp(max(uCover, 0.42), 0.0, 1.0);
  // Drift is wrapped to one repeat of every octave, so the hash stays a small angle.
  float n = fbmRing(vec2(az * (7.0 / 6.2831853) + uDrift, el * 2.4 + uLift) + vec2(4.0, 1.7));
  float band = smoothstep(0.02, 0.16, e) * (1.0 - smoothstep(0.95, 1.35, e));
  float cloud = smoothstep(mix(0.58, 0.36, cover), mix(0.72, 0.5, cover), n) * band;
  vec3 cc = mix(uCloudSh, uCloudMid, 0.55);
  cc = mix(cc, uCloudLit, g * 0.7);
  c = mix(c, cc, cloud * (0.62 + cover * 0.3));
  // The camera looks down, so the old 0.18 cutoff left stars in a sliver
  // under the top edge. Phones cover that edge; draw them through the night sky.
  if (uNight > 0.45 && e > 0.05) {
    // 264 cells around the sky, so a star cell is not cut by the ±π meridian.
    float starTurn = 264.0;
    vec2 sp = vec2(az * (starTurn / 6.2831853), el * 42.0);
    vec2 cell = vec2(mod(floor(sp.x) + starTurn, starTurn), floor(sp.y));
    float star = step(0.972, hash(cell)) * (1.0 - smoothstep(0.04, 0.28, length(fract(sp) - 0.5)));
    c = mix(c, vec3(1.0, 0.96, 0.82), star * uNight * (1.0 - cloud) * (1.0 - uRain));
  }
  c = mix(uHor, c, smoothstep(-0.06, 0.08, el));
  // Same solid disc and halo as the old dusk sun. The core fills in; the halo stays outside it.
  float ang = acos(clamp(dot(dir, sun), -1.0, 1.0));
  float disc = smoothstep(0.036, 0.026, ang);
  float glow = exp(-ang * ang / 0.02) * 0.55 + exp(-ang / 0.16) * 0.25;
  float discAmt = (1.0 - uRain) * smoothstep(-0.015, 0.05, uSunEl);
  c = mix(c, vec3(1.0, 0.945, 0.722), clamp(disc + glow, 0.0, 1.0) * discAmt);
  vec3 moonV = uMoonDir;
  float moonLen = length(moonV);
  moonV = moonLen > 0.2 ? moonV / moonLen : vec3(0.0, -1.0, 0.0);
  float mang = acos(clamp(dot(dir, moonV), -1.0, 1.0));
  float moonDisc = smoothstep(0.036, 0.026, mang);
  vec3 right = cross(vec3(0.0, 1.0, 0.0), moonV);
  float rightLen = length(right);
  right = rightLen > 1e-3 ? right / rightLen : vec3(1.0, 0.0, 0.0);
  vec3 moonUp = cross(moonV, right);
  vec3 rel = dir - moonV * dot(dir, moonV);
  vec2 uv = vec2(dot(rel, right), dot(rel, moonUp)) / 0.031;
  float z = sqrt(max(0.0, 1.0 - min(dot(uv, uv), 1.0)));
  float cosE = clamp(uMoonCos, -1.0, 1.0);
  float sinE = sqrt(max(0.0, 1.0 - cosE * cosE));
  float litLen = length(uMoonLit);
  vec2 litDir = litLen > 1e-4 ? uMoonLit / litLen : vec2(1.0, 0.0);
  float ndotl = dot(uv, litDir) * sinE - z * cosE;
  float lit = smoothstep(0.0, 0.08, ndotl);
  float apart = smoothstep(0.09, 0.22, acos(cosE));
  float night = clamp(uNight, 0.0, 1.0);
  float moonShow = (1.0 - uRain) * smoothstep(-0.02, 0.05, uMoonEl) * apart;
  float moonMask = moonDisc * moonShow;
  vec3 moonCol = mix(vec3(0.16, 0.17, 0.24), vec3(0.93, 0.94, 0.90), mix(1.0, lit, night));
  c = mix(c, moonCol, mix(lit, 1.0, night) * moonMask);
  c = mix(c, c * vec3(0.55, 0.6, 0.68), uRain * 0.72);
  c = mix(c, mix(uHor, vec3(0.78, 0.82, 0.86), 0.45), uMist * (1.0 - smoothstep(0.02, 0.55, e)) * 0.65);
  c += vec3(0.45, 0.52, 0.66) * uFlash;
  gl_FragColor = vec4(c, 1.0);
}
`

/** Y-billboard is built on the CPU. This pass is the UnityFire smooth flame. */
export const FIRE_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

export const FIRE_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uShape;
uniform sampler2D uNoise;
uniform sampler2D uMask;
uniform sampler2D uGrad;
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp float uTime;
#else
uniform float uTime;
#endif
uniform float uFactor;
void main() {
  vec2 uv = vUv;
  float bottomMask = texture2D(uMask, uv).r;
  float scroll = mod(uTime * 0.8, 1.0);
  vec2 noiseUV = vec2(uv.x, uv.y * 0.6 - scroll);
  vec2 nOff = vec2(0.012, 0.012);
  float noise = (
    texture2D(uNoise, noiseUV).r +
    texture2D(uNoise, noiseUV + nOff).r +
    texture2D(uNoise, noiseUV - nOff).r) * 0.333333;
  noise -= 0.5;
  float discontinue = texture2D(uNoise, uv).r;
  discontinue = mix(discontinue, 0.0, bottomMask);
  float displace = noise * discontinue * 2.125;
  vec4 shapeColor = texture2D(uShape, vec2(uv.x + displace, uv.y));
  float gray = 0.3 * shapeColor.r + 0.6 * shapeColor.g + 0.1 * shapeColor.b;
  float colorU = clamp(gray * 1.15 + 0.12, 0.0, 1.0);
  vec4 finalColor = texture2D(uGrad, vec2(colorU, uv.y));
  float colorScale = mix(0.1875, 1.25, uFactor);
  finalColor.rgb *= 1.5 * colorScale;
  float alpha = smoothstep(0.02, 0.55, gray);
  alpha = clamp(alpha * 0.95, 0.0, 1.0) * 1.05 * uFactor;
  float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(0.0, 0.06, 1.0 - uv.x)
    * smoothstep(0.0, 0.04, uv.y) * smoothstep(0.0, 0.08, 1.0 - uv.y);
  alpha *= edge;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(finalColor.rgb * alpha, alpha);
}
`
