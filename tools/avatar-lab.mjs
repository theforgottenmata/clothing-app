/**
 * Zkušební dílna avatara – ladění promptů bez aplikace (prompty v server/prompts.mjs).
 *
 *   node --env-file=.env tools/avatar-lab.mjs body --gender female --size L --skin tan
 *   node --env-file=.env tools/avatar-lab.mjs head --base tmp/avatar-lab/body-female-L-tan.png --hair "short curly" --hairColor auburn --eyes green
 *
 * Výstupy jsou v tmp/avatar-lab/. Každé volání stojí peníze – v konzoli se vypíše spotřeba a odhad ceny.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { changeHead, createBody, defaultAvatar } from '../server/avatar.mjs';

const OUT = 'tmp/avatar-lab';
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    gender: { type: 'string', default: 'male' }, size: { type: 'string', default: 'M' }, skin: { type: 'string', default: 'medium' },
    base: { type: 'string' }, hair: { type: 'string' }, hairColor: { type: 'string' },
    eyes: { type: 'string' }, beard: { type: 'string' }, glasses: { type: 'string' },
    quality: { type: 'string' },
  },
});
mkdirSync(OUT, { recursive: true });

if (positionals[0] === 'body') {
  const { opaque, transparent } = await createBody(values, { quality: values.quality });
  save(`body-${values.gender}-${values.size}-${values.skin}`, opaque, transparent);
} else if (positionals[0] === 'head') {
  const base = values.base ? readFileSync(values.base) : await defaultAvatar();
  const { opaque, transparent } = await changeHead(base, values, { quality: values.quality });
  const name = ['head', values.hair, values.hairColor, values.eyes, values.beard, values.glasses].filter(Boolean).join('-').replace(/\s+/g, '_');
  save(name, opaque, transparent);
} else {
  console.log('Použití: avatar-lab.mjs body|head [volby] – viz komentář v souboru.');
  process.exit(1);
}

function save(name, opaque, transparent) {
  writeFileSync(`${OUT}/${name}.png`, opaque);
  writeFileSync(`${OUT}/${name}-transparent.png`, transparent);
  console.log(`  uloženo ${OUT}/${name}.png (+ -transparent.png)`);
}
