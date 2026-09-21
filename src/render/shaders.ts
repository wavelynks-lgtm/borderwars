export const globeVert = /* glsl */ `
varying vec3 vWorldPos;
varying float vLight;
varying float vRim;
uniform vec3 uLightDir;
void main() {
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vLight = 0.55 + 0.55 * max(dot(n, uLightDir), 0.0);
  vec3 viewDir = normalize(cameraPosition - wp.xyz);
  vRim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const globeFrag = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D uTerrain;   // baked terrain colour (RGB), A = static country border
uniform sampler2D uOwner;     // R,G = owner id lo/hi ; B = flags ; A = rail mask (1-15 real, 17-31 ghost)
uniform sampler2D uPatterns;
uniform sampler2D uPalette;   // 1024 x 1 owner colours
uniform sampler2D uMeta;      // R,G = country id lo/hi ; B = terrain type ; A = elevation
uniform vec2 uTexel;          // 1/W, 1/H
uniform float uHoverOwner;    // owner id being hovered (-1 none)
uniform float uHoverCountry;  // country id hovered (-1 none)
uniform float uTerrainView;   // 1 = terrain view (spacebar)
uniform float uBorderStrength;// country border intensity, scaled with zoom
uniform float uRegionBorderStrength;
uniform float uTime;
uniform float uSpawnMode;     // 1 during spawn phase
uniform float uLocalOwner;    // local player smallID (0 = none)
uniform float uLod;           // 0 close-up, 1 zoomed out (skip rails / polar merge)

varying vec3 vWorldPos;
varying float vLight;
varying float vRim;

#define PI 3.14159265359

bool bit(float flags, float b) {
  return mod(floor(flags / b), 2.0) >= 1.0;
}

vec2 globeUvRaw() {
  vec3 p = normalize(vWorldPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, -p.x);
  float u = lon / (2.0 * PI);
  if (u < 0.0) u += 1.0;
  float v = 0.5 - lat / PI;
  return vec2(u, clamp(v, uTexel.y * 0.25, 1.0 - uTexel.y * 0.25));
}

// One display cell spans one latitude row and a comparable surface distance
// around that row. Fewer columns toward both poles, with no zoom-mode switch.
vec2 displayUv(vec2 raw) {
  float H = 1.0 / uTexel.y;
  float row = clamp(floor(raw.y * H), 0.0, H - 1.0);
  float columns = max(1.0, floor(2.0 * H * sin(PI * (row + 0.5) / H) + 0.5));
  return vec2((floor(fract(raw.x) * columns) + 0.5) / columns, (row + 0.5) / H);
}

float ownerAt(vec2 uv) {
  vec2 rg = texture2D(uOwner, displayUv(uv)).rg;
  return floor(rg.r * 255.0 + 0.5) + 256.0 * floor(rg.g * 255.0 + 0.5);
}

void main() {
  vec2 raw = globeUvRaw();
  vec2 uv = displayUv(raw);
  float merge = max(1.0, 1.0 / max(0.001, sin(PI * uv.y)));
  vec4 terr = texture2D(uTerrain, uv);
  vec3 col = terr.rgb;
  vec4 meta = texture2D(uMeta, uv);
  float country = floor(meta.r * 255.0 + 0.5) + floor(meta.g * 255.0 + 0.5) * 256.0;
  float ttype = floor(meta.b * 255.0 + 0.5);
  bool isLand = ttype >= 1.0 && ttype <= 3.0;

  if (uTerrainView > 0.5 && isLand) {
    if (ttype == 1.0) col = vec3(0.36, 0.55, 0.30);
    else if (ttype == 2.0) col = vec3(0.62, 0.55, 0.36);
    else col = vec3(0.90, 0.90, 0.92);
    col *= 0.8 + 0.4 * meta.a;
  }

  float staticBorder = terr.a > 0.75 ? uBorderStrength : (terr.a > 0.25 ? uRegionBorderStrength : 0.0);
  col = mix(col, col * 0.35, staticBorder);

  if (uHoverCountry >= 0.0 && country == uHoverCountry && isLand) {
    col = mix(col, vec3(1.0, 0.95, 0.65), 0.28);
  }

  vec4 o = texture2D(uOwner, uv);
  float flagsMerged = floor(o.b * 255.0 + 0.5);
  bool fallout = bit(flagsMerged, 1.0);
  bool frontOut = bit(flagsMerged, 2.0);
  bool frontIn = bit(flagsMerged, 4.0);
  bool defended = bit(flagsMerged, 16.0);
  bool preview = bit(flagsMerged, 32.0);
  float checker = mod(floor(uv.x / uTexel.x / merge) + floor(uv.y / uTexel.y), 2.0);

  float owner = floor(o.r * 255.0 + 0.5) + floor(o.g * 255.0 + 0.5) * 256.0;
  float columns = max(1.0, floor(2.0 / uTexel.y * sin(PI * uv.y) + 0.5));
  vec2 east = vec2(1.0 / columns, 0.0);
  vec2 north = vec2(0.0, uTexel.y);
  bool border = owner > 0.5 && (ownerAt(uv + east) != owner || ownerAt(uv - east) != owner
    || ownerAt(uv + north) != owner || ownerAt(uv - north) != owner);
  // Tracks and placement previews use surface geometry at a constant width.
  if (owner > 0.5) {
    vec3 pc = texture2D(uPalette, vec2((owner + 0.5) / 1024.0, 0.5)).rgb;
    float alpha = uTerrainView > 0.5 ? 0.35 : 0.72;
    if (border) {
      if (defended) {
        col = checker > 0.5 ? mix(pc, vec3(1.0), 0.55) : pc * 0.35;
      } else {
        col = mix(col, pc * 0.55, 0.95);
      }
    } else {
      vec4 decor=texture2D(uPatterns,vec2((owner+0.5)/1024.0,0.5));
      float pattern=floor(decor.a*255.0+0.5);
      // Spherical coordinates keep motifs seam-free without stretched polar stripes.
      vec3 sphere=vec3(sin(PI*uv.y)*cos(2.0*PI*uv.x),cos(PI*uv.y),sin(PI*uv.y)*sin(2.0*PI*uv.x));
      vec3 cell=sphere*min(40.0,1.0/uTexel.x/32.0);
      float ink=0.0;
      if(pattern>0.5&&pattern<1.5)ink=step(.72,fract(cell.x+cell.y+cell.z));
      else if(pattern<2.5&&pattern>1.5)ink=1.0-step(.2,length(fract(cell)-.5));
      else if(pattern<3.5&&pattern>2.5)ink=mod(floor(cell.x)+floor(cell.y)+floor(cell.z),2.0);
      else if(pattern<4.5&&pattern>3.5)ink=step(.68,fract(cell.y+abs(fract(cell.x*.5)*2.0-1.0)+cell.z));
      else if(pattern>4.5)ink=max(step(.8,fract(cell.x+cell.y+cell.z)),step(.8,fract(cell.x-cell.y-cell.z)));
      // Fade subpixel motifs at distant zoom to avoid shimmer.
      float visible=1.0-smoothstep(.25,.8,length(fwidth(cell)));
      pc=mix(pc,decor.rgb,ink*.45*visible);
      col = mix(col, pc, alpha);
    }
    if (uHoverOwner >= 0.0 && owner == uHoverOwner) {
      col = mix(col, vec3(1.0), 0.18);
    }
  }
  col = col * vLight + vec3(0.25, 0.45, 0.9) * vRim * 0.35;

  if (fallout) {
    if (uLod > 0.5) col = mix(col, vec3(0.45, 0.42, 0.38), 0.75);
    else {
      float nFall = fract(sin(dot(vec2(floor(uv.x / uTexel.x / merge), floor(uv.y / uTexel.y)), vec2(12.9898, 78.233))) * 43758.5453);
      col = mix(col, vec3(0.45, 0.42, 0.38) * (0.7 + 0.6 * nFall), 0.85);
    }
  }
  if (uSpawnMode > 0.5 && preview) {
    vec3 pc = texture2D(uPalette, vec2((uLocalOwner + 0.5) / 1024.0, 0.5)).rgb;
    col = mix(col, pc, 0.72);
  } else if (preview && uSpawnMode < 0.5) {
    float pulse = uLod > 0.5 ? 0.7 : 0.6 + 0.4 * sin(uTime * 6.0);
    col = mix(col, checker > 0.5 ? vec3(1.0) : vec3(0.1, 0.9, 0.5), 0.8 * pulse);
  }
  if (frontOut || frontIn) {
    float pulse = uLod > 0.5 ? 0.85 : 0.7 + 0.3 * sin(uTime * 2.6);
    vec3 tint = frontIn ? vec3(0.92, 0.32, 0.28) : vec3(1.0, 0.94, 0.72);
    col = mix(col, tint, 0.28 * pulse);
  }

  if (uSpawnMode > 0.5 && isLand && owner < 0.5) {
    col += vec3(0.05, 0.08, 0.05) * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const atmosphereVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const atmosphereFrag = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uColor;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float f = dot(normalize(vNormal), viewDir);
  float glow = pow(max(0.0, 1.0 - abs(f) * 0.9), 4.0);
  gl_FragColor = vec4(uColor * glow, glow * 0.9);
}
`;
