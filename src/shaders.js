// Shaders GLSL : ciel, sable, eau (île simulée + océan lointain), particules.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uPC;   // centre du bord de la toile du parasol
uniform vec3 uPN;   // axe du parasol
uniform float uPR;  // rayon de la toile
uniform vec3 uPB;   // pied du mât
uniform vec4 uToolA; // ombre de l'outil : capsule [A,B] de rayon A.w …
uniform vec3 uToolB;
uniform vec4 uTool2; // … plus une sphère (xyz, rayon)

// éclairage : dépend de l'heure (calculé dans world.js)
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uGndAmb;
uniform vec3 uZen;        // ciel au zénith
uniform vec3 uHor;        // horizon côté soleil
uniform vec3 uHor2;       // horizon à l'opposé
uniform vec3 uCloudDark;
uniform vec3 uCloudLit;
uniform vec2 uGlow;       // halo large / serré autour du soleil
uniform float uWind;      // vent normalisé 0..1
#define SUN_COL uSunCol
#define SKY_AMB uSkyAmb
#define GND_AMB uGndAmb

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
  float mu = max(dot(d, uSunDir), 0.0);
  // l'horizon est plus chaud du côté du soleil
  float side = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5));
  vec3 hor = mix(uHor2, uHor, side * side);
  vec3 col = mix(hor, uZen, pow(h, 0.5));
  vec3 tint = uSunCol / max(max(uSunCol.r, uSunCol.g), uSunCol.b);
  col += tint * (pow(mu, 6.0) * uGlow.x + pow(mu, 48.0) * uGlow.y);
  if (d.y > 0.015) {
    vec2 cp = d.xz / (d.y + 0.12) * 0.85 + uTime * vec2(0.004 + 0.012 * uWind, 0.002);
    float n = fbm(cp);
    float c = smoothstep(0.50, 0.80, n) * smoothstep(0.035, 0.30, d.y);
    vec3 cc = mix(uCloudDark, uCloudLit, smoothstep(0.55, 0.9, n) * (0.55 + 0.45 * pow(mu, 3.0)));
    col = mix(col, cc, c * 0.9);
  }
  col += sunDisc * tint * 50.0 * smoothstep(0.99975, 0.99992, mu);
  return col;
}

// Ombre d'une capsule [a,b] de rayon r : plus courte distance entre le rayon
// solaire issu de p et le segment. La pénombre s'élargit avec la distance
// (diamètre apparent du soleil).
float capsuleShadow(vec3 p, vec3 a, vec3 b, float r){
  vec3 v = b - a;
  vec3 w0 = p - a;
  float bb = dot(uSunDir, v), c = dot(v, v), d = dot(uSunDir, w0), e = dot(v, w0);
  float tc = clamp((e - bb * d) / max(c - bb * bb, 1e-5), 0.0, 1.0);
  vec3 q = a + v * tc;
  float sc = dot(uSunDir, q - p);
  if (sc <= 0.0) return 1.0;
  float soft = 0.006 + 0.012 * sc;
  return smoothstep(r - soft, r + soft, length(p + uSunDir * sc - q));
}

// Ombre du parasol : intersection du rayon solaire avec le disque de la
// toile, plus le mât.
float parasolShadow(vec3 p){
  float sh = 1.0;
  float dn = dot(uSunDir, uPN);
  float t = dot(uPC - p, uPN) / dn;
  if (t > 0.0) {
    vec3 q = p + uSunDir * t;
    float soft = 0.012 + 0.014 * t;
    sh = smoothstep(uPR - soft, uPR + soft, length(q - uPC));
  }
  return sh * mix(0.12, 1.0, capsuleShadow(p, uPB, uPC, 0.028));
}

// ombre de l'outil tenu au-dessus du sable
float toolShadow(vec3 p){
  float sh = 1.0;
  if (uToolA.w > 0.0) sh *= capsuleShadow(p, uToolA.xyz, uToolB, uToolA.w);
  if (uTool2.w > 0.0) sh *= capsuleShadow(p, uTool2.xyz, uTool2.xyz, uTool2.w);
  return sh;
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
  col = mix(col, skyColor(normalize(vec3(d.x, 0.0, d.z)), 0.0) * 0.93, smoothstep(0.0, -0.08, d.y));
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

const SHADOW = /* glsl */ `
uniform sampler2D uShadow;   // r: ligne d'ombre au-dessus du sol (codée), g: distance à l'obstacle
uniform float uShadowDrop;
uniform float uShadowTexel;
// above : hauteur du point au-dessus du sable (0 pour le sable, profondeur pour l'eau)
float terrainShadow(vec2 xz, float above){
  vec2 sv = texture2D(uShadow, (xz / uL + 0.5) * (1.0 - uShadowTexel) + 0.5 * uShadowTexel).rg;
  float t = sv.r * 2.0 - 1.0;
  float d = SHADOW_K * t / (1.004 - abs(t)) - above;
  // pénombre : s'élargit avec la distance à l'obstacle (diamètre apparent du soleil)
  float w = min(0.012 + 0.2 * sv.g, 0.6 * uShadowDrop);
  return 1.0 - smoothstep(-w, w, d);
}
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
${SHADOW}
uniform vec4 uCursor;    // xz, rayon, intensité
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vD;

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
  float sh = terrainShadow(vWorld.xz, 0.0) * parasolShadow(vWorld) * toolShadow(vWorld);
  float ao = clamp(1.0 - vD.z * 6.0, 0.62, 1.0);
#endif
  vec3 sun = SUN_COL * ndl * sh;
  if (depth > 0.0) {
    float ca = caustic(p, uTime);
    sun *= mix(1.0, 0.80 + 0.62 * ca, under * exp(-depth * 0.6) * (1.0 - smoothstep(12.0, 45.0, dist)));
  }
  // ciel + lumière chaude renvoyée par le sable ensoleillé alentour
  vec3 amb = (mix(GND_AMB, SKY_AMB, N.y * 0.5 + 0.5) + SUN_COL * vec3(0.80, 0.60, 0.38) * 0.07 * max(uSunDir.y, 0.0)) * ao;
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
  // pente de la surface : uniquement entre points mouillés (sinon les berges
  // raides fausseraient les reflets au bord de l'eau)
  vec2 tL = texture2D(uData, uv - vec2(uTexel, 0.0)).rg;
  vec2 tR = texture2D(uData, uv + vec2(uTexel, 0.0)).rg;
  vec2 tD = texture2D(uData, uv - vec2(0.0, uTexel)).rg;
  vec2 tU = texture2D(uData, uv + vec2(0.0, uTexel)).rg;
  float eL = tL.g - tL.r > 0.0005 ? tL.g : d.g;
  float eR = tR.g - tR.r > 0.0005 ? tR.g : d.g;
  float eD = tD.g - tD.r > 0.0005 ? tD.g : d.g;
  float eU = tU.g - tU.r > 0.0005 ? tU.g : d.g;
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
${GRID}
${SHADOW}
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
  vec2 base = vSlope;
#ifndef SIM
  // au large, la géométrie s'aplatit mais la houle reste visible dans les
  // reflets : pentes analytiques par pixel, estompées avant l'horizon
  vec2 ws; vec2 wd;
  swellWave(vXZ0, uTime, ws, wd);
  base = mix(ws * uSwell * (1.0 - smoothstep(120.0, 520.0, dist)), vSlope, vInfo.z);
#endif
  vec2 sl = base + detailSlope(vXZ0, uTime, dist) * shallow * (0.2 + 0.4 * min(uSwell, 1.5) + 0.9 * uWind);
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
  float psh = parasolShadow(vWorld) * toolShadow(vWorld);
#ifdef SIM
  psh *= terrainShadow(vXZ0, depth);
#endif
  vec3 light = SUN_COL * max(uSunDir.y, 0.0) * (0.3 + 0.7 * psh) + SKY_AMB;
  vec3 col = bg * T + vec3(0.012, 0.085, 0.10) * light * (1.0 - T);

  float edge = smoothstep(0.0, 0.02, depth);
  col = mix(col, refl, F * edge);
  float ndh = max(dot(N, normalize(V + uSunDir)), 0.0);
  col += SUN_COL * psh * edge * (pow(ndh, 700.0) * 6.0 + pow(ndh, 90.0) * 0.12);

  // écume
  float fn = fbm(vXZ0 * 4.0 + uTime * vec2(0.06, 0.03)) * 0.65 + vnoise(vXZ0 * 19.0 - uTime * vec2(0.05, 0.08)) * 0.35;
  float fm = smoothstep(0.52, 0.70, vInfo.y * 0.42 + fn * 0.62) * smoothstep(0.03, 0.25, vInfo.y);
  col = mix(col, vec3(0.95, 0.98, 1.0) * light * 0.42, fm * 0.92 * smoothstep(0.003, 0.025, depth));

  // perspective atmosphérique vers l'horizon
  float fog = 1.0 - exp(-dist * dist / (650.0 * 650.0));
  col = mix(col, skyColor(normalize(vec3(-V.x, 0.0, -V.z)), 0.0) * 0.96, fog);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const PARTICLE_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute vec3 aVel;
attribute float aStretch;
uniform float uScale;
uniform vec2 uHalfRes;
varying vec4 vColor;
varying vec3 vDir;   // direction écran (xy) et facteur d'étirement (z)
void main(){
  vColor = aColor;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vec4 c0 = projectionMatrix * mv;
  float base = aSize * uScale / max(-mv.z, 0.1);
  float stretch = 1.0;
  vec2 dir = vec2(0.0, 1.0);
  if (aStretch > 0.0) {
    // traînée : déplacement écran pendant un court temps de pose
    vec4 c1 = projectionMatrix * (mv + vec4(mat3(viewMatrix) * aVel * 0.035 * aStretch, 0.0));
    vec2 dpx = (c1.xy / c1.w - c0.xy / c0.w) * uHalfRes;
    float len = length(dpx);
    if (len > 0.5) { dir = dpx / len; stretch = 1.0 + min(len / max(base, 1.0), 4.0); }
  }
  vDir = vec3(dir, stretch);
  gl_PointSize = base * stretch;
  gl_Position = c0;
}`;

export const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec4 vColor;
varying vec3 vDir;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  c.y = -c.y;
  float along = dot(c, vDir.xy), perp = dot(c, vec2(-vDir.y, vDir.x));
  float r = 4.0 * (along * along + perp * perp * vDir.z * vDir.z);
  if (r > 1.0) discard;
  float shade = 1.0 - 0.35 * r + 0.25 * max(0.0, c.y - c.x);
  gl_FragColor = vec4(vColor.rgb * uLight * shade, vColor.a * (1.0 - r * r));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
