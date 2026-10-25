# AI Wardrobe – stav projektu

Osobní digitální šatník. Nahraješ fotku oblečení, AI z ní vyčte údaje, kus umístíš na kresleného avatara a skládáš z kusů outfity. Podrobná rozhodnutí a jejich důvody jsou v [`rozhodnuti.md`](rozhodnuti.md), pokyny pro AI asistenty v [`../CLAUDE.md`](../CLAUDE.md).

## Spuštění

```bash
npm install
cp .env.example .env   # doplň OPENAI_API_KEY
npm start              # web :4200 + API proxy :3000
```

Je potřeba Node 24.15 nebo novější (`.nvmrc`).

## Technologie

- Angular 22: standalone komponenty, signals, zoneless, OnPush.
- Tailwind CSS 4.
- Konva pro plátno s vrstvami.
- idb-keyval: data se ukládají jen v prohlížeči (IndexedDB).
- Malý Node proxy server (`server/index.mjs`) pro volání OpenAI. Klíč je jen v `.env`, nikdy ve frontendu.

## Vzhled

Glassmorphism na neutrálním světlém pozadí. Paleta Grafit: #1F2328, #3B414A, #9FA3A7, #CFD4D8, #F4F6F8, pro oblíbené korálová. Písmo Manrope. Barevné gradienty se nepoužívají, protože zkreslují barvy oblečení.

## Co aplikace umí

| Obrazovka | Funkce |
|---|---|
| **Šatník** (`/satnik`) | Mřížka kusů, hledání, filtr podle kategorie a oblíbených, náhled aktuálního outfitu, export a import zálohy (JSON) |
| **Detail kusu** (`/satnik/:id`) | Úprava názvu, typu, délky, barvy a štítků (sezóna, počasí, příležitost), původní fotka, oblíbené, Obléct, Upravit umístění, smazání |
| **Vyzkoušet** (`/vyzkouset`) | Avatar s vrstvami, oblékání klepnutím, uložení outfitu. Kusy se tu neposouvají |
| **Outfity** (`/outfity`) | Uložené outfity podle příležitosti, obléct, smazat |
| **Přidat kus** (`/pridat`) | Ve 2 krocích: 1. fotka a AI analýza s upravitelným formulářem, 2. umístění na avatarovi |

## Pravidla

- **Jeden kus na zónu těla.** Zóny jsou vršek (topy i svrchní), spodek, boty a doplňky.
- **Pořadí vrstev:** boty → spodky → topy → svrchní → doplňky. Dlouhé spodky jsou vždy přes boty.
- **Umístění kusu** (posun a velikost) se nastavuje jen při nahrání a v detailu. Uloží se jako `placement` a použije se při každém oblečení.
- Všechno se počítá v prostoru avatara **688×1024**.
- Kusy mají být ve stejném 3D cartoon stylu jako avatar.

## AI

### Hotovo: analýza fotky
`POST /api/clothing/analyze` posílá fotku modelu `gpt-6-astra` (OpenAI Responses API) a dostává zpět pevné JSON schéma.
- **Vrací:** název, kategorii, barvy, střih, materiál, vzor, délky a detaily.
- **Ignoruje:** člověka a pozadí. Když je na fotce víc kusů, nabídne výběr.

Všechno se dá ručně upravit.

### Později: převod do cartoon stylu
Ověřeno ručně přes Higgsfield. Postup:
1. **Katalog:** fotka + avatar jako reference stylu → kus v cartoon stylu.
2. **Oblečený avatar:** úprava obrázku (podklad + katalogový kus). Dlouhé spodky se generují na avatarovi v botách.
3. **Vrstva na postavu:** rozdíl oblečeného avatara a podkladu (`ai/garment-extract.ts`).

Generovat rovnou průhlednou vrstvu oblečení nefunguje. Kandidáti u OpenAI jsou `gpt-image-2.5-sunburst` (přesné úpravy) a `gpt-image-2.5-flare` (rychlejší). Napojí se přes `ClothingTransformer` v `app.config.ts`. Zatím se používá `PassthroughTransformer`, který jen odstraní světlé pozadí fotky.

## Co dál

**Analýza (další krok):**
- [ ] Umožnit uložit kus i bez AI (ruční vyplnění, když analýza selže).
- [ ] Přidat timeout a zrušení požadavku (AbortController, timeout na proxy).
- [ ] Odstranit umělé zdržení analýzy o 5 s.
- [ ] Posílat na analýzu menší fotku (asi 1024 px, JPEG).
- [ ] Spouštět analýzu hned po výběru fotky.
- [ ] Jeden opakovaný pokus při 429/5xx, upozornění na nízkou jistotu, neplatit znovu za stejnou fotku.

**Později:**
- [ ] Převod do cartoon stylu: nejdřív otestovat skriptem, pak endpoint se streamovaným průběhem.
- [ ] Denní limit volání v proxy.
- [ ] Nasazení proxy (Vercel nebo Cloudflare), aby aplikace šla používat i z mobilu.
