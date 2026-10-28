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

## Vlastní avatar

Rozhodnutí (25. 10. 2026):
- Avatar se skládá jako ve hrách, **bez fotky obličeje** a bez generování při každé změně.
- **Tělo = pohlaví (2) × velikost S–XL podle EN 13402 (4) × pleť (4) = 32 variant** (prošli jsme standardy: Google try-on XXS–4XL, ASOS 16 velikostí, Ready Player Me 4 tvary na pohlaví; zvoleno S–XL) v knihovně `design-assets/avatars/`. Přepnutí je okamžité a zdarma.
- **Těla mají holou hlavu bez obličeje** (figurína). **Obličej** (oči, obočí, pusa, vlasy; později výběr účesů, vousů, brýlí) je samostatná průhledná vrstva přes hlavu – jedna sada pasuje na všechna těla daného pohlaví, na oblečení nemá vliv, případně za placenou bránou. Zatím výchozí obličej pro muže a ženu (`face-{pohlaví}-default.webp`).
- Oblečení se bude generovat na tělo (druhá fáze), takže kus jde použít pro všechny se stejným tělem.

Hotovo:
- `tools/avatar-library.mjs` vygeneruje knihovnu (plán a odhad ceny bez `--run`, `--only`, `--force`, `--manifest`). Těla vznikají úpravou výchozího avatara s maskou: jiná pleť mění jen postavu, jiná postava zachová hlavu pixel po pixelu. Výstup: `{id}.webp` (podklad pro AI), `{id}-transparent.webp` (pro plátno), `manifest.json` s mapou hlavy a zón.
- Stránka **Můj avatar** (`/avatar`): pohlaví, postava s náhledy, pleť; zvolené tělo je v IndexedDB (`avatar:body`) a v záloze. Plátno i náhledy berou avatara z `AvatarStore`.
- Původní generování avatara přes AI na požádání bylo odstraněno.

Vygenerováno (25. 10.): muž a žena S–XL se střední pletí (8 těl). Póza drží, hlava je u všech velikostí stejného pohlaví na stejném místě. Model ale obličej neodstranil → přidán krok `--blank-heads` (2 volání pro střední pleť).

Holé hlavy hotové (8 těl figurín). Vrstvy obličeje `face-{pohlaví}-default` přepočítány zdarma z původních těl: obličej + vlasy se berou celé (maska SegFormeru), rozdíl obrázků doplní jen přesahy – po složení téměř shodné s originálem.
Pro jiné pleti se obličej zdarma přebarví (`face-{pohlaví}-default-{pleť}`, kůže podle tónu, vlasy/oči/obočí zůstanou); děje se automaticky po vygenerování pleti, ručně `--faces`.

Pleti (25. 10.): místo AI se počítají **lokálně a zdarma** přebarvením kůže (maska SegFormeru, násobení barvy, tlumení na obrysu proti světlému lemu); obličej se přebarví stejným poměrem. Knihovna je kompletní: **32 těl + 8 obličejů** (2,5 MB), AI stálo jen 8 těl + 2 holé hlavy.
Důsledek pro druhou fázi: oblečení se generuje jen pro **8 těl** (pohlaví × velikost), pleť na něj nemá vliv.
Při změně avatara se oblečení z postavy sundá (je kreslené na konkrétní tělo).
Úprava velikostí (25. 10.): rozdíl M→L byl příliš velký a L a XL si byly podobné. Původní L se přejmenovalo na XL, původní XL je vyřazené (v historii gitu) a nové L je mezistupeň (muž hrudník 102 / pas 91 / boky 103 cm, žena prsa 98 / pas 82 / boky 106 cm). Nové L vygenerováno (2 volání AI, pleti zdarma), odstup S → M → L → XL je rovnoměrný. Knihovna je kompletní: 32 těl + 8 obličejů. a kontrolu, že těla drží pózu a obličej sedí na všechna těla.

Známé: výchozí cartoon vrstvy oblečení jsou dělané na výchozí tělo, na jiných tělech sedí jen přibližně, dokud nebude druhá fáze.

Po avatarovi následuje **druhá fáze**: kus oblečení + tělo → OpenAI image edit (`gpt-image-2.5-sunburst`, maska zóny těla, výstup 688×1024) → vrstva na postavu rozdílem obrázků (`garment-extract.ts`).

## Druhá fáze: oblečení na avatara (ladí se)

Rozhodnutí (26. 10.): generování se ladí nejdřív **jen na jednom těle – muž M, střední pleť**; ostatní těla až potom. Editor obličeje (tvar hlavy, oči, obočí, nos, pusa, vlasy + barvy) je **odložený** na později.

- `server/garment.mjs`: maska zóny těla podle kategorie (SegFormer na těle s obličejem, hlava vždy vyloučená; vršek po kousek pod pas, svrchní přes boky, dlouhé spodky po kotníky, boty chodidla) → OpenAI úprava obrázku (tělo + výřez kusu, `gpt-image-2.5-sunburst`, 688×1024) → mimo zónu původní pixely → vrstva rozdílem (port ověřeného `garment-extract.ts`: práh 45, 14 na pozadí, otevření r=3, oblasti > 3000 px, vyplnění děr).
- Prompt: `garmentPrompt` v `server/prompts.mjs` (pravidla podle kategorie).
- Zkušební skript `tools/garment-lab.mjs`: `node --env-file=.env tools/garment-lab.mjs fotka.png --category outerwear --color Zelená` → `tmp/garment-lab/` (výřez, oblečený avatar, vrstva, náhled, zóna). 1 volání ≈ 1 Kč.
- Zatím bez bot na těle: dlouhé kalhoty jdou na bosé nohy (pravidlo „lem přes boty“ se vyřeší s botami).
- První test (26. 10., bunda na člověku + džíny z e-shopu): AI kus na tělo nakreslí dobře. Výřez vrstvy vylepšen: drží jen to, co SegFormer na oblečeném avatarovi vidí jako oblečení dané kategorie (vypadnou ruce, chodidla, kůže, světlí „duchové“ na pozadí); v oblasti tílka/šortek zůstane jen barva kusu z fotky (paleta k-means); krk je u vršků a bund povolený (límec). Prompt: šortky a tílko se nesmí mazat ani překreslovat.
- `--reuse` přepočítá vrstvu z uloženého výstupu AI bez nového volání (ladění výřezu zdarma).
- Druhý test (26. 10., obě bundy): límec u krku celý, šortky zůstaly, logo i zipy věrné. Problém: AI stáhla ruce blíž k tělu (užší rukávy), takže původní ruce avatara jsou vidět vedle rukávů → prompt vyžaduje stejnou pozici rukou. Pruhy tílka uvnitř rozepnuté bundy odstraněny vyhlazením (většina 9×9).

- Třetí test (26. 10., černá bunda): AI i přes prompt stáhla ruce k tělu a schovala dlaně do rukávů. Záloha nezávislá na AI: spolu s vrstvou vzniká **maska mazání** (`-3b-mazani.png`) – místa původních paží, která jsou na oblečeném obrázku pozadí. Avatar se jí v náhledu (a později v aplikaci, `destination-out`) „vygumuje“, takže původní ruce vedle rukávů zmizí. Ruce, které AI nakreslila jinde, jdou do vrstvy. Maže se jen v oblasti paží (nohy AI občas zúží o pár px, tam by vznikaly zuby). Prompt nově chce dlaně viditelné pod rukávy. Do aplikace se pak ukládá vrstva + maska pro každé tělo.

- Čtvrtý test (26. 10., obě bundy + oboje džíny): bundy už mají dlaně pod rukávy a mazání paží funguje. Džíny: zóna spodku je nahoře rovně v úrovni pasu (medián horního okraje šortek – výběžek do tílka dělal schod v pase). Z vrstvy spodků a bot vypadnou chodidla (pleť mimo barvy kusu) a světlé stíny pod nimi.

- Pátý test (27. 10., béžové tenisky z e-shopu): AI boty nakreslila dobře, ale (1) výřez z fotky byl rozsekaný – SegFormer je trénovaný na lidech a samotnou botu bere zčásti jako nohu; (2) z vrstvy zbyly cáry, protože béžová bota má skoro barvu pleti. Oprava: u produktové fotky (bez obličeje a bez většího kusu těla, jeden kus) se vyřízne vše, co není pozadí (barva okraje fotky + SegFormer), s vyplněním děr. Ve vrstvě bot se plocha se štítkem boty bere celá, filtry pleti a stínů platí jen kolem ní.

### Zapojeno do aplikace (27. 10.)

Kus se na avatara obléká sám: při prvním oblečení na dané tělo zavolá aplikace `/api/clothing/dress`, do té doby je vidět katalogový obrázek a štítek „Oblékám…“. Hotová vrstva a maska mazání se uloží ke kusu a tělu.

Ošetřené rizikové případy (obecná pravidla, ne pro konkrétní fotku):

| Případ | Řešení |
| --- | --- |
| Produktová fotka bez člověka (bota, kalhoty) | Výřez = vše mimo pozadí (barva okraje), díry vyplněné; řídí se i `containsPerson` z analýzy |
| Kus na vzorované podlaze / dece | Pozadí není jednolité → výřez podle SegFormeru (vše, co není pozadí) |
| Bílý / světle šedý kus | Filtr „ducha“ a světlých stínů jen tam, kde bylo i na holém avatarovi pozadí; paleta kusu zná bílou |
| Šedý kus přes šedé tílko | Šedá podle palety kusu zůstává |
| Béžový kus (barva pleti) | Plocha, kterou SegFormer pozná jako kus, se bere celá |
| Top bez rukávů / s výstřihem | Odhalená kůže místo tílka patří do vrstvy (jinak by tílko prosvítalo) |
| AI posune ruce | Maska mazání avatara + ruce nakreslené AI ve vrstvě, prompt drží ruce |
| Dlouhé kusy (tunika, kabát ke kolenům), kozačky, culottes | Analýza vrací `reach` (kam kus sahá) → zóna a prompt podle něj |
| Čepice, brýle, šála, pásek, taška | Zóna podle místa nošení (`reach`), hlava povolená jen pro doplňky na hlavu a krk |
| Kus, který SegFormer nezná (šperk, hodinky) | Vrstva jen z rozdílu obrázků v zóně |
| Fotka s více věcmi / ramínkem | Prompt jmenuje kus (název a podtyp z analýzy) a zbytek ignoruje |
| AI kus nenakreslí | Vrstva menší než 1500 px → chyba s tlačítkem „Zkusit znovu“, kus zůstane jako katalog |
| Jiná pleť avatara | AI kreslí jen na střední pleť; ruce ve vrstvě se lokálně přebarví |
| Změna typu nebo délky kusu | Verze na postavu se smažou, při dalším oblečení vznikne nová |

Kdy se generuje: při přidání kusu hned po uložení pro aktuální tělo – uživatel počká na krok „Kreslím na avatara“ (obrázek kusu se skenovací animací, stav podle uplynulého času a odhadovaný průběh; skutečný průběh OpenAI neposílá). U více kusů z jedné fotky se kreslí souběžně, zatímco se vyplňují další, a čeká se na konci. Při chybě: Zkusit znovu / Pokračovat bez postavy. Pro jiné tělo se kus kreslí až při prvním oblečení. Šetření AI: jednou na kus a tělo (pohlaví × velikost); stejný běžící požadavek se nespouští dvakrát; výstup AI je v cache serveru; předloha kusu jde do AI zmenšená (max. 768 px, JPEG) a nedeformovaná. Cena jednoho oblečení ve střední kvalitě je asi 1,5 Kč.

Čistší obrys vrstvy (27. 10. večer, podle screenshotů bílých tenisek, džínů a trička): schodovitý okraj byl ze štítků SegFormeru (hrubé rozlišení) – štítek se teď bere jen uvnitř (zúžený), obrys určí rozdíl obrázků; okraj je jemně rozmazaný a proti pozadí se průhlednost dopočítá z barvy (bez světlého lemu). Maska mazání jen v zóně kusu a jen tam, kde AI obrázek změnila (dřív u džínů ukusovala okraj paží); u bot schová i prsty, které koukaly zpod podrážky. Uložené kusy se po startu aplikace přepočítají zdarma z výstupu AI uloženého na serveru (`FIT_VERSION`, `cachedOnly`).

Skoro neviditelné kusy (27. 10.): analýza vrací `visibleShare` (jaká část kusu je na fotce vidět) a prompt žádá jen kusy viditelné aspoň zhruba z poloviny. Server navíc vynechá kusy pod `MIN_VISIBLE_SHARE` (0,45) – např. kousek kalhot pod mikinou se k uložení nenabídne. Aspoň jeden kus vždy zůstane.

Trička a žabky (27. 10., podle šatníku s 10 kusy): pod krátkými rukávy trčely pahýly kůže (AI posunula ruku o pár px a tenké proužky se braly do vrstvy) – kůže navíc se teď bere jen jako větší souvislý kus (skutečně posunutá dlaň). Žabky a sandály jsou z velké části noha: u bot se do vrstvy bere i kůže pod horním okrajem boty (prsty), nad ním ne; maska mazání u bot jen pod horním okrajem boty (jinak zuby na kotnících). `FIT_VERSION` 3 → uložené kusy se přepočítají zdarma.

Víc fotek najednou (28. 10.): výběr až 10 fotek (mobil: galerie, počítač: víc souborů). Fotky se analyzují jedna po druhé na pozadí, kusy se přidávají do procházení („Kus 2 z 3+“); když jsou kusy z hotových fotek prošlé, krok „Další fotka“ počká. Na konci se čeká na kreslení všech uložených kusů.

Denní strop (28. 10.): `server/usage.mjs` počítá placená volání za celý server (`server/.cache/usage.json`, nuluje se o půlnoci) – `MAX_SCANS_PER_DAY` (100) a `MAX_DRESS_PER_DAY` (30) v `.env`, 0 = bez limitu. Po vyčerpání chyba 429 s českou zprávou; kreslení z cache se nepočítá. Stav na `/api/health`.

Test ostatních postav: `node --env-file=.env tools/body-check.mjs` (plán a odhad ceny), s `--run` provede – výřezy z dílny × těla, přehled v `tmp/body-check/prehled.png`.

Test ostatních postav (28. 10., `tools/body-check.mjs`, bunda + džíny): muž S, L, XL a žena S, M, XL – kusy sedí podle postavy (šířka, délka, boky), ruce pod rukávy, pas rovný, bez úprav pravidel výřezu. Na ženských tělech bunda zakryje šortky skoro celé (bunda je vůči menší postavě delší) – to je v pořádku. Boty na jiných postavách zatím netestované.

Šaty a overaly (28. 10.): nová kategorie `dress` („Šaty a overaly“) zabírá vršek i spodek – obléknutí sundá top, bundu i kalhoty, obléknutí topu nebo kalhot sundá šaty. Délka krátké/dlouhé (nebo `reach` z analýzy); zóna = trup + ruce + boky + nohy po kolena / kotníky, mezera mezi nohama povolená (sukně padá přes obě nohy, overal ji nechá prázdnou); odhalená kůže místo tílka (šaty bez rukávů) patří ke kusu. Svrchní vrstva (28. 10.): bunda a kabát mají vlastní zónu, takže jdou přes tričko, mikinu i šaty (dřív sdílely zónu s vrškem a vylučovaly se). Plné vrstvení (mikina přes tričko, čepice, šály, ponožky) zatím ne – každý kus se kreslí zvlášť na holé tělo a víc vrstev pod sebou by koukalo; řešit až podle potřeby.

Světlé kusy a náhledy (28. 10.): krémová mikina měla díry na rukávech – krémová je skoro barva pozadí, takže filtr „ducha“ a průhledný okraj ji brali jako pozadí. Teď tam, kde SegFormer vidí kus, rozhoduje štítek, ne barva. Náhled v šatníku (`thumb:<tělo>`) je kus bez kůže – ruce, které AI nakreslila, už z rukávů v šatníku netrčí (na avatarovi zůstávají). `FIT_VERSION` 4 → přepočet zdarma.

Přednost vrstev (28. 10.): tabulka v `docs/rozhodnuti.md`. Boty a spodky mají vlastní plátno, maska bundy gumuje jen vršek a šaty pod ní (ruce trička vedle rukávů bundy). Ověřeno složením tričko + bunda + džíny. `FIT_VERSION` 5.

Dvojité ruce u trička (28. 10.): AI u trička posunula celé paže; zóna trička končí u boků, takže se do vrstvy vzala paže useknutá rovnou čarou a vedle ní zůstala původní. Ruka nakreslená AI se teď bere jen celá (nedotýká se okraje zóny – dlaně u bund); useknutá se nebere a původní paže se v tom místě nemaže. `FIT_VERSION` 6.

Zatím neřešeno: mikina přes tričko, čepice a šály jako samostatné sloty, ponožky; výchozí kusy mají jen starší verzi na postavu.

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
