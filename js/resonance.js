const interference = [[0,.35],[.20,0],[-.10,-.20],[-.10,-.15]];
export function newResonance() {
  return {freq:1.2,phase:0,targetFreq:2.65,targetPhase:1.35,hold:0,aligned:false,unlocked:false,
    progress:0,heat:0,locked:0,idle:0,time:0,started:false,warning:false};
}
export function stepResonance(s,dt,transmit) {
  if (s.progress >= 100) return;
  if (s.started) {
    s.time += dt;
    const cycle = Math.floor(s.time / 16);
    const since = s.time % 16;
    const delta = interference[(cycle+3)%4];
    const blend = cycle ? Math.min(1,since/1.2) : 0;
    const previous = cycle ? (cycle-1)%4 : 0;
    s.targetFreq=2.65; s.targetPhase=1.35;
    for(let i=0;i<previous;i++) {
      s.targetFreq+=interference[i][0]; s.targetPhase+=interference[i][1];
    }
    s.targetFreq+=delta[0]*blend; s.targetPhase+=delta[1]*blend;
    s.warning=since>=13;
  }
  const phaseError=s.phase-s.targetPhase;
  const near=Math.abs(s.freq-s.targetFreq)<=.085001 &&
    Math.abs(Math.atan2(Math.sin(phaseError),Math.cos(phaseError)))<=.145001;
  if(!s.unlocked) {
    s.hold=near?Math.min(2,s.hold+dt):0;
    s.unlocked=s.hold>=2;
  }
  s.aligned=s.unlocked && near;
  if(!s.unlocked) return;
  if (s.locked>0) {
    s.locked=Math.max(0,s.locked-dt);
    if (!s.locked) s.heat=30;
    return;
  }
  if (transmit) {
    s.started=true; s.idle=0;
    if(s.aligned) { s.progress=Math.min(100,s.progress+3*dt); s.heat=Math.max(0,s.heat-5*dt); }
    else s.heat=Math.min(100,s.heat+12*dt);
    if(s.heat>=100) { s.locked=3; s.progress=Math.max(0,s.progress-3); }
  } else {
    const grace=Math.max(0,7-s.idle);
    s.idle+=dt; s.progress=Math.max(0,s.progress-.25*Math.max(0,dt-grace));
    s.heat=Math.max(0,s.heat-15*dt);
  }
}
