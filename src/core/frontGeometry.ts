/** Four-connected fast marching; combines perpendicular edges without corner jumps. */
export function frontArrival(horizontal: number, vertical: number, dx: number, dy: number): number {
  const edge = Math.min(horizontal + dx, vertical + dy);
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return edge;
  const origin = Math.min(horizontal, vertical), a = horizontal-origin, b = vertical-origin;
  const ix = 1/(dx*dx), iy = 1/(dy*dy), A = ix+iy, B = -2*(a*ix+b*iy), C = a*a*ix+b*b*iy-1;
  const discriminant = B*B-4*A*C;
  if (discriminant < 0) return edge;
  const result = origin+(-B+Math.sqrt(discriminant))/(2*A);
  return result >= Math.max(horizontal,vertical) ? Math.min(edge,result) : edge;
}

function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, z: number, seed: number): number {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const smooth=(v:number)=>v*v*(3-2*v);
  const fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz);
  let value=0;
  for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++)
    value+=hash(ix+a,iy+b,iz+c,seed)*(a?fx:1-fx)*(b?fy:1-fy)*(c?fz:1-fz);
  return value;
}

/** Coherent resistance on the sphere: continuous across the date line and poles.
 * Patches make favorable flanks persist over several pixels instead of averaging
 * independent pixel jitter into a perfect ring. Scales are reference-map pixels.
 */
export function frontResistance(x: number, y: number, width: number, height: number, seed: number): number {
  const longitude=(x+.5)/width*Math.PI*2, latitude=(y+.5)/height*Math.PI;
  const r=2048/(2*Math.PI), ring=Math.sin(latitude)*r;
  const px=Math.cos(longitude)*ring,py=Math.cos(latitude)*r,pz=Math.sin(longitude)*ring;
  const broad=noise(px/22,py/22,pz/22,seed);
  const local=noise(px/6,py/6,pz/6,seed^0x74b3a125);
  return Math.exp((broad-.5)*4.8+(local-.5)*1.5);
}

/** Invasions prioritize real terrain and local support over cosmetic irregularity.
 * Several friendly neighbors make pockets easier to finish; forts resist advance.
 * These priorities do not change casualty costs or grant extra capture speed.
 */
export function invasionResistance(terrain: number, support: number, variation: number, defended: boolean): number {
  const local = Math.max(0.15, 1 + terrain * 0.5 - support * 0.5);
  const jitter = Math.max(0.45, Math.min(2.2, Math.pow(variation, 0.7)));
  return local * jitter * (defended ? 2 : 1);
}
