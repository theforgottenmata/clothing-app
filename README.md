# AI Wardrobe (clothing-app)

Osobní digitální šatník: nahraješ fotku oblečení, AI předvyplní jeho údaje a kus umístíš na avatara.

**Stav:** první funkční prototyp. Šatník, detail kusu s úpravami, oblékání avatara klepnutím (jeden kus na zónu těla), ukládání outfitů, AI analýza fotografie a lokální výřez kusů (i více kusů z jedné fotky), přidání kusu včetně nastavení umístění na postavě a záloha šatníku do souboru. Data šatníku se ukládají lokálně v prohlížeči.

## Spuštění

Potřebuje **Node.js 24.15+** (nebo 22.22.3+). S nvm stačí `nvm install && nvm use` (verze je v `.nvmrc`).

```bash
npm install
npm start          # web http://localhost:4200 + API http://localhost:3000
npm run build      # produkční build do dist/
```

Pro AI analýzu zkopíruj `.env.example` do `.env` a doplň svůj serverový klíč:

```bash
cp .env.example .env
```

```dotenv
OPENAI_API_KEY=tvuj_klic
```

Soubor `.env` je ignorovaný Gitem. Klíč se neposílá do Angular aplikace ani neukládá do prohlížeče.

Při prvním spuštění se šatník naplní šesti výchozími kusy a avatar se oblékne do trička, hnědých kalhot a tenisek. Data jsou v IndexedDB prohlížeče (databáze `ai-wardrobe`). Pro nový start ji smaž v DevTools → Application → IndexedDB.

## Záloha

Data žijí jen v prohlížeči. Na stránce Šatník dole je **Exportovat** (stáhne `satnik-RRRR-MM-DD.json` se všemi kusy, obrázky, outfity a aktuálním oblečením) a **Importovat** (po potvrzení nahradí celý šatník). Tak se dá šatník přenést na jiné zařízení.

## Stack

Angular 22 (standalone, signals, zoneless) · Tailwind CSS 4 · Konva (plátno s vrstvami) · idb-keyval (IndexedDB) · malý Node proxy server pro OpenAI.

## Struktura

```
src/app/
├── core/                     modely, mapa těla avatara, úložiště, stores (signals), seed, záloha
├── ai/
│   ├── clothing-analysis.ts    klient pro `/api/clothing/scan`
│   ├── clothing-transformer.ts   rozhraní + InjectionToken pro AI převod
│   ├── passthrough-transformer.ts výchozí bez AI: fotka s odstraněným světlým pozadím
│   ├── background-removal.ts     jednoduchý výřez světlého pozadí (ne AI)
│   └── garment-extract.ts        výřez oblečení porovnáním „oblečený avatar“ vs. podklad
├── features/
│   ├── wardrobe/   Šatník (+ export/import zálohy)
│   ├── item/       Detail kusu: úpravy údajů, umístění, původní fotka
│   ├── try-on/     Vyzkoušet (Konva plátno + panely) a sdílený editor umístění
│   ├── outfits/    Uložené outfity
│   └── add-item/   Fotka → kusy jeden po druhém (Uložit / Přeskočit) → u jednoho kusu umístění
└── shared/         ikony, statický náhled outfitu
server/
├── index.mjs        Node proxy: /api/clothing/scan (analýza + výřez), validace, limity
├── prompts.mjs      texty pro OpenAI (analýza fotky, avatar) – ladí se tady
├── avatar.mjs       pomůcky pro obrázky: OpenAI image edit, masky (hlava, postava), mapa těla
├── segmentation.mjs lokální výřez kusů (SegFormer + SAM přes transformers.js)
└── .models/         stažené modely (~150 MB, není v gitu)
```

## Jak fungují vrstvy

- Všechno se počítá v prostoru avatara **688×1024** a plátno se jen škáluje.
- **Verze na postavu** (`clothes-fit`) se při uložení ořízne na obsah a pamatuje si svou polohu (`fitBox`), takže sedí na avatara bez posouvání.
- **Katalogová verze nebo fotka** (když verze na postavu chybí) se umístí podle mapy těla (`core/body-map.ts`).
- Ruční doladění (posun, velikost, otočení) je jen v posledním kroku **přidání kusu** a v **detailu kusu** („Upravit umístění“). Výsledek se uloží jako `placement` a použije se při každém oblečení. Na obrazovce Vyzkoušet se nic neposouvá.
- V každé zóně těla (vršek = topy i svrchní, spodek, boty, doplňky) je vždy jen jeden kus.
- Pořadí vrstev: avatar → boty → spodky → topy → svrchní → doplňky. Dlouhé spodky jsou vždy nad botami.

## Můj avatar

Stránka `/avatar` (v menu „Avatar“). Avatar se skládá jako ve hrách:

- **Postava** = pohlaví (muž/žena) × postava (štíhlá, střední, silnější, robustní) × pleť (4 odstíny) = **32 těl s holou hlavou bez obličeje** (figurína). Přepnutí je okamžité a zdarma – aplikace jen vybírá z knihovny `design-assets/avatars/`. Podle těla se na avatara kreslí oblečení.
- **Obličej** (oči, obočí, pusa, vlasy) je samostatná průhledná vrstva přes hlavu – jedna sada pasuje na všechna těla daného pohlaví a na oblečení nemá vliv. Zatím je výchozí obličej pro muže a pro ženu; výběr účesů, očí, vousů a brýlí připravujeme (může být placený).
- Pořadí vrstev: tělo → obličej → oblečení.

Knihovnu vygeneruje jednou skript (32 těl + 2 obličeje = 34 volání OpenAI, cca 35 Kč):

```bash
node --env-file=.env tools/avatar-library.mjs              # plán a odhad ceny, nic neplatí
node --env-file=.env tools/avatar-library.mjs --only male-L-medium,face-male-default,face-female-default --run   # zkouška
node --env-file=.env tools/avatar-library.mjs --run        # vše, co chybí
```

Všechna těla vznikají z výchozího avatara: nejdřív holé tělo muže a ženy, z nich úpravou s maskou ostatní (jiná pleť = mění se jen postava; jiná postava = hlava zůstane pixel po pixelu stejná), takže sdílí pózu, výřez i polohu hlavy. Obličej se namaluje na holou hlavu a vyřízne rozdílem obrázků. `manifest.json` obsahuje i mapu hlavy a zón těla (pro obličej a oblečení). Prompty jsou v `server/prompts.mjs`. Chybějící tělo se v aplikaci nahradí výchozím avatarem.

## Přidání kusu z fotky

Funguje pro tři typy fotek: **produktová fotka z e-shopu**, **kus položený na zemi / na ramínku** a **člověk v outfitu** (pak se najde víc kusů najednou).

Angular pošle fotku (JPEG, max. 1400 px) na `POST /api/clothing/scan`. Server spustí současně:

1. **Analýzu – OpenAI, placená, jediné volání na fotku.** Fotka se před odesláním zmenší na 1024 px (`OPENAI_IMAGE_MAX_SIDE`), úroveň detailu jde snížit přes `OPENAI_IMAGE_DETAIL=low`. Vrací kusy s názvem, kategorií, barvou, střihem atd. Spotřeba tokenů se vypisuje do konzole serveru. Prompt je v `server/prompts.mjs`.
2. **Výřez – lokálně, zdarma.** SegFormer „clothes“ rozdělí fotku na vršek, kalhoty/sukni, boty, tašku, čepici… Když je ve vršku víc kusů (bunda přes tričko), oddělí je SAM podle barev z analýzy. Výsledek je průhledné PNG z původních pixelů – nic se nepřekresluje.

Kusy se pak procházejí jeden po druhém (Kus 1 z N, předvyplněný formulář, **Uložit a další** / **Přeskočit**). U jediného kusu následuje umístění na avatarovi. Kus, který je zakrytý nebo useknutý okrajem fotky, dostane upozornění.

Když analýza selže (není klíč, došly kredity, timeout), dá se kus **vyplnit ručně** – výřez oblečení se použije i tak. Ruční vyplnění jde zvolit i bez čekání na AI.

Modely pro výřez (~150 MB) se stáhnou z Hugging Face při prvním spuštění serveru do `server/.models/`.

## Budoucí cartoon převod

V `app.config.ts` je provider `CLOTHING_TRANSFORMER`. Stačí napsat třídu implementující `ClothingTransformer` a vyměnit `PassthroughTransformer`. Ověřený postup (viz `docs/rozhodnuti.md`):

1. **Katalog:** image-to-image s referencí stylu avatara.
2. **Oblečený avatar:** image edit s podkladem a katalogovým kusem, pravidla podle kategorie. Dlouhé spodky se generují na avatarovi ve standardních botách.
3. **Verze na postavu:** `extractGarmentLayer(oblečenýAvatar, podklad)` z `ai/garment-extract.ts`.

Cartoon převod zůstává oddělený od analýzy a bude se připojovat přes vlastní serverový endpoint.

## Podklady

| Cesta | Obsah |
|---|---|
| `docs/rozhodnuti.md` | Dohodnutá rozhodnutí: stack, vzhled (Glass · Grafit), pipeline AI, pravidla vrstev |
| `docs/design-source/` | Zdrojové soubory obrazovek z návrhu (reference rozložení a stylů) |
| `design-assets/` | Avatar (i bez pozadí), 6 katalogových kusů a 6 verzí na postavu; při buildu se kopírují do `/seed` |

Návrh všech obrazovek v Claude Design: https://claude.ai/artifact/XkxxPENUqUhkJ6aczpuUSj (platí řada **F · Glassmorphism**, paleta Grafit).
