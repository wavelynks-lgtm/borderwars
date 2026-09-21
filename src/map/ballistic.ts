import * as THREE from "three";
import { GLOBE_RADIUS, latLonToVec3, vec3ToLatLon } from "./geo";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _out = new THREE.Vector3();
const _tangent = new THREE.Vector3();

export const BALLISTIC_SAMPLES = 256;

/**
 * Round ICBM-style arc: great-circle ground track with a circular altitude hump.
 * `t` is 0 at launch and 1 at impact. `peak` is extra radius at apogee, in globe units.
 */
export function ballisticPoint(
  lat0: number,
  lon0: number,
  lat1: number,
  lon1: number,
  t: number,
  peak: number,
  out: THREE.Vector3,
  startAlt = 1.2,
  endAlt = 1.2,
): THREE.Vector3 {
  t = t <= 0 ? 0 : t >= 1 ? 1 : t;
  latLonToVec3(lat0, lon0, 1, _a);
  latLonToVec3(lat1, lon1, 1, _b);
  const dot = Math.min(1, Math.max(-1, _a.dot(_b)));
  const omega = Math.acos(dot);
  if (omega < 1e-5) {
    out.copy(_a);
  } else {
    _tangent.copy(_b).addScaledVector(_a, -dot);
    if (_tangent.lengthSq() < 1e-12) {
      _tangent.set(Math.abs(_a.y) < 0.9 ? 0 : 1, Math.abs(_a.y) < 0.9 ? 1 : 0, 0);
      _tangent.addScaledVector(_a, -_tangent.dot(_a));
    }
    _tangent.normalize();
    out.copy(_a).multiplyScalar(Math.cos(t * omega)).addScaledVector(_tangent, Math.sin(t * omega)).normalize();
  }
  // semicircle lift: vertical at launch/impact, round at apogee — never clips the globe
  const x = 2 * t - 1;
  const lift = Math.sqrt(Math.max(0, 1 - x * x));
  const alt = startAlt * (1 - t) + endAlt * t + peak * lift;
  return out.multiplyScalar(GLOBE_RADIUS + alt);
}

export function sampleBallisticArc(
  lat0: number,
  lon0: number,
  lat1: number,
  lon1: number,
  peak: number,
  into: Float32Array,
  startAlt = 1.2,
  endAlt = 1.2,
  tMax = 1,
): Float32Array {
  const n = (into.length / 3) | 0;
  for (let i = 0; i < n; i++) {
    ballisticPoint(lat0, lon0, lat1, lon1, n === 1 ? 0 : (i / (n - 1)) * tMax, peak, _out, startAlt, endAlt);
    into[i * 3] = _out.x;
    into[i * 3 + 1] = _out.y;
    into[i * 3 + 2] = _out.z;
  }
  return into;
}

export function worldToTileXY(p: THREE.Vector3, width: number, height: number): { fx: number; fy: number; alt: number } {
  const { lat, lon } = vec3ToLatLon(p);
  let fx = ((lon + 180) / 360) * width;
  if (fx < 0) fx += width;
  else if (fx >= width) fx -= width;
  const fy = Math.min(height - 0.001, Math.max(0, ((90 - lat) / 180) * height));
  return { fx, fy, alt: p.length() - GLOBE_RADIUS };
}
