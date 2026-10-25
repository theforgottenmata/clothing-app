# Stav projektu a další kroky

Tento dokument slouží jako předání kontextu pro další práci na projektu. Popisuje stav po commitu `a0ff1db` a záměr pro nejbližší iterace. **Aktualizace níže v sekci „Izolace kusu – hotovo“** popisuje, co přibylo potom. Podrobná historická rozhodnutí jsou v [`rozhodnuti.md`](rozhodnuti.md) a závazné pokyny pro AI asistenty v [`../CLAUDE.md`](../CLAUDE.md).

## Cíl produktu

Osobní digitální šatník, ve kterém uživatel:

1. nahraje fotografii oblečení, případně fotografii člověka v oblečení,
2. nechá AI rozpoznat jednotlivé kusy a předvyplnit jejich atributy,
3. údaje zkontroluje a ručně upraví,
4. získá čistý katalogový obrázek samotného kusu,
5. uloží kus do šatníku a později ho může oblékat na avatara.

Aktuální priorita je kvalitně dokončit první část pipeline. Cartoon styl zatím není cílem nejbližší iterace.

```text
fotografie
→ rozpoznání oblečení
→ editovatelná metadata
→ potvrzení
→ čistý katalogový kus bez člověka a pozadí
→ uložení do šatníku
```

## Použitá architektura

- Angular 22, standalone komponenty, signals, zoneless a `OnPush`.
- Tailwind CSS 4.
- IndexedDB přes `idb-keyval` pro metadata a obrázky šatníku.
- Konva pro vrstvy oblečení na avatarovi.
- Malý Node server v `server/index.mjs` jako proxy pro OpenAI API.
- OpenAI klíč je pouze v lokálním `.env`; nesmí být ve frontendu ani v Gitu.
- Výchozí model analýzy nastavuje `OPENAI_ANALYSIS_MODEL`, aktuálně `gpt-6-astra`.

Vývojové spuštění:

```bash
npm start
```

Tento příkaz spouští Angular na `http://localhost:4200` a API na `http://localhost:3000`. Pokud na portu 4200 běží starý Angular proces, je nutné jej nejprve zastavit, aby se načetla aktuální proxy konfigurace.

Lokální `.env`:

```dotenv
OPENAI_API_KEY=...
OPENAI_ANALYSIS_MODEL=gpt-6-astra
PORT=3000
```

API účet už má funkční klíč i kredit. `.env` je v `.gitignore` a nesmí se commitnout.

## Současné části aplikace

| Obrazovka | Funkce |
|---|---|
| **Šatník** (`/satnik`) | Mřížka kusů, hledání, filtrování, oblíbené, náhled outfitu a export/import zálohy |
| **Detail kusu** (`/satnik/:id`) | Úprava základních údajů, štítků a umístění, původní fotografie, oblíbené, obléct a smazat |
| **Vyzkoušet** (`/vyzkouset`) | Avatar s vrstvami, oblékání klepnutím a uložení outfitu |
| **Outfity** (`/outfity`) | Seznam uložených outfitů, obléct a smazat |
| **Přidat kus** (`/pridat`) | Fotografie, AI analýza, editovatelný formulář a nastavení umístění |

Vzhled používá glassmorphism, neutrální světlé pozadí, paletu Grafit a písmo Manrope. Barevné gradienty se nepoužívají, aby nezkreslovaly barvy oblečení.

Důležitá pravidla stávajícího avatara:

- jeden kus na zónu těla; zóny jsou vršek, spodek, boty a doplňky,
- vrstvy se řadí boty → spodky → topy → svrchní → doplňky,
- dlouhé spodky jsou nad botami,
- umístění kusu se nastavuje při nahrání nebo v detailu a ukládá se jako `placement`,
- vše se počítá v prostoru avatara 688 × 1024.

## Co je hotové

### Nahrání a analýza fotografie

- Obrazovka přidání kusu přijímá fotografii z fotoaparátu nebo galerie.
- Fotografie se před odesláním zmenší na maximální rozměr 1400 px.
- Uživatel může nahrát samotný kus i člověka v oblečení.
- Vedle výběru fotografie je tlačítko **Analyzovat**.
- Analýzu lze po výsledku spustit znovu.

### Animace analýzy

Přes fotografii během analýzy běží:

- pohyblivá skenovací linka,
- jemná mřížka,
- pulzující detekční body,
- postupné stavové zprávy.

Aktuální zprávy jsou:

1. Rozpoznávám jednotlivé kusy…
2. Ignoruji postavu a okolí…
3. Hledám barvy a materiál…
4. Určuji střih a detaily…
5. Dokončuji analýzu…

Animace má dočasně minimální délku 5 sekund, aby byla při vývoji dobře vidět. Později lze dobu zkrátit nebo navázat na skutečné fáze zpracování.

### OpenAI endpoint

Existuje endpoint:

```text
POST /api/clothing/analyze
```

Angular posílá zmenšenou fotografii jako Base64 data URL. Node proxy:

- kontroluje podporovaný formát JPG, PNG nebo WebP,
- omezuje velikost požadavku,
- čte klíč ze serverového prostředí,
- posílá obrázek do OpenAI Responses API,
- vyžaduje odpověď podle pevného JSON schema,
- neposílá klíč ani interní chyby do prohlížeče.

Prompt instruuje model, aby ignoroval člověka, obličej, tělo, pozadí, nábytek a ostatní předměty. Pokud je na fotografii celý outfit, model vrátí až pět samostatných kusů oblečení.

### Strukturovaná metadata

Pro každý rozpoznaný kus se vrací:

```ts
{
  name: string;
  category: 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
  subtype: string | null;
  primaryColor: string | null;
  secondaryColors: string[];
  fit: string | null;
  length: string | null;
  sleeveLength: string | null;
  legShape: string | null;
  material: string | null;
  pattern: string | null;
  details: string[];
  confidence: number;
}
```

Odpověď navíc obsahuje `containsPerson`, `photoMode`, `garmentCount` a pole `garments`.

### Editovatelný formulář

Po analýze se formulář otevře pod fotografií a předvyplní:

- název,
- kategorii,
- konkrétní typ,
- hlavní a vedlejší barvy,
- střih,
- materiál,
- vzor,
- celkovou délku,
- délku rukávů,
- tvar nohavic,
- detaily.

Uživatel může všechna tato pole upravit. Ručně lze doplnit také sezónu, počasí a příležitost. Pokud AI vrátí více kusů, zobrazí se jejich výběr a zvolený kus se propíše do formuláře.

### Uložení dat

Rozšířený model `WardrobeItem` ukládá nové údaje do `attributes`:

- subtype,
- secondaryColors,
- fit,
- length,
- sleeveLength,
- legShape,
- material,
- pattern,
- details,
- containsPerson,
- photoMode,
- confidence.

Stávající položky zůstávají kompatibilní, protože `attributes` je volitelné.

### Průchod aplikací

Přidání kusu bylo zjednodušeno na dva kroky:

1. fotografie, AI analýza a potvrzení editovatelných údajů,
2. umístění kusu na avatarovi a uložení.

Po potvrzení se zatím používá stávající `PassthroughTransformer`. Ten se pokusí lokálně odstranit jednoduché světlé pozadí a připraví katalogový obrázek pro umístění. Nejde o cartoon generování.

### Chybové stavy

Aplikace rozlišuje a česky popisuje:

- chybějící `OPENAI_API_KEY`,
- neplatný API klíč,
- vyčerpaný API kredit,
- nepodporovaný nebo příliš velký obrázek,
- obecné selhání AI analýzy,
- odpověď bez použitelného strukturovaného výsledku.

## Co bylo ověřeno

Skutečné API volání s katalogovým obrázkem bílého trička vrátilo HTTP 200 a správně určilo například:

- název: Bílé tričko s krátkým rukávem,
- kategorii: top,
- typ: tričko,
- barvu: bílá,
- střih: mírně projmutý,
- délku rukávů: krátké,
- vzor: jednobarevný,
- detaily výstřihu a lemů,
- confidence 0,99.

V prohlížeči byl ověřen celý aktuální tok:

1. nahrání obrázku,
2. pětisekundová animace,
3. skutečná odpověď OpenAI přes Angular proxy,
4. automatické vyplnění formuláře,
5. ruční změna názvu,
6. potvrzení údajů,
7. přechod do kroku Umístění.

Angular kontrola typů a vývojová sestava prošly. Produkční `ng build` v sandboxu Codexu dříve skončil pádem procesu při optimalizaci, zatímco vývojový build se stejným zdrojovým kódem proběhl bez chyb. Před nasazením je potřeba produkční build zopakovat mimo sandbox na podporovaném Node 24.

## Izolace kusu – hotovo (navazuje na „Doporučené další kroky“ 1 a 2)

- Nový endpoint `POST /api/clothing/scan` nahrazuje v aplikaci samostatnou analýzu. Současně běží:
  - analýza OpenAI (jedno volání na fotku, fotka zmenšená na 1024 px JPEG, timeout 45 s, log spotřeby tokenů),
  - lokální segmentace `server/segmentation.mjs`: SegFormer `Xenova/segformer_b2_clothes` (vršek, kalhoty, sukně, boty, taška, čepice, šála, pásek) + SAM `Xenova/slimsam-77-uniform` pro oddělení vrstev ve vršku podle barev z analýzy.
- Výstup každého kusu: průhledné PNG z původních pixelů (věrné, nic se nepřekresluje) + případné varování (zakrytý kus, kus useknutý okrajem fotky).
- Ověřeno na fotkách: bunda z e-shopu (stín pod lemem zmizí), džíny z e-shopu, kalhoty + boty na člověku, bunda přes tričko na člověku (SAM oddělí bundu).
- Přidání kusu: výběr fotky rovnou spustí sken (bez umělého zdržení), dá se zrušit nebo zvolit ruční vyplnění. Víc kusů se prochází „Kus X z N“ s volbami Uložit a další / Přeskočit; umístění se u nich přeskočí (výchozí podle kategorie, doladit v detailu). Jeden kus pokračuje na umístění.
- Při selhání analýzy se kus vyplní ručně, výřez oblečení se použije i tak.
- Prompt je v `server/prompts.mjs`, nastavení úspory v `.env` (`OPENAI_IMAGE_MAX_SIDE`, `OPENAI_IMAGE_DETAIL`).
- Ochrana proti dvojkliku: server zpracovává jednu fotku najednou.

Známé limity:
- Fotka položená na zemi zatím nebyla ověřená na skutečné fotce (SegFormer je trénovaný na lidech; jako záchrana se bere vše, co není tělo ani pozadí).
- Zakryté části kusu chybí (např. tričko pod bundou) – aplikace upozorní a doporučí samostatnou fotku.
- Vrstvy stejné barvy SAM podle barvy nerozliší.
- Fotky na avatarovi zatím vypadají jen orientačně, dokud nebude cartoon převod.

## Vlastní avatar (hotovo, prompty se ladí)

Rozhodnutí (25. 10. 2026):
- Každý si vytvoří vlastní virtuálního avatara z voleb, **bez fotky obličeje**.
- Avatar = **tělo** (pohlaví, postava S/M/L/XL, pleť) + **hlava** (účes, barva vlasů, oči, vousy, brýle).
- **Změna těla je placená**: po ní se musí přegenerovat cartoon vrstvy všech kusů.
- **Změna hlavy je zdarma**: upravuje se jen oblast hlavy přes masku a tělo zůstane pixel po pixelu stejné, takže oblečení dál sedí.
- Všechny avatary vznikají úpravou výchozího avatara (stejná póza, výřez 688×1024, pozadí), ne generováním od nuly. AI si avatara nepamatuje, proto se ke každému kusu posílá obrázek avatara, ne jeho popis.
- Mapa těla (trup, ruce, nohy, hlava) se z avatara spočítá lokálně SegFormerem. Ověřeno, funguje i na kresleném avatarovi.

V aplikaci: stránka **Můj avatar** (`/avatar`) – postava (žena/muž, S–XL, pleť) a vzhled (účes, vlasy, oči, vousy, brýle), návrh → Použít / Zahodit. Server: `POST /api/avatar/body`, `POST /api/avatar/head` (`server/avatar.mjs`), denní limit `AVATAR_DAILY_LIMIT`. Avatar je v IndexedDB (`avatar:meta`, `avatar:opaque`, `avatar:transparent`) a v záloze. Plátno i náhledy berou avatara z `AvatarStore`.

Známé: stávající cartoon vrstvy oblečení (výchozí kusy) jsou dělané na výchozího avatara – na jinou postavu sednou jen přibližně, dokud nebude druhá fáze (generování oblečení na avatara).

Zkušební skript `tools/avatar-lab.mjs` (prompty v `server/prompts.mjs`), běží s klíčem z `.env`:

```bash
node --env-file=.env tools/avatar-lab.mjs body --gender female --size L --skin tan
node --env-file=.env tools/avatar-lab.mjs head --base tmp/avatar-lab/body-female-L-tan.png --hair "short curly" --hairColor auburn --eyes green
```

Výstupy jsou v `tmp/avatar-lab/`. Odhad ceny vypisuje skript, zhruba 1 Kč za volání ve střední kvalitě.

Po avatarovi následuje **druhá fáze**: kus oblečení + avatar → OpenAI image edit (`gpt-image-2.5-sunburst`, maska zóny těla, výstup 688×1024) → vrstva na postavu rozdílem obrázků (`garment-extract.ts`).

## Co zatím hotové není

### Fyzické odstranění člověka a pozadí

AI člověka při analýze ignoruje pouze významově. Z původního obrázku ho zatím fyzicky nemaže. Na fotografii člověka proto současný katalogový fallback může stále obsahovat část postavy nebo okolí.

Lokální `removeUniformBackground` funguje jen na jednoduché, převážně světlé pozadí. Není dostačující pro běžnou fotografii outfitu na člověku.

### Cartoon generování

Cartoon převod zatím není připojený a není součástí aktuálního milestone. Rozhraní `ClothingTransformer` a dokumentovaný budoucí postup zůstávají v projektu připravené pro pozdější fázi.

### Subscription a omezení AI funkce

Tlačítko Analyzovat zatím není chráněné předplatným, limitem ani přihlášením. Každé stisknutí provede placené API volání. Před veřejným provozem bude potřeba přidat autorizaci, serverové limity a případně předplatné.

### Produkční backend

Node server je nyní určený pro lokální vývoj. Nasazení, produkční konfigurace hostitele, bezpečné uložení secretu, logování, monitoring a rate limiting zatím nejsou dokončené.

## Doporučené další kroky

### 1. Izolace samotného kusu bez cartoon stylizace

To je nejbližší produktový cíl. Po potvrzení metadat má vzniknout čistý katalogový obrázek konkrétního vybraného kusu:

```text
původní fotografie + vybraný kus + potvrzená metadata
→ odstranění člověka, pozadí a ostatních kusů
→ transparentní PNG samotného oblečení
```

Doporučené rozhraní:

```text
POST /api/clothing/extract
```

Vstup:

- původní fotografie,
- vybraný index nebo popis kusu,
- potvrzená metadata.

Výstup:

- transparentní PNG nebo WebP samotného kusu,
- informace o rozměrech,
- případná confidence nebo varování, pokud je kus zakrytý.

Akceptační kritéria:

- člověk, obličej, kůže, pozadí a ostatní oblečení nejsou ve výsledku,
- zůstane zachovaný skutečný střih, barva, vzor, textura a detaily kusu,
- výsledek má průhledné pozadí,
- uživatel vidí náhled a může extrakci zopakovat,
- původní fotografie se zachová pro případnou opravu,
- nevzniká cartoon nebo stylizovaná varianta.

Před implementací je vhodné na několika různých fotografiích porovnat image edit/generation přístup s klasickou segmentací. Pro katalog je důležitější věrnost produktu než vizuální kreativita.

### 2. Zapojení izolovaného obrázku do ukládání

Po úspěšné extrakci nahradit současný katalogový fallback izolovaným obrázkem. Původní fotografii dál ukládat jako `photo`, čistý kus jako `catalog`.

Pokud extrakce selže, zobrazit uživateli volbu:

- zkusit znovu,
- nahrát lepší fotografii,
- dočasně pokračovat s původní fotografií.

### 3. Zobrazování a úprava nových atributů v detailu kusu

Nové atributy se ukládají, ale detail existujícího kusu zatím neupravuje všechna pole. Rozšířit detail kusu o stejná pole jako přidávací formulář.

### 4. Nákladové a bezpečnostní limity

Před veřejným spuštěním přidat:

- autentizaci uživatele,
- limit velikosti a počtu požadavků na uživatele,
- denní nebo měsíční AI limit,
- serverový rate limit,
- evidenci spotřeby,
- možnost skrýt Analyzovat za placené předplatné,
- ochranu proti opakovanému kliknutí a souběžným požadavkům.

### 5. Cartoon převod až po stabilizaci extrakce

Teprve po spolehlivém toku fotografie → metadata → čistý kus má smysl přidat:

```text
čistý katalogový kus
→ cartoon katalogový kus
→ nasazení na avatara
→ výřez transparentní vrstvy
```

Cartoon výstup by měl být samostatná odvozená varianta. Neměl by nahradit věrný katalogový obrázek.

## Důležité soubory

| Soubor | Účel |
|---|---|
| `server/index.mjs` | Node proxy, OpenAI volání, validace a JSON schema |
| `src/app/ai/clothing-analysis.ts` | Angular klient pro `/api/clothing/analyze` |
| `src/app/features/add-item/add-item-page.ts` | Stav analýzy, mapování výsledku do formuláře a ukládání |
| `src/app/features/add-item/add-item-page.html` | Upload, animace, formulář a výběr více kusů |
| `src/app/core/models.ts` | `WardrobeItem` a `ClothingAttributes` |
| `src/app/ai/passthrough-transformer.ts` | Současný ne-AI fallback katalogového obrázku |
| `src/app/ai/background-removal.ts` | Jednoduché odstranění světlého pozadí |
| `proxy.conf.json` | Vývojové přesměrování `/api` na Node server |
| `.env.example` | Šablona lokální konfigurace bez secretů |
| `CLAUDE.md` | Pravidla architektury a práce v repozitáři |

## Relevantní commity

- `d79eb6c` — Přidat animaci analýzy fotografie
- `a4d4e08` — Prodloužit animaci analýzy pro kontrolu
- `217cbcb` — Přidat AI analýzu oblečení z fotografie
- `a0ff1db` — Upřesnit chyby nastavení OpenAI API

## Pravidla pro pokračování

- Nemazat ani zásadně nepřepisovat existující flow bez konkrétní potřeby.
- Zachovat české uživatelské texty a současný Glass/Grafit vizuální styl.
- Zachovat Angular standalone architekturu, signals, `OnPush` a lazy routes.
- Neposílat OpenAI klíč do frontendu a nikdy necommitovat `.env`.
- Nezačínat cartoon generování dříve, než bude spolehlivě fungovat izolace skutečného kusu.
- Po změnách ověřit alespoň Angular typecheck, vývojový build a skutečný tok v prohlížeči.
- Respektovat další pokyny v `CLAUDE.md`.
