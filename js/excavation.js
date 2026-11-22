// Adjacent cuts under plate B expose opposite ends of the same load.
export const sectors = [
  {id:'outer',name:'Внешняя насыпь',x:118,y:180},
  {id:'c1',name:'Центральный 1',after:'outer',plate:'А',x:238,y:128},
  {id:'c2',name:'Центральный 2',after:'c1',plate:'Б',x:365,y:91},
  {id:'s1',name:'Боковой 1',after:'outer',x:236,y:239},
  {id:'s2',name:'Боковой 2',after:'s1',plate:'Б',x:372,y:207},
  {id:'s3',name:'Боковой 3',after:'s2',x:482,y:160},
];
export function restoreExcavation(raw={}) {
  const valid=items=>Array.isArray(items)?sectors.filter(s=>items.includes(s.id)).map(s=>s.id):[];
  return {recorded:raw?.recorded===true,clear:valid(raw?.clear),braces:valid(raw?.braces).slice(0,2),falls:valid(raw?.falls).filter(id=>sectors.find(s=>s.id===id).plate)};
}
export function cutStatus(p,id) {
  const s=sectors.find(s=>s.id===id);
  const available=!s.after || p.clear.includes(s.after);
  const cleared=p.clear.includes(id),fallen=p.falls.includes(id);
  const same=sectors.filter(n=>s.plate && n.plate===s.plate);
  const collapsed=same.some(n=>p.falls.includes(n.id));
  const supported=same.some(n=>p.braces.includes(n.id));
  return {available,cleared,fallen,braced:p.braces.includes(id),supported,
    load:!!s.plate && !collapsed,locked:supported && same.some(n=>p.clear.includes(n.id))};
}
export const nicheOpen=p=>p.clear.includes('c2') || p.clear.includes('s3');
export function workCut(p,id,action) {
  const s=cutStatus(p,id);
  if(!s.available) return 'Сначала расчистите предыдущий участок.';
  if(action==='remove') {
    if(!s.braced) return 'Здесь нет подпорки.';
    if(s.locked) return 'Подпорка держит вес плиты. Снять её опасно.';
    p.braces=p.braces.filter(x=>x!==id); return 'Свободная подпорка возвращена.';
  }
  if(s.cleared) return 'Участок уже расчищен.';
  if(action==='brace') {
    if(!s.load || s.supported || s.fallen) return 'Здесь дополнительная подпорка не нужна.';
    if(p.braces.length>=2) return 'Обе подпорки установлены.';
    p.braces.push(id); return 'Подпорка установлена под плитой.';
  }
  if(action==='debris' && !s.fallen) return 'Обломков здесь нет.';
  if(action==='clear' && s.fallen) return 'Сначала разберите обломки.';
  if(action!=='clear' && action!=='debris') return '';
  if(action==='clear' && s.load && !s.supported) {
    p.falls.push(id);return 'Плита осела. Разберите обломки, чтобы продолжить.';
  }
  p.clear.push(id);
  return nicheOpen(p)?'Ниша открыта. Можно извлечь фазовый ключ.':'Проход расчищен.';
}
export function templeReport(p) {
  if(!p.clear.length && !p.falls.length) return '';
  return p.falls.length ? 'Раскоп храма. Повреждено плит: '+p.falls.length+'. Следы обвала зафиксированы.' : 'Раскоп храма. Несущие плиты сохранились без повреждений.';
}
