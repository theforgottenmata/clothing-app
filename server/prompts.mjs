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

/* ─────────── Avatar ─────────── */

/** Společná pravidla – zaručí, že všechny avatary sdílí pózu, výřez a styl (jinak by na ně nesedělo oblečení). */
const AVATAR_RULES = [
  'Keep exactly the same 3D cartoon style (Pixar-like), lighting, camera, framing and plain light grey background as the reference avatar.',
  'Full body, standing straight, facing the camera, arms relaxed slightly away from the body, feet slightly apart, exactly the same pose and position in the frame.',
  'The character wears only the same simple light grey tank top and light grey shorts, barefoot. No accessories, no text.',
].join(' ');

const BODY = {
  gender: { male: 'a young man', female: 'a young woman' },
  size: {
    S: 'slim, narrow build',
    M: 'average, medium build',
    L: 'broader, slightly heavier build with a soft belly',
    XL: 'large, heavy-set build with a round belly and wider hips',
  },
  skin: { light: 'light skin tone', medium: 'medium skin tone', tan: 'tan olive skin tone', dark: 'dark brown skin tone' },
};

/** Tělo (placená změna – po ní se přegenerují vrstvy oblečení). */
export function avatarBodyPrompt({ gender = 'male', size = 'M', skin = 'medium' }) {
  return [
    `Redraw the reference avatar as ${BODY.gender[gender]} with a ${BODY.size[size]} and ${BODY.skin[skin]}.`,
    'Keep the face friendly and neutral, short neat hair.',
    AVATAR_RULES,
  ].join(' ');
}

/** Hlava (změna zdarma – mění se jen oblast hlavy, tělo zůstane pixel po pixelu stejné). */
export function avatarHeadPrompt({ hair, hairColor, eyes, beard, glasses }) {
  const parts = [];
  if (hair) parts.push(`hairstyle: ${hair} (not longer than the chin)`);
  if (hairColor) parts.push(`hair colour: ${hairColor}`);
  if (eyes) parts.push(`eye colour: ${eyes}`);
  if (beard) parts.push(`facial hair: ${beard}`);
  if (glasses) parts.push(`glasses: ${glasses}`);
  return [
    `Change only the head of the avatar: ${parts.join(', ')}.`,
    'Keep the same face shape, skin tone, expression, head size and position, the same 3D cartoon style and lighting.',
    'Do not change anything outside the head and hair.',
  ].join(' ');
}
