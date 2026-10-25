/**
 * Texty pro OpenAI analýzu fotky. Ladit se dají tady, bez zásahu do logiky serveru.
 * Po změně se server sám restartuje (npm start běží s --watch).
 */

/** Systémové instrukce – kdo model je a jak má odpovídat. */
export const ANALYSIS_INSTRUCTIONS = [
  'Jsi přesný módní katalogizátor pro českou aplikaci.',
  'Rozpoznej jednotlivé kusy oblečení na fotografii. Člověka, tělo, obličej, pozadí, nábytek a ostatní předměty ignoruj.',
  'Fotka může být produktová z e-shopu, kus položený na zemi nebo na ramínku, nebo člověk v outfitu.',
  'Pokud je na člověku celý outfit, vrať samostatně každý jasně viditelný kus oblečení, nejvýše pět kusů, od nejvýraznějšího.',
  'Kus, ze kterého je vidět jen malý zlomek (například okraj trička pod bundou), vrať jen pokud jde jasně poznat, co to je.',
  'Názvy a všechny textové atributy piš stručně česky. Nevymýšlej atribut, který není z fotografie patrný; použij null nebo prázdné pole.',
  'category musí označit funkci kusu: top (tričko, košile, mikina, svetr), outerwear (bunda, kabát, vesta), bottom, shoes nebo accessory.',
  'primaryColor vyber jen z povolených barev podle nejbližšího vizuálního odstínu.',
].join(' ');

/** Text, který jde spolu s fotkou. */
export const ANALYSIS_USER_TEXT = 'Analyzuj oblečení na této fotografii a vyplň katalogové atributy.';

/* ─────────── Knihovna těl avatara (tools/avatar-library.mjs) ─────────── */

/** Společná pravidla – všechna těla sdílí pózu, výřez a styl, jinak by na ně nesedělo oblečení. */
const AVATAR_RULES = [
  'Keep exactly the same 3D cartoon style (Pixar-like), lighting, camera, framing and plain light grey background as the reference image.',
  'Full body, standing straight, facing the camera, arms relaxed slightly away from the body, feet slightly apart, exactly the same pose, scale and position in the frame.',
  'The character wears only the same simple light grey tank top and light grey shorts, barefoot. No accessories, no text.',
].join(' ');

const SKIN = {
  light: 'light fair skin tone',
  medium: 'medium skin tone',
  tan: 'tan olive skin tone',
  dark: 'dark brown skin tone',
};

/**
 * Velikosti podle EN 13402-3 (střed rozsahu obvodu hrudníku / prsou), výška podle normy: muž 176 cm, žena 168 cm.
 * Míry v cm: hrudník/prsa, pas, boky.
 */
export const BODY_SIZES = ['S', 'M', 'L', 'XL'];
const MEASURES = {
  male: {
    S: [90, 78, 92, 'slim'],
    M: [98, 86, 100, 'average'],
    L: [106, 96, 106, 'broad, slightly heavier with a soft belly'],
    XL: [114, 106, 112, 'heavy-set with a round belly'],
  },
  female: {
    S: [86, 70, 94, 'slim'],
    M: [94, 78, 102, 'average'],
    L: [102, 87, 110, 'curvy, slightly heavier'],
    XL: [113, 99, 120, 'plus-size with fuller belly and hips'],
  },
};
const HEIGHT = { male: 176, female: 168 };

function measures(gender, size) {
  const [chest, waist, hips, words] = MEASURES[gender][size];
  const chestName = gender === 'female' ? 'bust' : 'chest';
  return `clothing size ${size} (EU standard): ${words} build, ${chestName} ${chest} cm, waist ${waist} cm, hips ${hips} cm, height ${HEIGHT[gender]} cm`;
}

/** Hlava těla je holá figurína – obličej a vlasy jsou samostatná vrstva (stejná pro všechna těla daného pohlaví). */
const BLANK_HEAD =
  'The head is completely bald and smooth like a mannequin: no hair, no eyebrows, no eyes, no mouth, no facial features at all, only a soft nose bump and ears. Same head shape, size and position.';

/** Výchozí mužské tělo bez obličeje (z výchozího avatara). */
export function maleBasePrompt() {
  return [
    `Redraw the reference character as the same young man with ${measures('male', 'M')} and medium skin tone.`,
    BLANK_HEAD,
    AVATAR_RULES,
  ].join(' ');
}

/** Výchozí ženské tělo bez obličeje (z výchozího avatara). */
export function femaleBasePrompt() {
  return [
    `Redraw the reference character as a young woman with ${measures('female', 'M')} and medium skin tone.`,
    BLANK_HEAD,
    AVATAR_RULES,
  ].join(' ');
}

/** Výchozí obličej a vlasy na holou hlavu (vrstva se pak vyřízne rozdílem obrázků). */
export function defaultFacePrompt(gender) {
  return [
    'Paint a friendly neutral face and hair onto the bald mannequin head:',
    gender === 'female'
      ? 'brown eyes, natural eyebrows, gentle smile, dark brown hair tied back into a small low bun.'
      : 'brown eyes, natural eyebrows, gentle smile, short neat dark brown hair.',
    'Keep the head shape, size, skin colour and position exactly the same, same 3D cartoon style and lighting. Change nothing outside the head.',
  ].join(' ');
}

/** Jiná pleť – mění se jen barva kůže (maska postavy). */
export function skinPrompt(skin) {
  return [
    `Change only the skin colour of the character to a ${SKIN[skin]} on the face, neck, arms, hands, legs and feet.`,
    'The head stays bald and without facial features. Keep the head shape, body shape, clothing, pose and everything else identical.',
    AVATAR_RULES,
  ].join(' ');
}

/** Jiná postava – mění se jen tělo, hlava zůstane přesně stejná (maska bez hlavy). */
export function buildPrompt(gender, size) {
  return [
    `Change only the body of the character to ${measures(gender, size)}. Keep exactly the same height and the same head.`,
    'The bald head, neck position and skin colour stay exactly the same. The tank top and shorts stretch naturally to fit the new body.',
    AVATAR_RULES,
  ].join(' ');
}
