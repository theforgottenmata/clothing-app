# AI Wardrobe (clothing-app)

Osobní digitální šatník: nahraješ fotku oblečení, AI předvyplní jeho údaje a kus umístíš na avatara.

**Stav:** první funkční prototyp. Šatník, detail kusu s úpravami, oblékání avatara klepnutím (jeden kus na zónu těla), ukládání outfitů, AI analýza fotografie s editovatelným formulářem, přidání kusu včetně nastavení umístění na postavě a záloha šatníku do souboru. Data šatníku se ukládají lokálně v prohlížeči.

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
│   ├── clothing-analysis.ts    klient pro `/api/clothing/analyze`
│   ├── clothing-transformer.ts   rozhraní + InjectionToken pro AI převod
│   ├── passthrough-transformer.ts výchozí bez AI: fotka s odstraněným světlým pozadím
│   ├── background-removal.ts     jednoduchý výřez světlého pozadí (ne AI)
│   └── garment-extract.ts        výřez oblečení porovnáním „oblečený avatar“ vs. podklad
├── features/
│   ├── wardrobe/   Šatník (+ export/import zálohy)
│   ├── item/       Detail kusu: úpravy údajů, umístění, původní fotka
│   ├── try-on/     Vyzkoušet (Konva plátno + panely) a sdílený editor umístění
│   ├── outfits/    Uložené outfity
│   └── add-item/   Analýza a přidání kusu ve 2 krocích
└── shared/         ikony, statický náhled outfitu
server/
└── index.mjs       Node proxy, validace obrázku a pevné JSON schema odpovědi
```

## Jak fungují vrstvy

- Všechno se počítá v prostoru avatara **688×1024** a plátno se jen škáluje.
- **Verze na postavu** (`clothes-fit`) se při uložení ořízne na obsah a pamatuje si svou polohu (`fitBox`), takže sedí na avatara bez posouvání.
- **Katalogová verze nebo fotka** (když verze na postavu chybí) se umístí podle mapy těla (`core/body-map.ts`).
- Ruční doladění (posun, velikost, otočení) je jen v posledním kroku **přidání kusu** a v **detailu kusu** („Upravit umístění“). Výsledek se uloží jako `placement` a použije se při každém oblečení. Na obrazovce Vyzkoušet se nic neposouvá.
- V každé zóně těla (vršek = topy i svrchní, spodek, boty, doplňky) je vždy jen jeden kus.
- Pořadí vrstev: avatar → boty → spodky → topy → svrchní → doplňky. Dlouhé spodky jsou vždy nad botami.

## AI analýza fotografie

Angular pošle zmenšenou fotografii na `POST /api/clothing/analyze`. Node proxy ji předá vision modelu a vyžádá si strukturovaný výsledek. Model při rozpoznávání ignoruje člověka, obličej, pozadí a ostatní předměty. Pokud na fotce vidí více kusů oblečení, formulář nabídne výběr konkrétního kusu. Rozpoznaný název, kategorii, barvu, střih, materiál, vzor, délky a detaily lze vždy ručně upravit.

Tento krok zatím negeneruje cartoon obrázek ani fyzicky nemaže člověka z původní fotografie. Po potvrzení údajů se používá současný lokální fallback pro přípravu katalogového náhledu.

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
