import * as THREE from 'three';
import {mergeByMaterial} from './rover-model.js';
import {LANDING_SITE as site,meshHeightAt,smoothstep} from './terrain.js';

const bayEnd=4.5, floor=1.02, rampLength=3.62;
const openAngle=Math.PI/2+Math.asin((floor-.06)/rampLength);
export const departureDuration=7.4;

// In ship space +Z points out of the cargo bay. The ship faces west.
export function buildLander() {
  const root=new THREE.Group();
  root.name='Посадочный модуль Одиссея';
  root.position.set(site.x,meshHeightAt(site.x,site.z),site.z);
  root.rotation.y=Math.PI/2;
  const paint=(color,metalness=.24)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.71,flatShading:true,side:THREE.DoubleSide});
  const ivory=paint(0xbdb5a1),steel=paint(0x4e5557),shadow=paint(0x272e32),orange=paint(0xaf593b);
  const glass=new THREE.MeshStandardMaterial({color:0x233b44,emissive:0x102b33,metalness:.5,roughness:.28,side:THREE.DoubleSide});
  const lamp=new THREE.MeshBasicMaterial({color:0xffc58c});
  const shell=[],door=[];
  function part(geometry,material,x,y,z,rx=0,ry=0,rz=0,list=shell){
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1));
    list.push({geometry,material,matrix});
  }
  function box(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0,list=shell){
    part(new THREE.BoxGeometry(w,h,d),mat,x,y,z,rx,ry,rz,list);
  }
  function panel(points,mat){
    const vertices=[];
    for(let i=1;i<points.length-1;i++) vertices.push(...points[0],...points[i],...points[i+1]);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.computeVertexNormals();part(geo,mat,0,0,0);
  }
  // Chined fuselage with a tapered glazed nose and an open, framed stern.
  const sections=[[-6.4,1.12,1.65,2.23],[-4.2,2.04,1.05,3.75],[-2.4,2.28,.94,4.65],[2.8,2.36,.94,4.85],[bayEnd,2.17,.94,4.68]];
  const rings=sections.map(([z,w,low,high])=>[[-w*.76,low,z],[-w,low+.5,z],[-w,high-.74,z],[-w*.69,high,z],[w*.69,high,z],[w,high-.74,z],[w,low+.5,z],[w*.76,low,z]]);
  rings.slice(1).forEach((back,i)=>{
    for(let j=0;j<8;j++){
      const k=(j+1)%8;
      const mat=i===0 && j>=2 && j<=4?glass:j===7||j===0||j===6?shadow:i===3 && (j===1||j===5)?orange:ivory;
      panel([rings[i][j],rings[i][k],back[k],back[j]],mat);
    }
  });
  panel(rings[0],steel);panel(rings[2],shadow);
  box(3.65,.2,6.9,steel,0,floor-.1,1.03);
  box(3.7,.23,.28,steel,0,4.58,bayEnd);
  for(const sign of [-1,1]){
    box(.23,3.08,.28,steel,sign*1.94,2.53,bayEnd);
    box(.11,.14,4.75,lamp,sign*1.90,3.48,.85);
    // Landing nacelles, skid feet, radiator slots and marker lights.
    box(1.35,.35,3.7,steel,sign*2.77,2.3,.15,0,0,sign*.09);
    part(new THREE.CylinderGeometry(.95,.69,4.8,8),steel,sign*3.43,2.27,.05,Math.PI/2);
    part(new THREE.CylinderGeometry(.82,.95,.52,8),ivory,sign*3.43,2.27,-2.52,Math.PI/2);
    part(new THREE.CylinderGeometry(.67,.85,.52,8),shadow,sign*3.43,2.27,2.68,Math.PI/2);
    part(new THREE.TorusGeometry(.6,.08,4,10),orange,sign*3.43,2.27,2.96);
    for(const z of [-2.35,2.1]){
      box(.26,1.28,.44,steel,sign*2.55,.67,z,0,0,-sign*.28);
      box(1.08,.22,1.38,shadow,sign*2.72,.09,z);
    }
    for(let i=0;i<5;i++) box(.14,.55,.14,shadow,sign*2.325,2.97,-1.85+i*.37,-.2);
    box(.12,.16,.56,lamp,sign*2.19,2.85,3.82);
    box(.16,.16,2.9,orange,sign*2.34,1.72,.85);
  }
  box(1.46,.16,1.95,steel,0,4.81,.35);
  box(.63,.13,.86,ivory,0,4.95,.23);
  const hinge=new THREE.Group();hinge.position.set(0,floor,bayEnd);
  box(3.68,rampLength,.13,steel,0,rampLength/2,0,0,0,0,door);
  for(const sign of [-1,1]){
    box(.17,rampLength,.20,orange,sign*1.66,rampLength/2,0,0,0,0,door);
    box(.78,rampLength-.18,.05,shadow,sign*.91,rampLength/2,-.088,0,0,0,door);
  }
  for(let i=0;i<10;i++)box(3.18,.058,.05,steel,0,.2+i*.34,-.119,0,0,0,door);
  for(const [parts,parent] of [[shell,root],[door,hinge]]){
    for(const mesh of mergeByMaterial(parts)){
      mesh.receiveShadow=mesh.castShadow=mesh.frustumCulled=true;parent.add(mesh);
    }
    parts.forEach(p=>p.geometry.dispose());
  }
  // A landing floodlight picks out the hull and the ramp in the pre-dawn shot.
  const floodlight=new THREE.PointLight(0xffdbad,145,24,2);
  floodlight.position.set(-5.7,7.2,7.4);
  floodlight.visible=false;
  root.add(hinge,floodlight);
  return {root,hinge,floodlight};
}

export function animateDeparture(ship,rover,camera,time,delta) {
  ship.floodlight.visible=time<departureDuration;
  ship.floodlight.intensity=145*(1-smoothstep(5.8,departureDuration,time));
  const opening=smoothstep(.15,1.9,time)*(1-smoothstep(5.65,7.35,time));
  ship.hinge.rotation.x=openAngle*opening;
  const distance=14.7*smoothstep(1.72,6.85,time), dx=distance+.3;
  const turn=Math.max(0,(dx-9)/6);
  const x=site.x+dx,z=site.z-4*turn*turn;
  const deckDrop=Math.max(0,dx-bayEnd)*Math.tan(openAngle-Math.PI/2);
  const deck=ship.root.position.y+floor+.09-deckDrop;
  const y=Math.max(meshHeightAt(x,z)+.06,deck);
  const previous=rover.pos.clone();
  rover.pos.set(x,y,z);
  rover.heading.set(1,0,-8*turn/6).normalize();
  const rampSlope=dx>bayEnd && deck>meshHeightAt(x,z)+.06?Math.tan(openAngle-Math.PI/2):0;
  rover.up.set(rampSlope,1,0).normalize();
  if(delta>0)rover.wheelSpin+=previous.distanceTo(rover.pos)/rover.wheelRadius;
  rover.applyVisual(0,time);
  const mix=smoothstep(3.4,7.4,time);
  const chase=new THREE.Vector3(x,y+5.1,z).addScaledVector(rover.heading,-15);
  camera.position.set(site.x+15+time*.32,ship.root.position.y+6.2,site.z+10.4).lerp(chase,mix);
  camera.position.y=Math.max(camera.position.y,meshHeightAt(camera.position.x,camera.position.z)+2.8);
  const target=new THREE.Vector3(site.x+1,ship.root.position.y+2.15,site.z);
  target.lerp(new THREE.Vector3(x,y+1.4,z),smoothstep(1.4,5.8,time));camera.lookAt(target);
}
