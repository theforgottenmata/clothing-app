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
- Úložiště: IndexedDB přes idb-keyval (`core/storage.service.ts`), store `ai-wardrobe/kv`, klíče `items`, `img:<id>:<photo|catalog|fit>`, `outfit:current`, `outfits`. Žádný backend.

## Struktura

- `core/models.ts` – typy (`WardrobeItem`, `OutfitLayer`, `Outfit`, `Placement`, kategorie, barvy, štítky).
- `core/body-map.ts` – prostor avatara **688×1024**, `BODY_BOX`, `CATEGORY_Z`, `CATEGORY_ZONE`, tvorba vrstev.
- `core/wardrobe.store.ts` – kusy + object URL obrázků; `core/outfit.store.ts` – aktuální outfit a uložené outfity; `core/backup.service.ts` – export/import JSON.
- `features/wardrobe` (Šatník), `features/item` (detail `/satnik/:id`), `features/try-on` (Vyzkoušet + `outfit-stage` Konva + `placement-editor`), `features/outfits`, `features/add-item` (4 kroky: fotka → zpracování → detaily → umístění).
- `ai/` – rozhraní `ClothingTransformer` + token `CLOTHING_TRANSFORMER`, výchozí `PassthroughTransformer` (bez AI), `background-removal.ts`, `garment-extract.ts`.

## Pravidla domény (neporušovat)

1. **Jeden kus na zónu těla.** Zóny: vršek (topy i svrchní), spodek, boty, doplňky. `OutfitStore.wear()` nahradí kus ve stejné zóně.
2. **Pořadí vrstev** (`CATEGORY_Z`): boty 100 → spodky 200 → topy 300 → svrchní 400 → doplňky 500. Dlouhé spodky jsou vždy nad botami.
3. **Na obrazovce Vyzkoušet se oblečení neposouvá ani nezvětšuje.** Doladění umístění je jen při přidání kusu a v detailu kusu (`PlacementEditor`, `editable` na `OutfitStage`). Výsledek se ukládá jako `item.placement` a použije se při každém oblečení (`OutfitStore.layerFor`).
4. Verze na postavu (`fit`) se ořezává na obsah a pamatuje si `fitBox` v prostoru avatara.
5. Kusy musí být **ve stejném cartoon stylu jako avatar** (`design-assets/avatar/avatar-transparent.png`).

## AI (zatím nenapojeno – dělá se nakonec)

Ověřená pipeline (Higgsfield, model gpt_image_2_5):
1. Katalog: img2img s avatarem jako referencí stylu.
2. Oblečený avatar: image edit (podklad + katalogový kus, pravidla podle kategorie). **Dlouhé spodky se generují na avatarovi v botách, lem přes boty.**
3. Verze na postavu: `extractGarmentLayer(oblečený, podklad)` – rozdíl obrázků (práh 45, 14 na pozadí rgb(227,227,231), otevření r=3, komponenty > 3000 px, vyplnění děr). Generovat rovnou průhlednou vrstvu oblečení **nefunguje**.

Nová AI = třída implementující `ClothingTransformer`, zaregistrovaná v `app.config.ts`. **API klíče nikdy do frontendu ani do repa** – jen `.env` na straně malého proxy serveru.

## Git

Commity česky, stručně, co a proč. Neměň `design-assets/` bez dohody (jsou to schválené podklady).
