import {sectors,cutStatus,nicheOpen,workCut} from './excavation.js';

const el=id=>document.getElementById(id);
export function showDigPanel(progress,onChange,onExtract,onExit) {
  let selected=sectors.find(s=>cutStatus(progress,s.id).available && !progress.clear.includes(s.id))?.id || 'outer';
  const canvas=el('cutMap'), ctx=canvas.getContext('2d');
  const slots=el('cutSlots');
  slots.replaceChildren();
  function polygon(points,fill,stroke) {
    ctx.beginPath();
    points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.closePath(); ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}
  }
  function line(points,color,width=2) {
    ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  }
  function terrain() {
    ctx.clearRect(0,0,600,330);
    const light=ctx.createLinearGradient(0,0,600,330);
    light.addColorStop(0,'#23363c');light.addColorStop(1,'#101b22');
    ctx.fillStyle=light;ctx.fillRect(0,0,600,330);
    for(let i=-300;i<800;i+=27) line([[i,0],[i+410,330]],'#263a40',.8);
    polygon([[26,174],[355,36],[569,112],[254,281]],'#92806a');
    polygon([[26,174],[254,281],[254,311],[26,202]],'#645242');
    polygon([[254,281],[569,112],[569,145],[254,311]],'#483c36');
    for(const dy of [8,18])line([[28,174+dy],[254,281+dy],[568,113+dy]],'#a28a70',1.4);
    for(const s of sectors) {
      if(!s.after)continue;
      const parent=sectors.find(n=>n.id===s.after);
      line([[parent.x,parent.y],[s.x,s.y]],progress.clear.includes(s.after)?'#a6d3bd':'#574e44',3);
    }
    // Cross-section of the buried niche: lintel and split jambs at the far edge.
    polygon([[448,81],[448,56],[460,49],[461,79]],'#c6bba2','#847861');
    polygon([[492,88],[494,60],[505,55],[506,83]],'#948975','#685e50');
    polygon([[442,55],[458,44],[512,52],[499,64]],'#d5c8ac','#897d6b');
    polygon([[442,55],[499,64],[499,70],[442,61]],'#99856e');
    for(const s of [...sectors].sort((a,b)=>a.y-b.y)) {
      const st=cutStatus(progress,s.id),x=s.x,y=s.y;
      const dy=st.cleared?8:0;
      const top=[[x-56,y+dy],[x-6,y-24+dy],[x+55,y-3+dy],[x+4,y+24+dy]];
      polygon([[x-56,y],[x+4,y+24],[x+4,y+41],[x-56,y+16]],st.cleared?'#443b34':'#705e4b');
      polygon([[x+4,y+24],[x+55,y-3],[x+55,y+14],[x+4,y+41]],'#56493f');
      polygon(top,st.cleared?'#4b514b':st.available?'#b19a79':'#8d8271',s.id===selected?'#bdfff1':'#c1a788');
      if(!st.cleared){
        const stones=[[-33,2,8],[-19,8,5],[1,8,8],[27,-1,6],[10,-11,5],[-12,-9,6]];
        for(const [dx,offset,size] of stones){
          const px=x+dx,py=y+offset;
          polygon([[px-size,py+1],[px-size*.3,py-size*.65],[px+size*.7,py-size*.35],[px+size,py+2],[px,py+size*.48]],'#88735b');
          polygon([[px-size,py+1],[px-size*.3,py-size*.65],[px+size*.7,py-size*.35],[px,py+1]],'#c4a986');
        }
      }
      if(s.plate && !st.cleared) {
        const drop=st.fallen?12:0;
        polygon([[x-38,y-9+drop],[x-3,y-26+drop],[x+31,y-14+drop],[x-6,y+3+drop]],'#cfbe9e','#eee1c8');
        line([[x-15,y-17+drop],[x-7,y-13+drop],[x-12,y-9+drop],[x-3,y-7+drop]],'#55473b',2);
        if(st.load && !st.supported){
          line([[x+30,y-34],[x+30,y-17],[x+25,y-22]],'#ffbb73',2.5);
          line([[x+30,y-17],[x+35,y-22]],'#ffbb73',2.5);
        }
      }
      if(st.fallen && !st.cleared) for(const dx of [-24,2,21])polygon([[x+dx-8,y+9],[x+dx,y],[x+dx+7,y+5],[x+dx+5,y+12]],'#5f564c');
      if(s.plate){                                  // какая плита давит на участок
        ctx.textAlign='center';
        ctx.font='700 14px system-ui,sans-serif';
        ctx.fillStyle=st.fallen?'#ff9b8a':st.supported?'#a7ffda':'#ffbb73';
        ctx.fillText(s.plate,x,y-46);
      }
      if(st.braced) for(const dx of [-20,15])line([[x+dx,y+11],[x+dx,y-5]],'#a7ffda',5);
    }
    const opened=nicheOpen(progress);
    polygon([[449,90],[481,76],[515,85],[483,103]],opened?'#182d34':'#716c61','#a99477');
    if(opened){
      polygon([[478,78],[486,64],[493,77],[485,88]],'#8de2d8','#e8fff4');
      line([[486,65],[485,86]],'#538c96');
    }
    const target=sectors.find(s=>s.id===selected);
    const joints=[[30,92],[57,56],[target.x-36,target.y-57],[target.x-7,target.y-23]];
    line(joints,'#273238',12);line(joints,'#c8ad79',5);
    line([[target.x-13,target.y-26],[target.x-13,target.y-18],[target.x-8,target.y-15]],'#d4c6a3',2.5);
    line([[target.x-4,target.y-24],[target.x-2,target.y-18],[target.x-6,target.y-15]],'#d4c6a3',2.5);
    for(const [x,y] of joints.slice(0,-1)){ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle='#567070';ctx.fill();}
  }
  function render(note='') {
    const site=sectors.find(s=>s.id===selected),st=cutStatus(progress,selected);
    terrain();
    for(const button of slots.children) {
      const id=button.dataset.cut, status=cutStatus(progress,id);
      button.setAttribute('aria-pressed',String(id===selected));
      button.disabled=!status.available;
      button.title=sectors.find(s=>s.id===id).name;
    }
    el('cutName').textContent=site.name;
    const samePlate=sectors.filter(n=>n.plate&&n.plate===site.plate).length;
    el('cutLoad').textContent=st.cleared?'Грунт снят':st.fallen?'Обвал · плита перекрыла проход':st.supported?'Плита '+site.plate+' удерживается подпоркой'+(samePlate>1?' — одна держит оба участка':''):st.load?'Вес плиты '+site.plate+' приходится на грунт':'Безопасный грунт';
    el('cutHint').textContent=note || (st.fallen?'Разберите обломки. Ключ уцелел.':st.load && !st.supported?'Трещина над участком. Поставьте подпорку перед расчисткой.':st.cleared?'Выберите следующий участок.':'Манипулятор готов к расчистке.');
    el('cutStock').textContent='Свободные подпорки · '+(2-progress.braces.length)+' / 2';
    const rules=el('cutRules');
    if(rules) rules.textContent=progress.clear.length
      ? 'Дальше — тот же порядок: под плитой сначала подпорка, потом расчистка.'
      : 'Ниша откроется, когда расчищен Ц2 или Б3. Под плитой сначала поставьте подпорку — без неё плита осядет. Подпорок две на весь раскоп.';
    el('cutClear').disabled=st.cleared || st.fallen;
    el('cutBrace').disabled=st.cleared || !st.load || st.supported || st.fallen || progress.braces.length>=2;
    el('cutRemove').disabled=!st.braced;
    el('cutDebris').disabled=st.cleared || !st.fallen;
    el('cutExtract').hidden=!nicheOpen(progress);
  }
  for(const [i,s] of sectors.entries()){
    const b=document.createElement('button');
    b.type='button';b.dataset.cut=s.id;b.textContent=['Вход','Ц1','Ц2','Б1','Б2','Б3'][i];
    b.style.left=s.x/6+'%';b.style.top=(s.y+12)/3.3+'%';b.setAttribute('aria-label',s.name);
    b.onclick=()=>{selected=s.id;render();};slots.append(b);
  }
  for(const [id,action] of Object.entries({cutClear:'clear',cutBrace:'brace',cutRemove:'remove',cutDebris:'debris'})){
    el(id).onclick=()=>{const note=workCut(progress,selected,action);onChange();render(note);};
  }
  el('cutExtract').onclick=()=>{if(nicheOpen(progress))onExtract();};
  el('cutExit').onclick=onExit;
  render();
}
