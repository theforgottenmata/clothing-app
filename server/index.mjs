import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
const OPENAI_MODEL = process.env.OPENAI_ANALYSIS_MODEL ?? 'gpt-6-astra';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, { ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/clothing/analyze') {
      return json(response, 404, { error: 'Endpoint nebyl nalezen.' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return json(response, 503, { error: 'Analýza zatím není nastavená. Doplň OPENAI_API_KEY do souboru .env.' });
    }

    const body = await readJson(request);
    if (typeof body?.image !== 'string' || !IMAGE_PATTERN.test(body.image)) {
      return json(response, 400, { error: 'Pošli obrázek ve formátu JPG, PNG nebo WebP.' });
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
          'Jsi přesný módní katalogizátor pro českou aplikaci.',
          'Rozpoznej jednotlivé kusy oblečení na fotografii. Člověka, tělo, obličej, pozadí, nábytek a ostatní předměty ignoruj.',
          'Pokud je na člověku celý outfit, vrať samostatně každý jasně viditelný kus oblečení, nejvýše pět kusů.',
          'Názvy a všechny textové atributy piš stručně česky. Nevymýšlej atribut, který není z fotografie patrný; použij null nebo prázdné pole.',
          'category musí označit funkci kusu: top, bottom, outerwear, shoes nebo accessory.',
          'primaryColor vyber jen z povolených barev podle nejbližšího vizuálního odstínu.',
        ].join(' '),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Analyzuj oblečení na této fotografii a vyplň katalogové atributy.' },
              { type: 'input_image', image_url: body.image, detail: 'high' },
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

    const openaiBody = await openaiResponse.json();
    if (!openaiResponse.ok) {
      const errorCode = openaiBody?.error?.code ?? 'unknown_error';
      console.error('OpenAI analysis failed:', openaiResponse.status, errorCode);
      if (errorCode === 'credit_balance_exhausted') {
        return json(response, 402, { error: 'Na OpenAI API účtu nejsou dostupné kredity. Doplň je v nastavení API Billing.' });
      }
      if (errorCode === 'invalid_api_key') {
        return json(response, 401, { error: 'OpenAI API klíč není platný. Vytvoř nový klíč a uprav soubor .env.' });
      }
      return json(response, 502, { error: 'AI analýza se nepodařila. Zkus to prosím znovu.' });
    }
    const outputText = openaiBody.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === 'output_text')?.text;
    if (!outputText) {
      return json(response, 502, { error: 'AI nevrátila použitelný výsledek.' });
    }
    try {
      return json(response, 200, JSON.parse(outputText));
    } catch {
      return json(response, 502, { error: 'AI vrátila neplatný výsledek.' });
    }
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      return json(response, 413, { error: 'Fotografie je příliš velká.' });
    }
    if (error instanceof SyntaxError) {
      return json(response, 400, { error: 'Požadavek nemá platný formát.' });
    }
    console.error('Analysis endpoint failed:', error);
    return json(response, 500, { error: 'Analýza fotografie se nepodařila.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`API běží na http://localhost:${PORT}`);
});

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
