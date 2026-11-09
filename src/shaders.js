// Shaders GLSL : ciel, sable, eau (île simulée + océan lointain), particules.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uPC;   // centre du bord de la toile du parasol
uniform vec3 uPN;   // axe du parasol
uniform float uPR;  // rayon de la toile
uniform vec3 uPB;   // pied du mât
uniform vec4 uTool; // centre de l'outil tenu (xyz) et rayon de son ombre

const vec3 SUN_COL = vec3(1.0, 0.93, 0.80) * 3.2;
const vec3 SKY_AMB = vec3(0.36, 0.50, 0.74) * 0.95;
const vec3 GND_AMB = vec3(0.50, 0.42, 0.30) * 0.40;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 5.3); a *= 0.5; }
  return s;
}

vec3 skyColor(vec3 d, float sunDisc){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(vec3(0.56, 0.72, 0.88), vec3(0.10, 0.27, 0.62), pow(h, 0.5));
  float mu = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.8, 0.55) * (pow(mu, 6.0) * 0.10 + pow(mu, 48.0) * 0.30);
  if (d.y > 0.015) {
    vec2 cp = d.xz / (d.y + 0.12) * 0.85 + uTime * vec2(0.006, 0.002);
    float n = fbm(cp);
    float c = smoothstep(0.50, 0.80, n) * smoothstep(0.015, 0.22, d.y);
    vec3 cc = mix(vec3(0.80, 0.85, 0.93), vec3(1.25, 1.2, 1.12), smoothstep(0.55, 0.9, n));
    col = mix(col, cc, c * 0.9);
  }
  col += sunDisc * vec3(1.0, 0.95, 0.8) * 50.0 * smoothstep(0.99975, 0.99992, mu);
  return col;
}

// Ombre analytique du parasol : intersection du rayon solaire avec le disque
// de la toile, et distance rayon/segment pour le mât.
float parasolShadow(vec3 p){
  float sh = 1.0;
  float dn = dot(uSunDir, uPN);
  float t = dot(uPC - p, uPN) / dn;
  if (t > 0.0) {
    vec3 q = p + uSunDir * t;
    float soft = 0.05 + 0.03 * t;
    sh = smoothstep(uPR - soft, uPR + soft, length(q - uPC));
  }
  vec3 v = uPC - uPB;
  vec3 w0 = p - uPB;
  float b = dot(uSunDir, v), c = dot(v, v), d = dot(uSunDir, w0), e = dot(v, w0);
  float tc = clamp((e - b * d) / max(c - b * b, 1e-5), 0.0, 1.0);
  float sc = dot(uSunDir, uPB + v * tc - p);
  if (sc > 0.0) {
    float dist = length(p + uSunDir * sc - (uPB + v * tc));
    sh *= mix(0.35, 1.0, smoothstep(0.015, 0.05 + 0.02 * sc, dist));
  }
  return sh;
}

// ombre douce de l'outil tenu au-dessus du sable
float toolShadow(vec3 p){
  if (uTool.w <= 0.0) return 1.0;
  vec3 v = uTool.xyz - p;
  float along = dot(v, uSunDir);
  if (along <= 0.0) return 1.0;
  float d = length(v - uSunDir * along);
  float soft = 0.04 + 0.12 * along;
  return mix(0.5, 1.0, smoothstep(uTool.w - soft, uTool.w + soft, d));
}

float caustic(vec2 p, float t){
  vec2 q = p * 6.5;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += 0.55 * vec2(sin(q.y * 1.7 + t * 1.1 + fi), sin(q.x * 1.5 - t * 0.9 + 1.7 * fi));
  }
  float c = sin(q.x) * sin(q.y);
  return pow(1.0 - abs(c), 5.0);
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

export const SKY_FRAG = /* glsl */ `
${COMMON}
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d, 1.0);
  // sous l'horizon : brume
  col = mix(col, vec3(0.50, 0.66, 0.82), smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GRID = /* glsl */ `
uniform sampler2D uData;   // r: sable, g: surface de l'eau, b: humidité, a: écume
uniform float uL;
uniform float uTexel;
uniform float uDx;
vec2 w2uv(vec2 xz){ return (xz / uL + 0.5) * (1.0 - uTexel) + 0.5 * uTexel; }
`;

export const SAND_VERT = /* glsl */ `
${GRID}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vD;     // humidité, profondeur d'eau, concavité
#ifdef FLAT
uniform float uH0;
#endif
void main(){
#ifdef FLAT
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = vec3(0.0, 1.0, 0.0);
  vD = vec3(1.0, uH0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
#else
  vec4 d = texture2D(uData, uv);
  float sL = texture2D(uData, uv - vec2(uTexel, 0.0)).r;
  float sR = texture2D(uData, uv + vec2(uTexel, 0.0)).r;
  float sD = texture2D(uData, uv - vec2(0.0, uTexel)).r;
  float sU = texture2D(uData, uv + vec2(0.0, uTexel)).r;
  vec3 p = vec3(position.x, d.r, position.z);
  vN = normalize(vec3(sL - sR, 2.0 * uDx, sD - sU));
  vD = vec3(d.b, d.g - d.r, (sL + sR + sD + sU) * 0.25 - d.r);
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
#endif
}`;

export const SAND_FRAG = /* glsl */ `
${COMMON}
${GRID}
uniform vec4 uCursor;    // xz, rayon, intensité
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vD;

float terrainShadow(vec3 p){
  float res = 1.0;
  float t = 0.07;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 q = p + uSunDir * t;
    float h = q.y - texture2D(uData, w2uv(q.xz)).r;
    res = min(res, 9.0 * h / t);
    if (res < 0.0) break;
    t *= SHADOW_GROW;
  }
  return clamp(res, 0.0, 1.0);
}

float ripH(vec2 p){
  float n = vnoise(p * 0.6) + 0.5 * vnoise(p * 1.7);
  return sin((p.x * 0.97 + p.y * 0.24) * 46.0 + n * 7.0);
}

void main(){
  vec3 N = normalize(vN);
  float moist = clamp(vD.x, 0.0, 1.0);
  float depth = vD.y;
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  vec2 p = vWorld.xz;

  float under = smoothstep(0.0, 0.03, depth);
  float wet = max(smoothstep(0.03, 0.5, moist), under);

  // rides éoliennes sur le sable sec et peu pentu
  float flat_ = smoothstep(0.80, 0.95, N.y);
  float ripAmt = (1.0 - smoothstep(0.02, 0.3, moist)) * (1.0 - under) * flat_ * (1.0 - smoothstep(14.0, 40.0, dist));
  ripAmt += under * 0.5 * (1.0 - smoothstep(10.0, 30.0, dist));
  if (ripAmt > 0.01) {
    float e = 0.012;
    float r0 = ripH(p);
    vec2 g = vec2(ripH(p + vec2(e, 0.0)) - r0, ripH(p + vec2(0.0, e)) - r0) / e;
    N = normalize(N - vec3(g.x, 0.0, g.y) * 0.0028 * ripAmt);
  }

  // grain
  float fine = 1.0 - smoothstep(6.0, 28.0, dist);
  float g1 = vnoise(p * 70.0), g2 = vnoise(p * 290.0);
  float grain = mix(0.5, g1 * 0.45 + g2 * 0.55, fine);
  float patches = vnoise(p * 0.9) * 0.6 + vnoise(p * 3.1) * 0.4;

  vec3 dry = vec3(0.80, 0.57, 0.31) * mix(0.93, 1.07, patches);
  vec3 wetc = dry * vec3(0.40, 0.36, 0.31);
  vec3 albedo = mix(dry, wetc, wet) * (0.86 + 0.28 * grain);

  float ndl = max(dot(N, uSunDir), 0.0);
#ifdef FLAT
  float sh = 1.0;
  float ao = 1.0;
#else
  float sh = terrainShadow(vWorld + N * 0.012) * parasolShadow(vWorld) * toolShadow(vWorld);
  float ao = clamp(1.0 - vD.z * 9.0, 0.45, 1.0);
#endif
  vec3 sun = SUN_COL * ndl * sh;
  if (depth > 0.0) {
    float ca = caustic(p, uTime);
    sun *= mix(1.0, 0.72 + 0.95 * ca, under * exp(-depth * 0.6) * (1.0 - smoothstep(12.0, 45.0, dist)));
  }
  vec3 amb = mix(GND_AMB, SKY_AMB, N.y * 0.5 + 0.5) * ao;
  vec3 col = albedo * (sun + amb);

  // reflet du sable gorgé d'eau, scintillement des grains secs
  vec3 H = normalize(V + uSunDir);
  float ndh = max(dot(N, H), 0.0);
  float sheen = smoothstep(0.72, 1.0, moist) * (1.0 - under);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col = mix(col, skyColor(reflect(-V, N), 0.0), sheen * fres * 0.6);
  col += SUN_COL * sh * sheen * pow(ndh, 180.0) * 0.6;
  float glint = step(0.985, g2) * fine * (1.0 - wet);
  col += SUN_COL * sh * glint * pow(ndh, 24.0) * 0.5;

  // anneau du curseur
  float cd = length(p - uCursor.xy);
  float ring = (1.0 - smoothstep(0.006, 0.02, abs(cd - uCursor.z))) * uCursor.w;
  float halo = (1.0 - smoothstep(0.015, 0.05, abs(cd - uCursor.z))) * uCursor.w;
  col = mix(col, col * 0.45, halo * 0.6);
  col = mix(col, vec3(2.2), ring * 0.85);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const waterVert = (wavesGLSL) => /* glsl */ `
${GRID}
uniform float uTime;
uniform float uSwell;
uniform float uH0;
varying vec3 vWorld;
varying vec2 vXZ0;
varying vec3 vInfo;   // profondeur, écume, atténuation
varying vec2 vSlope;
${wavesGLSL}
void main(){
#ifdef SIM
  vec4 d = texture2D(uData, uv);
  float eL = texture2D(uData, uv - vec2(uTexel, 0.0)).g;
  float eR = texture2D(uData, uv + vec2(uTexel, 0.0)).g;
  float eD = texture2D(uData, uv - vec2(0.0, uTexel)).g;
  float eU = texture2D(uData, uv + vec2(0.0, uTexel)).g;
  vec3 p = vec3(position.x, d.g, position.z);
  vSlope = vec2(eR - eL, eU - eD) / (2.0 * uDx);
  vInfo = vec3(d.g - d.r, d.a, 1.0);
  vXZ0 = p.xz;
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ0 = wp.xz;
  float box = max(abs(wp.x), abs(wp.z));
  vec3 p = vec3(wp.x, 0.0, wp.z);
  #ifdef FAR
  vSlope = vec2(0.0);
  vInfo = vec3(uH0 + 14.0, 0.0, 0.0);
  #else
  // houle d'Airy + déplacement horizontal de Gerstner (trochoïde), atténués
  // vers le large pour rejoindre le plan lointain
  float fade = 1.0 - smoothstep(50.0, 88.0, box);
  vec2 slope; vec2 disp;
  float e = swellWave(wp.xz, uTime, slope, disp) * uSwell * fade;
  float gerst = smoothstep(uL * 0.5, uL * 0.5 + 7.0, box) * fade * uSwell;
  p = vec3(wp.x + disp.x * gerst, e, wp.z + disp.y * gerst);
  vSlope = slope * uSwell * fade;
  vInfo = vec3(uH0 + e + smoothstep(uL * 0.5, 60.0, box) * 14.0, 0.0, fade);
  #endif
#endif
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

export const waterFrag = (wavesGLSL) => /* glsl */ `
${COMMON}
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uSwell;
varying vec3 vWorld;
varying vec2 vXZ0;
varying vec3 vInfo;
varying vec2 vSlope;
${wavesGLSL}
void main(){
  float depth = vInfo.x;
#ifdef SIM
  if (depth <= 0.0004) discard;
#endif
#ifdef FAR
  if (max(abs(vXZ0.x), abs(vXZ0.y)) < FAR_INNER) discard;
#endif
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;

  float shallow = smoothstep(0.0, 0.12, depth);
  vec2 sl = vSlope + detailSlope(vXZ0, uTime, dist) * shallow * (0.3 + 0.7 * min(uSwell, 1.5));
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float ndv = max(dot(N, V), 0.03);

  // Fresnel (approximation de Schlick, F0 = 0,02 pour l'eau)
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R, 0.0);

  // réfraction du fond + absorption de Beer-Lambert le long du trajet
  vec2 suv = gl_FragCoord.xy / uRes;
  vec2 off = N.xz * 0.05 * clamp(depth * 2.0, 0.0, 1.0) / (1.0 + dist * 0.06);
  vec3 bg = texture2D(uScene, suv + off).rgb;
  float cosr = sqrt(1.0 - (1.0 - ndv * ndv) / 1.777);   // Snell-Descartes, n = 1,333
  vec3 T = exp(-vec3(0.85, 0.20, 0.13) * depth / cosr);
  float psh = parasolShadow(vWorld);
  vec3 light = SUN_COL * max(uSunDir.y, 0.0) * (0.3 + 0.7 * psh) + SKY_AMB;
  vec3 col = bg * T + vec3(0.012, 0.085, 0.10) * light * (1.0 - T);

  float edge = smoothstep(0.0, 0.02, depth);
  col = mix(col, refl, F * edge);
  float ndh = max(dot(N, normalize(V + uSunDir)), 0.0);
  col += SUN_COL * psh * edge * (pow(ndh, 700.0) * 6.0 + pow(ndh, 90.0) * 0.12);

  // écume
  float fn = fbm(vXZ0 * 4.0 + uTime * vec2(0.06, 0.03)) * 0.65 + vnoise(vXZ0 * 19.0 - uTime * vec2(0.05, 0.08)) * 0.35;
  float fm = smoothstep(0.50, 0.66, vInfo.y * 0.75 + fn * 0.55) * smoothstep(0.03, 0.25, vInfo.y);
  col = mix(col, vec3(0.95, 0.98, 1.0) * light * 0.42, fm * smoothstep(0.002, 0.012, depth));

  // perspective atmosphérique vers l'horizon
  float fog = 1.0 - exp(-dist * dist / (650.0 * 650.0));
  col = mix(col, vec3(0.54, 0.70, 0.86), fog);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const PARTICLE_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

export const PARTICLE_FRAG = /* glsl */ `
varying vec4 vColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float shade = 1.0 - 0.35 * r + 0.25 * max(0.0, -c.y - c.x);
  gl_FragColor = vec4(vColor.rgb * shade, vColor.a * (1.0 - r * r));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
