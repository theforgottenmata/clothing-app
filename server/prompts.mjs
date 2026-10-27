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
  'Vracej jen kusy, které jsou na fotce hlavním předmětem nebo je z nich vidět aspoň zhruba polovina. Kus useknutý okrajem fotky nebo skoro celý zakrytý (například kalhoty, ze kterých je dole vidět jen kousek pod mikinou, okraj trička pod bundou) nevracej.',
  'visibleShare = jaká část kusu je na fotce vidět (0–1, např. 0.1 = jen okraj, 1 = celý kus).',
  'Názvy a všechny textové atributy piš stručně česky. Nevymýšlej atribut, který není z fotografie patrný; použij null nebo prázdné pole.',
  'category musí označit funkci kusu: top (tričko, košile, mikina, svetr), outerwear (bunda, kabát, vesta), bottom, shoes nebo accessory.',
  'primaryColor vyber jen z povolených barev podle nejbližšího vizuálního odstínu.',
  'reach = kam kus na těle sahá, když je oblečený: u vršků, bund, kabátů a spodků jeho spodní okraj (hip = k bokům, thigh = do půlky stehen, knee = ke kolenům, calf = na lýtka, ankle = ke kotníkům); u bot horní okraj (ankle = nízké boty a tenisky, calf = kotníkové až polovysoké, knee = vysoké kozačky); u doplňků místo nošení (head = čepice, klobouk, brýle; neck = šála, řetízek; waist = pásek; hip = kabelka, taška).',
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

/**
 * Velikosti podle EN 13402-3 (střed rozsahu obvodu hrudníku / prsou), výška podle normy: muž 176 cm, žena 168 cm.
 * L je mezistupeň mezi M a původním L (rozdíl M→L byl příliš velký, L a XL příliš podobné); XL = původní L.
 * Míry v cm: hrudník/prsa, pas, boky.
 */
export const BODY_SIZES = ['S', 'M', 'L', 'XL'];
const MEASURES = {
  male: {
    S: [90, 78, 92, 'slim'],
    M: [98, 86, 100, 'average'],
    L: [102, 91, 103, 'slightly broader and a little heavier than average, with only a hint of a soft belly'],
    XL: [106, 96, 106, 'broad, slightly heavier with a soft belly'],
  },
  female: {
    S: [86, 70, 94, 'slim'],
    M: [94, 78, 102, 'average'],
    L: [98, 82, 106, 'a little curvier and slightly fuller than average'],
    XL: [102, 87, 110, 'curvy, slightly heavier'],
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

/** Odstranění obličeje a vlasů z hotové hlavy (maska hlavy) – výsledkem je holá hlava figuríny. */
export function blankHeadPrompt() {
  return [
    'Remove the hair and all facial features from the head: turn it into a completely smooth, bald mannequin head',
    'with no hair, no eyebrows, no eyes, no eyelashes and no mouth – only a subtle nose shape and the ears remain.',
    'Keep the same skin tone, head shape, head size, neck, lighting and 3D cartoon style. Fill the area where the hair was with the plain light grey background.',
    'Change nothing outside the head.',
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

/** Jiná postava – mění se jen tělo, hlava zůstane přesně stejná (maska bez hlavy). */
export function buildPrompt(gender, size) {
  return [
    `Change only the body of the character to ${measures(gender, size)}. Keep exactly the same height and the same head.`,
    'The bald head, neck position and skin colour stay exactly the same. The tank top and shorts stretch naturally to fit the new body.',
    AVATAR_RULES,
  ].join(' ');
}

/* ─────────── Oblečení na avatara (server/garment.mjs, tools/garment-lab.mjs) ─────────── */

const REACH_TEXT = {
  head: 'on the head',
  neck: 'around the neck',
  waist: 'at the waist',
  hip: 'down to the hips',
  thigh: 'down to mid-thigh',
  knee: 'down to the knees',
  calf: 'down to the calves',
  ankle: 'down to the ankles',
};

const GARMENT_RULES = {
  top: 'It is a top. It must completely cover the grey tank top. The grey shorts below it stay exactly as they are – do not remove or repaint them, unless the top itself is long enough to cover them. A collar or hood may rise around the neck. If the top has no sleeves or a deep neckline, show bare skin there instead of the grey tank top.',
  outerwear: 'It is an outer layer (jacket or coat), worn the same way as in the photo (open or zipped). If it is open, the grey tank top shows underneath unchanged. The grey shorts stay exactly as they are where the coat does not cover them. The collar or hood may rise around the neck.',
  'bottom-long': 'They are long bottoms (trousers or a long skirt). They must completely cover the grey shorts and the legs down to the ankles; the hem rests on the top of the bare feet. The waistband sits at the waist, below the grey tank top.',
  'bottom-short': 'They are short bottoms (shorts or a short skirt). They must completely cover the grey shorts; the legs below stay bare. The waistband sits at the waist, below the grey tank top.',
  shoes: 'They are shoes. Put the pair on both bare feet (even if the photo shows only one shoe). Boots may cover the lower legs up to their natural height.',
  accessory: 'It is an accessory. Place it naturally on the character where it is normally worn; nothing else changes.',
};

/** Oblékni tělo avatara do kusu z druhého obrázku (úprava obrázku s maskou zóny těla). */
export function garmentPrompt({ category, bottomLength = 'long', reach = null, name = null, subtype = null }) {
  const rule = GARMENT_RULES[category === 'bottom' ? `bottom-${bottomLength}` : category] ?? GARMENT_RULES.accessory;
  const what = [name, subtype].filter(Boolean).join(' – ');
  return [
    'Dress the character from the first image in the clothing item shown in the second image.',
    what ? `The item is: ${what}. Use only this item from the second image, ignore anything else in it (people, hangers, other clothes, background).` : 'Use only the clothing item from the second image, ignore anything else in it.',
    'Redraw the item in exactly the same 3D cartoon style (Pixar-like), shading and lighting as the character, fitted naturally to this body with soft realistic folds.',
    'Keep the colour, pattern, material look, logos and details of the item faithful to the second image.',
    rule,
    reach && REACH_TEXT[reach] ? `When worn, it reaches ${REACH_TEXT[reach]}.` : '',
    'The arms and hands must stay in exactly the same position as in the first image (slightly away from the body) – draw the sleeves around the existing arms, do not move the arms closer to the body and do not make the silhouette narrower. Both hands stay visible below the sleeves.',
    'Keep the body, hands, feet, pose, skin, bald head and plain light grey background exactly the same. Do not add any other clothing or accessories.',
  ].filter(Boolean).join(' ');
}
