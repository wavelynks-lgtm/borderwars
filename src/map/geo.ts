import * as THREE from "three";

export const GLOBE_RADIUS = 100;

/**
 * Lat/lon → point on sphere. Must match three.js SphereGeometry UV layout:
 * u = (lon+180)/360, v = 1 - (90-lat)/180.
 */
export function latLonToVec3(lat: number, lon: number, radius = GLOBE_RADIUS, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = ((lon + 180) / 180) * Math.PI; // 0..2π
  const theta = ((90 - lat) / 180) * Math.PI; // 0..π
  const st = Math.sin(theta);
  out.set(-radius * Math.cos(phi) * st, radius * Math.cos(theta), radius * Math.sin(phi) * st);
  return out;
}

export function vec3ToLatLon(p: THREE.Vector3): { lat: number; lon: number } {
  const r = p.length();
  const theta = Math.acos(Math.max(-1, Math.min(1, p.y / r)));
  let phi = Math.atan2(p.z, -p.x); // 0..2π
  if (phi < 0) phi += Math.PI * 2;
  return { lat: 90 - (theta / Math.PI) * 180, lon: (phi / Math.PI) * 180 - 180 };
}

export function latLonToUV(lat: number, lon: number): { u: number; v: number } {
  return { u: (lon + 180) / 360, v: 1 - (90 - lat) / 180 };
}
