import * as THREE from 'three';
import type { Unit } from '../core/Unit';

/** One draw call for distant buildings, merging same-owner markers in 8px cells. */
export class StructureOverview {
  readonly geometry = new THREE.BufferGeometry();
  readonly points = new THREE.Points(this.geometry, new THREE.PointsMaterial({size:5,sizeAttenuation:false,vertexColors:true,depthTest:false,depthWrite:false}));
  private capacity=0;
  private occupied=new Set<string>();
  private projected=new THREE.Vector3();
  private color=new THREE.Color();
  constructor(group:THREE.Group) {
    this.points.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float markerRadius = length(gl_PointCoord - vec2(0.5));
        if (markerRadius > 0.5) discard;
        if (markerRadius > 0.32) diffuseColor.rgb *= 0.25;
      `);
    };
    this.points.frustumCulled=false;
    this.points.renderOrder=12;
    group.add(this.points);
  }
  update(units:ReadonlyMap<Unit,THREE.Mesh>, camera:THREE.PerspectiveCamera, width:number, height:number, pixelsPerWorld:number):void {
    if(units.size>this.capacity){
      this.capacity=Math.max(64,2**Math.ceil(Math.log2(units.size)));
      this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.capacity*3),3).setUsage(THREE.DynamicDrawUsage));
      this.geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(this.capacity*3),3).setUsage(THREE.DynamicDrawUsage));
    }
    this.occupied.clear();let count=0;
    const positions=this.geometry.getAttribute('position'),colors=this.geometry.getAttribute('color');
    for(const [u,mesh] of units){
      if(!u.active || !u.isStructure() || !mesh.visible || mesh.scale.y*pixelsPerWorld>=18)continue;
      mesh.visible=false;
      this.projected.copy(mesh.position).project(camera);
      if(Math.abs(this.projected.x)>1 || Math.abs(this.projected.y)>1 || this.projected.z>1)continue;
      const key=`${u.owner.smallID}:${Math.floor((this.projected.x+1)*width/16)}:${Math.floor((this.projected.y+1)*height/16)}`;
      if(this.occupied.has(key))continue;
      this.occupied.add(key);
      positions.setXYZ(count,mesh.position.x,mesh.position.y,mesh.position.z);
      this.color.set(u.constructing?'#bdbdbd':u.owner.color);
      colors.setXYZ(count,this.color.r,this.color.g,this.color.b);count++;
    }
    this.geometry.setDrawRange(0,count);this.points.visible=count>0;
    if(count){positions.needsUpdate=true;colors.needsUpdate=true;}
  }
}
