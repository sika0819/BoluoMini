export const FORWARD_VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aKind;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mediump float uTime;
uniform mediump vec3 uEye;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vKind;
varying vec2 vUv;
void main() {
  vec3 pos = aPos;
  if (aKind > 0.5 && aKind < 1.5) {
    vec2 wdir = vec2(0.92, 0.39);
    float along = pos.x * wdir.x + pos.z * wdir.y;
    pos.y += sin(along * 0.35 - uTime * 0.85) * 0.06 + cos(along * 0.17 + uTime * 0.45) * 0.035;
  }
  if (aKind > 1.5 && aKind < 2.5) {
    float tip = clamp((aColor.g - 0.46) / 0.42, 0.0, 1.0);
    float gust = sin(aPos.x * 0.07 - uTime * 0.45) * 0.5 + 0.5;
    float flut = sin(uTime * 1.9 + aPos.x * 0.7 + aPos.z * 0.4);
    float w = flut * tip * (0.07 + gust * 0.12);
    pos.x += w * 0.92;
    pos.z += w * 0.39;
  }
  if (aKind > 7.5 && aKind < 8.5) {
    pos.x += sin(uTime * 2.2 + aPos.y * 1.4) * 0.03;
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
    float gust = sin(uTime * 1.15 + aPos.x * 0.17 + aPos.z * 0.13);
    center += vec3(0.92, -0.08, 0.39) * gust * 0.12 * ff * ff;
    vec3 leaf = center + right * (sx * hx) + upv * (sy * hy);
    leaf += right * sin(uTime * 2.6 + aPos.x * 3.0) * hx * 0.04;
    float slim = abs(aNormal.y) / max(abs(aNormal.x), 0.015);
    if (slim > 3.0) {
      float gust = sin(uTime * 1.7 + aPos.x * 0.8 + aPos.z * 0.5);
      leaf.x += 0.92 * gust * 0.16 * clamp(aNormal.y, 0.0, 1.0);
      leaf.z += 0.39 * gust * 0.16 * clamp(aNormal.y, 0.0, 1.0);
    }
    vWorld = leaf;
    vNormal = toCam;
    vColor = aColor;
    vKind = aKind;
    vUv = aUv;
    gl_Position = uViewProj * vec4(leaf, 1.0);
    return;
  }
  vec4 world = uModel * vec4(pos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vKind = aKind;
  vUv = aUv;
  gl_Position = uViewProj * world;
}
`

export const FORWARD_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vKind;
varying vec2 vUv;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uEye;
uniform sampler2D uLeaf;

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

void main() {
  if (vKind > 12.5 && vKind < 13.5) {
    if (texture2D(uLeaf, vUv).g < 0.32) discard;
  }
  vec3 n = normalize(vNormal);
  if ((vKind > 1.5 && vKind < 2.5) || (vKind > 5.5 && vKind < 6.5) || vKind > 7.5) {
    if (!gl_FrontFacing) n = -n;
  }
  vec3 albedo = vColor;
  float alpha = 1.0;
  bool unlit = false;
  if (vKind > 2.5 && vKind < 3.5) {
    alpha = 0.45;
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
  float ndl = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
  vec3 col = unlit ? albedo : albedo * mix(vec3(0.32, 0.30, 0.28), uSunColor, ndl);
  float fog = 1.0 - exp(-uFogDensity * length(vWorld - uEye));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
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
uniform float uNight;
uniform float uRain;
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uHor;
uniform vec3 uHorSun;
uniform vec3 uDisc;

void main() {
  vec3 dir = normalize(uForward + uRight * (vClip.x * uAspect * uTan) + uUp * (vClip.y * uTan));
  vec3 sun = normalize(uSunDir);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float e = max(el, 0.0);
  vec3 c = mix(uHor, uLow, smoothstep(0.0, 0.21, e));
  c = mix(c, uMid, smoothstep(0.12, 0.52, e));
  c = mix(c, uZen, smoothstep(0.34, 1.12, e));
  float dAz = atan(dir.z, dir.x) - atan(sun.z, sun.x);
  dAz = mod(dAz + 3.14159, 6.28318) - 3.14159;
  float g = exp(-(dAz * dAz) / 1.1) * exp(-e / 0.27);
  c = mix(c, uHorSun, g * 0.9);
  float ang = acos(clamp(dot(dir, sun), -1.0, 1.0));
  float disc = smoothstep(0.04, 0.02, ang);
  float glow = exp(-ang * ang / 0.02) * 0.55 + exp(-ang / 0.16) * 0.22;
  float discAmt = (1.0 - uNight) * (1.0 - uRain) * smoothstep(-0.25, 0.12, sun.y);
  c = mix(c, uDisc, clamp(disc + glow, 0.0, 1.0) * discAmt);
  c = mix(uHor, c, smoothstep(-0.04, 0.16, el));
  c = mix(c, c * vec3(0.62, 0.66, 0.72), uRain * 0.55);
  gl_FragColor = vec4(c, 1.0);
}
`
