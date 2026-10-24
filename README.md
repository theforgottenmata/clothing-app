# AI Wardrobe (clothing-app)

Osobní digitální šatník: nahraješ fotku oblečení, AI z ní udělá ilustraci ve stylu 3D cartoon avatara a avatara v ní oblečeš.

**Stav:** první funkční prototyp. Šatník, oblékání avatara klepnutím (jeden kus na zónu těla), ukládání outfitů a přidání kusu z fotky včetně nastavení umístění na postavě. Všechno se ukládá lokálně v prohlížeči. Skutečná AI zatím není připojená.

## Spuštění

Potřebuje **Node.js 24.15+** (nebo 22.22.3+). S nvm stačí `nvm install && nvm use` (verze je v `.nvmrc`).

```bash
npm install
npm start          # http://localhost:4200
npm run build      # produkční build do dist/
```

Při prvním spuštění se šatník naplní šesti výchozími kusy a avatar se oblékne do trička, hnědých kalhot a tenisek. Data jsou v IndexedDB prohlížeče (databáze `ai-wardrobe`). Pro nový start ji smaž v DevTools → Application → IndexedDB.

## Stack

Angular 22 (standalone, signals, zoneless) · Tailwind CSS 4 · Konva (plátno s vrstvami) · idb-keyval (IndexedDB). Bez backendu.

## Struktura

```
src/app/
├── core/                     modely, mapa těla avatara, úložiště, stores (signals), seed
├── ai/
│   ├── clothing-transformer.ts   rozhraní + InjectionToken pro AI převod
│   ├── passthrough-transformer.ts výchozí bez AI: fotka s odstraněným světlým pozadím
│   ├── background-removal.ts     jednoduchý výřez světlého pozadí (ne AI)
│   └── garment-extract.ts        výřez oblečení porovnáním „oblečený avatar“ vs. podklad
├── features/
│   ├── wardrobe/   Šatník
│   ├── try-on/     Vyzkoušet (Konva plátno + panely)
│   ├── outfits/    Uložené outfity
│   └── add-item/   Přidání kusu ve 3 krocích
└── shared/         ikony, statický náhled outfitu
```

## Jak fungují vrstvy

- Všechno se počítá v prostoru avatara **688×1024** a plátno se jen škáluje.
- **Verze na postavu** (`clothes-fit`) se při uložení ořízne na obsah a pamatuje si svou polohu (`fitBox`), takže sedí na avatara bez posouvání.
- **Katalogová verze nebo fotka** (když verze na postavu chybí) se umístí podle mapy těla (`core/body-map.ts`).
- Ruční doladění (posun, velikost, otočení) je jen v posledním kroku **přidání kusu**. Výsledek se uloží jako `placement` a použije se při každém oblečení. Na obrazovce Vyzkoušet se nic neposouvá.
- V každé zóně těla (vršek = topy i svrchní, spodek, boty, doplňky) je vždy jen jeden kus.
- Pořadí vrstev: avatar → boty → spodky → topy → svrchní → doplňky. Dlouhé spodky jsou vždy nad botami.

## Napojení AI

V `app.config.ts` je provider `CLOTHING_TRANSFORMER`. Stačí napsat třídu implementující `ClothingTransformer` a vyměnit `PassthroughTransformer`. Ověřený postup (viz `docs/rozhodnuti.md`):

1. **Katalog:** image-to-image s referencí stylu avatara.
2. **Oblečený avatar:** image edit s podkladem a katalogovým kusem, pravidla podle kategorie. Dlouhé spodky se generují na avatarovi ve standardních botách.
3. **Verze na postavu:** `extractGarmentLayer(oblečenýAvatar, podklad)` z `ai/garment-extract.ts`.

API klíče nepatří do frontendu, takže volání AI musí jít přes vlastní malý proxy endpoint.

## Podklady

| Cesta | Obsah |
|---|---|
| `docs/rozhodnuti.md` | Dohodnutá rozhodnutí: stack, vzhled (Glass · Grafit), pipeline AI, pravidla vrstev |
| `docs/design-source/` | Zdrojové soubory obrazovek z návrhu (reference rozložení a stylů) |
| `design-assets/` | Avatar (i bez pozadí), 6 katalogových kusů a 6 verzí na postavu; při buildu se kopírují do `/seed` |

Návrh všech obrazovek v Claude Design: https://claude.ai/artifact/XkxxPENUqUhkJ6aczpuUSj (platí řada **F · Glassmorphism**, paleta Grafit).
