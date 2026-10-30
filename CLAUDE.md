# AI Wardrobe — pokyny pro AI asistenty

Osobní digitální šatník v Angularu. Uživatel nahraje fotku oblečení, kus se převede do stylu 3D cartoon avatara a avatar se v něm dá obléct. UI i texty v aplikaci jsou **česky**. Rozhodnutí a jejich důvody: `docs/rozhodnuti.md` (čti před větší změnou).

## Příkazy

```bash
npm install
npm start            # ng serve, http://localhost:4200
npx ng build         # ověření po každé změně (musí projít bez chyb)
```

Node 24.15+ (`.nvmrc`). Testy zatím nejsou; ověřuj buildem a ručně v prohlížeči.

## Stack a konvence

- **Angular 22**: standalone komponenty, zoneless, signals (`signal`, `computed`, `effect`, `input`, `output`, `model`), `ChangeDetectionStrategy.OnPush`, nový control flow (`@if`, `@for`), lazy routes v `app.routes.ts`, parametry rout přes `withComponentInputBinding` (`input.required<string>()` pro `:id`).
- Žádné NgModules, žádné RxJS tam, kde stačí signals, žádné `[class.x/y]` bindingy (lomítko v názvu třídy nefunguje – použij `[ngClass]`).
- **Tailwind CSS 4** přes `.postcssrc.json`. Tokeny v `src/styles.css` (`@theme`):
  - `ink` #1f2328, `ink-2` #3b414a, `mist` #9fa3a7, `line` #cfd4d8, `paper` #f4f6f8, `coral` #f07a64 (oblíbené), `danger` #b5432e.
  - utility `glass`, `glass-strong`; třídy `.btn-primary`, `.btn-glass`, `.icon-btn`, `.chip`, `.chip-on`, `.label`, `.h-title`, `.no-scrollbar`.
  - Vzhled = **glassmorphism, paleta Grafit, neutrální pozadí**. Žádné barevné gradienty za oblečením (zkreslují barvy kusů). Písmo Manrope.
- Ikony: `shared/icon.ts` (mapa SVG cest, `<app-icon name="..." />`). Novou ikonu přidej do mapy.
- Úložiště: IndexedDB přes idb-keyval (`core/storage.service.ts`), store `ai-wardrobe/kv`, klíče `items`, `img:<id>:<photo|catalog|fit|fit:<tělo>|erase:<tělo>>`, `outfit:current`, `outfits`. Data šatníku jsou jen v prohlížeči; server je jen proxy pro AI.

## Struktura

- `core/models.ts` – typy (`WardrobeItem`, `OutfitLayer`, `Outfit`, `Placement`, kategorie, barvy, štítky).
- `core/body-map.ts` – prostor avatara **688×1024**, `BODY_BOX`, `CATEGORY_Z`, `CATEGORY_ZONE`, tvorba vrstev.
- `core/wardrobe.store.ts` – kusy + object URL obrázků; `core/outfit.store.ts` – aktuální outfit a uložené outfity; `core/backup.service.ts` – export/import JSON.
- `core/avatar.store.ts` – zvolené tělo avatara (pohlaví × velikost S–XL × pleť) z knihovny `design-assets/avatars/` (+ `manifest.json` s mapou těla); plátno a náhledy berou avatara odsud (`url()`), ne z konstanty.
- `features/avatar` (Můj avatar `/avatar`), `features/wardrobe` (Šatník), `features/item` (detail `/satnik/:id`), `features/try-on` (Vyzkoušet + `outfit-stage` Konva + `placement-editor`), `features/outfits`, `features/add-item` (fotka → zpracování → detaily → kreslení na avatara; ruční umístění jen bez těla z knihovny).
- `ai/` – `clothing-analysis.ts` (klient `/api/clothing/scan`), rozhraní `ClothingTransformer` + token `CLOTHING_TRANSFORMER`, výchozí `PassthroughTransformer` (bez AI), `background-removal.ts`, `garment-extract.ts`.
- `server/` – Node proxy (`index.mjs`, `npm start` ho spouští s Angularem): `/api/clothing/scan` = OpenAI analýza (jedno volání na fotku, prompt v `prompts.mjs`) + lokální výřez kusů (`segmentation.mjs`, SegFormer + SAM přes transformers.js, modely v `server/.models/`). Šetři volání OpenAI – výřez a další zpracování obrázků dělej lokálně.

## Pravidla domény (neporušovat)

1. **Jeden kus na zónu těla.** Zóny: vršek (topy), svrchní (bunda, kabát – jde přes vršek i šaty), spodek, boty, doplňky. Šaty a overaly (`dress`) zabírají vršek i spodek (`CATEGORY_ZONES`, `zonesOverlap`). `OutfitStore.wear()` sundá kusy, se kterými se zóny překrývají.
2. **Pořadí vrstev** (`CATEGORY_Z`): boty 100 → spodky 200 → šaty 250 → topy 300 → svrchní 400 → doplňky 500. Dlouhé spodky jsou vždy nad botami.
3. **Na obrazovce Vyzkoušet se oblečení neposouvá ani nezvětšuje.** Kus na postavu kreslí AI (verze na tělo, sedí sama). Ruční doladění umístění (`PlacementEditor`, `item.placement`) zůstává jen pro katalogovou verzi – když tělo není z knihovny nebo AI selže.
4. Verze na postavu (`fit`) se ořezává na obsah a pamatuje si `fitBox` v prostoru avatara.
5. Kusy musí být **ve stejném cartoon stylu jako avatar** (těla v `design-assets/avatars/`).
6. **Avatar = tělo (32 variant z knihovny: pohlaví × S–XL × pleť, holá hlava) + obličej (samostatná vrstva přes hlavu). Pořadí: tělo → obličej → oblečení.** Těla generuje jednou `tools/avatar-library.mjs`: 8 těl se střední pletí přes AI (úprava výchozího avatara – stejná póza, výřez 688×1024, poloha hlavy), ostatní pleti lokálně přebarvením kůže. Obličej ani pleť nesmí ovlivnit oblečení; oblečení se kreslí na tělo (pohlaví × velikost = 8 variant). Při změně avatara se oblečení z postavy sundá.

## Oblékání přes AI (napojeno)

1. Při přidání kusu se po uložení čeká na krok „Kreslím na avatara“, jinak při prvním oblečení na jiné tělo: `FitService.ensure` → `POST /api/clothing/dress` → `server/garment.mjs` `dressFor`.
   - **Vršky, bundy, spodky = formička** (`server/form.mjs`): AI obléká figurínu (výřez avatara v zóně kusu, jednolitá barva bez anatomie, pozadí jiné barvy); vrstva = vše mimo tyto dvě barvy (chroma key), maska mazání = figurína, kterou AI nechala prázdnou. Bez anatomie kvůli moderaci OpenAI, výstup v ploše celého avatara (menší rozměry OpenAI odmítá).
   - **Boty, šaty, doplňky = zatím starý postup:** maska zóny na celém avatarovi → vrstva z rozdílu obrázků + štítky SegFormeru + filtry.
2. Výsledek se uloží ke kusu: `item.fits[tělo]`, obrázky `fit:<tělo>` a `erase:<tělo>`. Další oblečení je zdarma. Výstup AI si server drží v `server/.cache/dress` – jiná pleť (lokální přebarvení rukou) ani opakování se neplatí.
3. Plátno (`OutfitStage`, stejně `OutfitPreview`): tělo → masky mazání všech kusů (`destination-out`) → obličej → boty → spodky (vlastní plátno, nic je negumuje) → šaty → vršek → maska mazání bundy (gumuje vršek a šaty pod ní, `erasesBelow`) → bunda → doplňky.
4. Ladění bez aplikace: `tools/form-lab.mjs` (formička; `--reuse` = jen přepočet výřezu, zdarma), `tools/garment-lab.mjs` (starý postup), test na víc postavách `tools/body-check.mjs`. Denní strop placených volání: `server/usage.mjs` (`MAX_SCANS_PER_DAY`, `MAX_DRESS_PER_DAY`). Generovat rovnou průhlednou vrstvu oblečení **nefunguje**.

Nová AI = třída implementující `ClothingTransformer`, zaregistrovaná v `app.config.ts`. **API klíče nikdy do frontendu ani do repa** – jen `.env` na straně malého proxy serveru.

## Postup u každého nového vývoje

1. **Nejdřív nic neimplementovat** – nejprve probrat.
2. Dát **konkrétní možnosti, stručně**: každá = název, 1–2 věty co to je, cena / náročnost, plusy a minusy. Na konci jedno doporučení.
3. Možnosti zapsat do `docs/navrhy.md` (datum, téma, možnosti, doporučení) a po rozhodnutí přesunout výsledek do `docs/rozhodnuti.md`.
4. Implementovat až po Martinově volbě. Ověřovat na celé testovací sadě kusů, ne na jednom (`tools/garment-lab.mjs --reuse`).

## Spolupráce: vývoj = učení

Martin chce aplikaci nejen mít, ale **rozumět jí** a v rámci vývoje se učit (architektura, AI, zpracování obrázků, backend). Proto při každé práci:

- **Vysvětli proč, ne jen co.** U každé změny krátce: jaký problém řeší, proč tohle řešení a jaké byly alternativy (a proč ne).
- **Ukaž, kde to v kódu je.** Odkaz na soubor a funkci (`server/garment.mjs` → `zoneRegion`), jak spolu části souvisí a kudy tečou data (prohlížeč → server → OpenAI → zpět).
- **Pojmenuj principy a pojmy.** Když se objeví obecný koncept (maska, segmentace, cache, signals, compositing, rate limit…), jednou větou ho vysvětli a řekni, kde se s ním potká i jinde.
- **Úroveň:** Martin je zkušený frontend vývojář (Angular, NGXS, OIDC, CI/CD) – Angular/TS základy nevysvětluj; vysvětluj backend, AI, zpracování obrázků, infrastrukturu a produktová rozhodnutí.
- **Chyby jako lekce.** Když se něco rozbije, řekni příčinu a co se z toho dá obecně vzít (např. „ladit na celé sadě kusů, ne na jednom“).
- **Rozhodnutí zapisuj** do `docs/rozhodnuti.md` (co, proč, alternativy) – je to zároveň učební materiál.
- **Stručně a česky.** Vysvětlení má být krátké a k věci, ne přednáška; kdo chce víc, zeptá se.

## Git

Commity česky, stručně, co a proč. Neměň `design-assets/` bez dohody (jsou to schválené podklady).
