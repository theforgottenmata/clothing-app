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

const BUILD = {
  male: {
    S: 'a slim, narrow build with thin arms and legs',
    M: 'an average, medium build',
    L: 'a broader, slightly heavier build with a soft belly and fuller arms and legs',
    XL: 'a large, heavy-set build with a round belly, wide waist and thick arms and legs',
  },
  female: {
    S: 'a slim, petite build with thin arms and legs',
    M: 'an average, medium build',
    L: 'a curvier, slightly heavier build with fuller hips, arms and legs',
    XL: 'a plus-size build with a round belly, wide hips and thick arms and legs',
  },
};

/** Ženská verze výchozího těla (jednou, z mužského výchozího avatara). */
export function femaleBasePrompt() {
  return [
    'Redraw the reference character as a young woman with an average, medium build and medium skin tone.',
    'Friendly neutral face, hair tied back neatly into a small low bun so the head silhouette stays compact.',
    AVATAR_RULES,
  ].join(' ');
}

/** Jiná pleť – mění se jen barva kůže (maska postavy). */
export function skinPrompt(skin) {
  return [
    `Change only the skin colour of the character to a ${SKIN[skin]} on the face, neck, arms, hands, legs and feet.`,
    'Keep the face, hair, body shape, clothing, pose and everything else identical.',
    AVATAR_RULES,
  ].join(' ');
}

/** Jiná postava – mění se jen tělo, hlava zůstane přesně stejná (maska bez hlavy). */
export function buildPrompt(gender, size) {
  return [
    `Change only the body of the character to ${BUILD[gender][size]}.`,
    'The head, face, hair, neck position and skin colour stay exactly the same. The tank top and shorts stretch naturally to fit the new body.',
    AVATAR_RULES,
  ].join(' ');
}
