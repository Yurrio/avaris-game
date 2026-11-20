/* Проверка планировки мира без браузера: node tools/check-world.mjs */
import {
  planWorld, angleDeg, biomeAt, slopeAt, radiusAt, BIOMES, elevationAt,
} from '../js/terrain.js';

const plan = planWorld();

const ok = (b) => (b ? 'OK ' : 'ПЛОХО');
const biomeCount = {};
for (let i = 0; i < 4000; i++) {
  const u = (i * 0.6180339887) % 2 - 1;
  const th = i * 2.399963;
  const s = Math.sqrt(1 - u * u);
  const id = biomeAt(s * Math.cos(th), u, s * Math.sin(th)).id;
  biomeCount[id] = (biomeCount[id] || 0) + 1;
}
console.log('=== ПОКРЫТИЕ БИОМАМИ (4000 точек) ===');
for (const [id, n] of Object.entries(biomeCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(7)} ${String(n).padStart(4)}  ${(n / 40).toFixed(1)}%  ${BIOMES[id].name}`);
}

console.log('\n=== МАЯКИ ===');
plan.beacons.forEach((b, i) => {
  const [x, y, z] = b.dir;
  console.log(
    `  ${i + 1}. ${b.biome.padEnd(6)} r=${radiusAt(x, y, z).toFixed(1).padStart(6)}` +
    ` slope=${slopeAt(x, y, z).toFixed(2).padStart(5)}` +
    ` dir=[${b.dir.map((v) => v.toFixed(2)).join(', ')}]`
  );
});
let worst = 999;
for (let i = 0; i < plan.beacons.length; i++) {
  for (let j = i + 1; j < plan.beacons.length; j++) {
    worst = Math.min(worst, angleDeg(plan.beacons[i].dir, plan.beacons[j].dir));
  }
}
console.log(`  всего маяков: ${plan.beacons.length} ${ok(plan.beacons.length === 5)}` +
            `, минимальный угол между ними: ${worst.toFixed(1)}° ${ok(worst > 45)}`);
console.log(`  биомы маяков: ${plan.beacons.map((b) => b.biome).join(', ')}` +
            `  ${ok(new Set(plan.beacons.map((b) => b.biome)).size >= 4)}`);

console.log('\n=== ОСКОЛКИ ===');
const badShards = plan.shards.filter((s) => slopeAt(...s.dir) > 0.6 || elevationAt(...s.dir) < -0.1);
console.log(`  всего: ${plan.shards.length} ${ok(plan.shards.length >= 16)},` +
            ` проблемных (крутой склон/впадина): ${badShards.length} ${ok(!badShards.length)}`);

console.log('\n=== АНОМАЛИИ / РУИНЫ / АРХИВ ===');
console.log(`  аномалии: ${plan.anomalies.length} ${ok(plan.anomalies.length === 9)}`);
console.log(`  руины:    ${plan.ruins.length} ${ok(plan.ruins.length >= 12)}`);
console.log(`  архив:    ${plan.vault.biome.padEnd(6)}` +
            ` slope=${slopeAt(...plan.vault.dir).toFixed(2)}` +
            ` удалён от маяков на ${Math.min(...plan.beacons.map((b) => angleDeg(b.dir, plan.vault.dir))).toFixed(0)}°`);

console.log('\n=== ДИСТАНЦИИ ДО БЛИЖАЙШЕГО МАЯКА (углы) ===');
const nearest = plan.shards.map((s) => Math.min(...plan.beacons.map((b) => angleDeg(b.dir, s.dir))));
console.log(`  мин ${Math.min(...nearest).toFixed(0)}°, сред ${(nearest.reduce((a, b) => a + b, 0) / nearest.length).toFixed(0)}°, макс ${Math.max(...nearest).toFixed(0)}°`);
console.log('\nПлан готов.');
