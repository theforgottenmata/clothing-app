/**
 * Test oblékání na ostatních postavách: stejné kusy (výřezy z dílny) na víc těl, výsledek jako přehledový obrázek.
 *
 *   node --env-file=.env tools/body-check.mjs                       # jen plán a odhad ceny, nic neplatí
 *   node --env-file=.env tools/body-check.mjs --run                 # provede
 *   node --env-file=.env tools/body-check.mjs --items green-jacket:outerwear,black-jean:bottom:long,boty:shoes \
 *        --bodies female-M,male-S,male-L,male-XL,female-S,female-L,female-XL --run
 *
 * Kus = výřez z dílny (tmp/garment-lab/<název>-1-vyrez.png) + kategorie (+ délka u spodků).
 * Volá stejné dressFor jako aplikace, takže výstupy AI jdou do server/.cache/dress – co už jednou proběhlo, je zdarma.
 * Výstup: tmp/body-check/<kus>-<tělo>.png a tmp/body-check/prehled.png (řádky = kusy, sloupce = těla).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { czk } from '../server/avatar.mjs';
import { dressFor } from '../server/garment.mjs';

const LAB = 'tmp/garment-lab';
const OUT = 'tmp/body-check';
const AV = 'design-assets/avatars';
const EST_USD = 0.065; // jedno kreslení ve střední kvalitě

const { values } = parseArgs({
  options: {
    items: { type: 'string', default: 'green-jacket:outerwear,black-jean:bottom:long,boty:shoes' },
    bodies: { type: 'string', default: 'female-M,male-S,male-L,male-XL' },
    run: { type: 'boolean', default: false },
  },
});

const items = values.items.split(',').map((s) => {
  const [name, category, length] = s.split(':');
  return { name, category, bottomLength: length === 'short' ? 'short' : 'long', file: `${LAB}/${name}-1-vyrez.png` };
});
const bodies = values.bodies.split(',').map((b) => (b.split('-').length === 2 ? `${b}-medium` : b));

// Kusy bez výřezu z dílny se přeskočí (nabídne se, co v dílně je).
const missing = items.filter((i) => !existsSync(i.file));
if (missing.length) {
  const available = existsSync(LAB) ? readdirSync(LAB).filter((f) => f.endsWith('-1-vyrez.png')).map((f) => f.replace('-1-vyrez.png', '')) : [];
  console.log(`Přeskakuji (chybí výřez v ${LAB}): ${missing.map((m) => m.name).join(', ')}`);
  console.log(`K dispozici: ${available.join(', ') || 'nic – nejdřív kus projeď dílnou (tools/garment-lab.mjs)'}`);
  items.splice(0, items.length, ...items.filter((i) => existsSync(i.file)));
  if (!items.length) process.exit(1);
}
const calls = items.length * bodies.length;
console.log(`${items.length} kusů × ${bodies.length} těl = ${calls} kreslení, nejvýš cca $${(calls * EST_USD).toFixed(2)} (${(calls * EST_USD * czk()).toFixed(0)} Kč); co už je v cache, je zdarma.`);
if (!values.run) {
  console.log('Spusť s --run.');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const CELL_W = 344;
const CELL_H = 512;
const cells = [];
let total = 0;
for (const [r, item] of items.entries()) {
  for (const [c, body] of bodies.entries()) {
    const started = Date.now();
    process.stdout.write(`▶ ${item.name} na ${body}… `);
    try {
      const res = await dressFor({
        garment: readFileSync(item.file),
        hint: { category: item.category, bottomLength: item.bottomLength, reach: null, name: null, subtype: null },
        bodyId: body,
      });
      total += res.usd;
      const [g] = body.split('-');
      const face = `${AV}/face-${g}-default.webp`;
      const layers = [];
      if (res.erase) layers.push({ input: res.erase, blend: 'dest-out' });
      const torso = await sharp(readFileSync(`${AV}/${body}-transparent.webp`)).composite(layers).png().toBuffer();
      const stack = [{ input: torso }];
      if (existsSync(face)) stack.push({ input: readFileSync(face) });
      if (res.layer) stack.push({ input: res.layer });
      const png = await sharp({ create: { width: 688, height: 1024, channels: 4, background: '#eef0f3' } }).composite(stack).png().toBuffer();
      writeFileSync(`${OUT}/${item.name}-${body}.png`, png);
      cells.push({ input: await sharp(png).resize(CELL_W, CELL_H).png().toBuffer(), left: c * CELL_W, top: r * CELL_H });
      console.log(`${((Date.now() - started) / 1000).toFixed(0)} s${res.usd ? `, $${res.usd.toFixed(3)}` : ' (cache)'}${res.warning ? ` ⚠ ${res.warning}` : ''}`);
    } catch (error) {
      console.log(`chyba: ${error.message}`);
    }
  }
}
await sharp({ create: { width: CELL_W * bodies.length, height: CELL_H * items.length, channels: 3, background: '#ffffff' } })
  .composite(cells)
  .png()
  .toFile(`${OUT}/prehled.png`);
console.log(`\nHotovo, cca $${total.toFixed(2)} (${(total * czk()).toFixed(1)} Kč). Přehled: ${OUT}/prehled.png (sloupce: ${bodies.join(', ')})`);
