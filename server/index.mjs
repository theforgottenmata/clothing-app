import { createServer } from 'node:http';
import sharp from 'sharp';
import { ANALYSIS_INSTRUCTIONS, ANALYSIS_USER_TEXT } from './prompts.mjs';
import { AvatarError } from './avatar.mjs';
import { dressFor } from './garment.mjs';
import { cutGarments, segment, warmUp } from './segmentation.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const OPENAI_MODEL = process.env.OPENAI_ANALYSIS_MODEL ?? 'gpt-6-astra';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
/** Kratší strana obrázku pro OpenAI – menší obrázek = méně tokenů = levnější analýza. */
const ANALYSIS_MAX_SIDE = Number(process.env.OPENAI_IMAGE_MAX_SIDE ?? 1024);
/** low = nejlevnější (hrubší), high = přesnější. */
const ANALYSIS_DETAIL = process.env.OPENAI_IMAGE_DETAIL ?? 'high';
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Kam kus na těle sahá (spodní okraj, u bot horní okraj, u doplňků místo nošení) – podle toho se kreslí na avatara. */
export const REACH = ['head', 'neck', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'];

const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/;

const garmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'category',
    'subtype',
    'primaryColor',
    'secondaryColors',
    'fit',
    'length',
    'sleeveLength',
    'legShape',
    'material',
    'pattern',
    'details',
    'reach',
    'confidence',
  ],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    category: { type: 'string', enum: ['top', 'bottom', 'outerwear', 'shoes', 'accessory'] },
    subtype: nullableString(),
    primaryColor: {
      anyOf: [
        { type: 'string', enum: ['Černá', 'Šedá', 'Bílá', 'Béžová', 'Hnědá', 'Zelená', 'Modrá', 'Červená'] },
        { type: 'null' },
      ],
    },
    secondaryColors: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', maxLength: 30 },
    },
    fit: nullableString(),
    length: nullableString(),
    sleeveLength: nullableString(),
    legShape: nullableString(),
    material: nullableString(),
    pattern: nullableString(),
    details: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } },
    reach: { type: 'string', enum: REACH },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['containsPerson', 'photoMode', 'garmentCount', 'garments'],
  properties: {
    containsPerson: { type: 'boolean' },
    photoMode: { type: 'string', enum: ['flat_lay', 'hanger', 'on_person', 'mannequin', 'other'] },
    garmentCount: { type: 'integer', minimum: 1 },
    garments: { type: 'array', minItems: 1, maxItems: 5, items: garmentSchema },
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Jedno placené volání OpenAI: rozpozná kusy a jejich atributy. */
async function analyze(buffer) {
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(503, 'Analýza zatím není nastavená. Doplň OPENAI_API_KEY do souboru .env.');
  }
  const small = await sharp(buffer)
    .rotate()
    .resize({ width: ANALYSIS_MAX_SIDE, height: ANALYSIS_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const image = `data:image/jpeg;base64,${small.toString('base64')}`;

  let openaiResponse;
  try {
    openaiResponse = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: ANALYSIS_INSTRUCTIONS,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: ANALYSIS_USER_TEXT },
              { type: 'input_image', image_url: image, detail: ANALYSIS_DETAIL },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'clothing_analysis',
            strict: true,
            schema: analysisSchema,
          },
        },
      }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new HttpError(504, 'AI neodpověděla včas. Zkus to znovu, nebo kus vyplň ručně.');
    throw new HttpError(502, 'Nepodařilo se spojit s OpenAI. Zkontroluj připojení k internetu.');
  }

  const openaiBody = await openaiResponse.json().catch(() => null);
  if (!openaiResponse.ok) {
    const errorCode = openaiBody?.error?.code ?? 'unknown_error';
    console.error('OpenAI analysis failed:', openaiResponse.status, errorCode);
    if (errorCode === 'credit_balance_exhausted' || errorCode === 'insufficient_quota') {
      throw new HttpError(402, 'Na OpenAI API účtu nejsou dostupné kredity. Doplň je v nastavení API Billing.');
    }
    if (errorCode === 'invalid_api_key') {
      throw new HttpError(401, 'OpenAI API klíč není platný. Vytvoř nový klíč a uprav soubor .env.');
    }
    if (openaiResponse.status === 429) throw new HttpError(429, 'OpenAI je teď přetížené. Zkus to za chvíli.');
    throw new HttpError(502, 'AI analýza se nepodařila. Zkus to prosím znovu.');
  }
  const usage = openaiBody?.usage;
  if (usage) console.log(`OpenAI analýza: ${usage.input_tokens} vstupních + ${usage.output_tokens} výstupních tokenů`);

  const outputText = openaiBody?.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text')?.text;
  if (!outputText) throw new HttpError(502, 'AI nevrátila použitelný výsledek.');
  try {
    return JSON.parse(outputText);
  } catch {
    throw new HttpError(502, 'AI vrátila neplatný výsledek.');
  }
}

/**
 * Analýza (OpenAI) a segmentace (lokálně) běží současně, pak se spojí:
 * každý rozpoznaný kus dostane i vyříznutý obrázek.
 * Když analýza selže, vrátí se aspoň výřez oblečení pro ruční vyplnění.
 */
async function scan(buffer) {
  const segmentation = segment(buffer);
  segmentation.catch(() => {});
  let analysis;
  let analysisError = null;
  try {
    analysis = await analyze(buffer);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    analysisError = { status: error.status, message: error.message };
  }

  let segmented = null;
  try {
    segmented = await segmentation;
  } catch (error) {
    console.error('Segmentace selhala:', error);
  }

  if (!analysis) {
    const [fallback] = segmented ? await cutGarments(segmented, [{ category: 'any', primaryColor: null }]) : [{}];
    return { analysisError, fallbackImage: fallback?.image ?? null };
  }
  const cuts = segmented
    ? await cutGarments(segmented, analysis.garments)
    : analysis.garments.map(() => ({ image: null, warning: 'Výřez se nepodařil, použije se celá fotka.' }));
  return {
    ...analysis,
    garments: analysis.garments.map((garment, index) => ({ ...garment, ...cuts[index] })),
  };
}

let scanning = false;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, { ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
    }
    if (request.method === 'POST' && url.pathname === '/api/clothing/dress') return await dress(request, response);
    const isScan = url.pathname === '/api/clothing/scan';
    if (request.method !== 'POST' || (!isScan && url.pathname !== '/api/clothing/analyze')) {
      return json(response, 404, { error: 'Endpoint nebyl nalezen.' });
    }

    const body = await readJson(request);
    if (typeof body?.image !== 'string' || !IMAGE_PATTERN.test(body.image)) {
      return json(response, 400, { error: 'Pošli obrázek ve formátu JPG, PNG nebo WebP.' });
    }
    const buffer = Buffer.from(body.image.slice(body.image.indexOf(',') + 1), 'base64');

    if (!isScan) return json(response, 200, await analyze(buffer));

    // Ochrana proti dvojkliku: jedno placené volání najednou.
    if (scanning) return json(response, 429, { error: 'Předchozí fotka se ještě zpracovává.' });
    scanning = true;
    try {
      const started = Date.now();
      const result = await scan(buffer);
      console.log(`Sken fotky hotový za ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return json(response, 200, result);
    } finally {
      scanning = false;
    }
  } catch (error) {
    if (error instanceof HttpError || error instanceof AvatarError || error?.status) {
      return json(response, error.status ?? 500, { error: error.message });
    }
    if (error?.code === 'BODY_TOO_LARGE') {
      return json(response, 413, { error: 'Fotografie je příliš velká.' });
    }
    if (error instanceof SyntaxError) {
      return json(response, 400, { error: 'Požadavek nemá platný formát.' });
    }
    console.error('Endpoint selhal:', request.url, error);
    return json(response, 500, { error: 'Zpracování fotografie se nepodařilo.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`API běží na http://localhost:${PORT}`);
  // Modely pro výřez se načtou hned (poprvé se stahují, ~150 MB), ať první fotka nečeká.
  const started = Date.now();
  warmUp()
    .then(() => console.log(`Modely pro výřez oblečení připravené (${((Date.now() - started) / 1000).toFixed(1)} s)`))
    .catch((error) => console.error('Modely pro výřez se nepodařilo načíst:', error.message));
});

const CATEGORY_SET = new Set(['top', 'bottom', 'outerwear', 'shoes', 'accessory']);
const DRESS_IMAGE = /^data:image\/(png|webp|jpeg);base64,[a-zA-Z0-9+/=]+$/;

/**
 * Oblečení kusu na avatara: { image (výřez kusu), category, bottomLength?, reach?, name?, subtype?, body, retry? }
 * → { layer, erase, warning, usd } (PNG jako data URL, 688×1024 v prostoru avatara).
 * Jedno placené volání na kus a tělo (pohlaví × velikost); opakování a jiná pleť jdou z cache zdarma.
 * cachedOnly: jen přepočet vrstvy z uloženého výstupu AI (po vylepšení výřezu), nikdy nic neplatí.
 */
async function dress(request, response) {
  const body = await readJson(request);
  if (typeof body?.image !== 'string' || !DRESS_IMAGE.test(body.image)) {
    return json(response, 400, { error: 'Chybí obrázek kusu.' });
  }
  if (!CATEGORY_SET.has(body.category)) return json(response, 400, { error: 'Neznámý typ kusu.' });
  const hint = {
    category: body.category,
    bottomLength: body.bottomLength === 'short' ? 'short' : 'long',
    reach: REACH.includes(body.reach) ? body.reach : null,
    name: typeof body.name === 'string' ? body.name.slice(0, 80) : null,
    subtype: typeof body.subtype === 'string' ? body.subtype.slice(0, 80) : null,
  };
  const started = Date.now();
  const garment = Buffer.from(body.image.slice(body.image.indexOf(',') + 1), 'base64');
  const cachedOnly = body.cachedOnly === true;
  const result = await dressFor({ garment, hint, bodyId: String(body.body ?? ''), retry: body.retry === true, cachedOnly });
  if (result.missing) return json(response, 200, { layer: null, erase: null, warning: null, usd: 0, missing: true });
  console.log(
    `Oblečení (${hint.category}${hint.reach ? `, ${hint.reach}` : ''}) na ${body.body} za ${((Date.now() - started) / 1000).toFixed(1)} s` +
      (result.usd ? `, cca $${result.usd.toFixed(3)}` : ' (z cache, zdarma)'),
  );
  const toUrl = (png) => (png ? `data:image/png;base64,${png.toString('base64')}` : null);
  return json(response, 200, { layer: toUrl(result.layer), erase: toUrl(result.erase), warning: result.warning, usd: result.usd });
}

function nullableString() {
  return { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
