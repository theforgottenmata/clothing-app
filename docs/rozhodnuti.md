# AI Wardrobe – dohodnutá rozhodnutí (prototyp)

## Stack
- Angular (nejnovější stabilní, standalone, signals, zoneless), Tailwind CSS v4
- Konva přímo (bez wrapperu) pro plátno s vrstvami
- IndexedDB přes idb-keyval (obrázky jako Blob), bez backendu, bez auth
- Stav: signal services (žádné NGXS)

## Vzhled – směr F „Glass · Grafit“ (zvoleno)
- Paleta: #F4F6F8 pozadí · #1F2328 akcent (tlačítka, aktivní stavy, výběr) · #3B414A text/sekundární text · #CFD4D8 okraje a jemné skvrny · #9FA3A7 ikony, placeholdery (ne pro text – nízký kontrast)
- Pozadí: linear-gradient(165deg, #F4F6F8 → #EEF1F3 → #E6EAED), rozmazané skvrny #CFD4D8 / #DDE1E5 na okrajích; žádné barevné pozadí (zkresluje barvy oblečení)
- Jediný barevný „pop“: korálová #F07A64 pro srdíčka/oblíbené (k potvrzení)
- Glassmorphism: karty rgba(255,255,255,0.45) + backdrop-filter blur(20px) saturate(140%), border 1px rgba(255,255,255,0.75), jemný stín + vnitřní horní odlesk; silnější sklo (0.55–0.6, blur 28px) pro spodní panel a navigaci
- Font: Manrope (nadpisy 800, záporný letter-spacing)
- Avatar: průhledná verze (původně design-assets/avatar/avatar-transparent.png, od 25. 10. 2026 nahrazeno knihovnou těl design-assets/avatars/), stojí na skleněném „podstavci“ s měkkým stínem
- Mobil – Vyzkoušet: avatar nahoře, plovoucí skleněné widgety (počasí, příležitost), spodní skleněný panel (vybraný kus + vrstva/sundat, kategorie, vodorovný pás kusů s „Nahrát“)
- Šatník: pozdrav, hledání, karta „Dnes doporučeno“ (avatar v outfitu + počasí), mřížka kusů, plovoucí skleněná navigace s velkým „+“
- Outfity: skleněné karty s avatarem v kombinacích, oblíbené
- Desktop: úzká skleněná navigace, šatník, avatar na podstavci s plovoucí lištou úprav, panel vrstev + tip podle počasí
- Přidání kusu (+): 1) vyfotit (hledáček, tipy) 2) zpracování (ilustrace + verze na postavu, kroky, ~1 kredit) 3) detaily (název, typ, barva, sezóna, počasí, příležitost; u spodků přepínač Dlouhé/Krátké)
- UI česky
- (Opuštěno: směr E „Navy“, barevné přechody máta/broskev, zelený akcent)

## Assety (design-assets/)
- avatar/avatar.png – 688×1024, pozadí ≈ rgb(227,227,231); Higgsfield job aea357b0-f418-4dda-aaac-d6272b358dab
- avatar/avatar-transparent.png (smazáno 25. 10. 2026, v historii gitu) – pozadí odstraněno flood-fillem od okrajů (tolerance 22 k rgb(227,227,231)) + šedý stín pod nohama (y>820, nízká sytost)
- clothes/*.png – katalogové verze (3D cartoon styl avatara, průhledné pozadí)
- clothes-fit/*-fit.png – verze na postavu, 688×1024, průhledné, sedí na avatara na 0,0

## Položka šatníku
- původní fotka (bílé pozadí stačí) → katalogová verze → verze na postavu
- fallback bez AI: katalogová verze s automatickým umístěním podle kategorie (mapa těla avatara)
- štítek AI / Foto; tagy: sezóna, počasí, příležitost (příprava na budoucí výběr outfitu)

## Pipeline verze na postavu
1. AI „obleče“ avatara (image edit: reference = podklad + katalogový kus, pravidla dle kategorie, „vše ostatní identické“)
2. Výřez porovnáním s podkladem v prohlížeči (canvas):
   - práh rozdílu 45; tam, kde byl v podkladu jen background, práh 14
   - morfologické otevření r=3, komponenty > 3000 px, vyplnění děr
3. Výsledek = průhledná vrstva 688×1024
- Přímé generování „jen oblečení na průhledném plátně“ NEFUNGUJE (špatné měřítko/pozice)

## Pravidla podle kategorie
- Podklad: boty, topy, svrchní, krátké spodky → holý avatar; DLOUHÉ spodky → avatar ve standardních botách (Higgsfield job 345c742a-3dca-4c01-83ff-3504b636a5fc), lem se překládá přes boty
- Pořadí vrstev: avatar → boty → spodky → topy → svrchní → doplňky
- Kalhoty: pas na horní hraně šortek, zakrýt šortky, lem přes boty (vidět jen špičky / u slim lem leží na botách)
- Topy: výstřih u krku, zakrýt tílko, rukávy podle A-pózy, ruce beze změny
- Dlouhý/krátký spodek: určí AI z fotky, uživatel může přepnout
- Změna avatara = nutné přegenerovat verze na postavu

## Náklady (Higgsfield, gpt_image_2_5, medium)
- ~0,5 kreditu / obrázek → nový kus ≈ 1 kredit (katalog + oblečený avatar)


## Vrstvení oblečení (28. 10. 2026)

Žádné plné vrstvení (sloty pro základní vršek, mezivrstvu, čepici, šálu, ponožky). Každý kus kreslí AI zvlášť na holé tělo, takže víc vrstev pod sebou by se překrývalo nepřesně (delší tričko pod mikinou, límeček pod svetrem); dokonalé vrstvení by znamenalo kreslit celý outfit najednou = dražší a bez rychlého přepínání. Udělaná je jen svrchní vrstva: bunda a kabát mají vlastní zónu a jdou přes vršek i šaty – volný kus přes jiný sedí dobře a pokryje nejčastější potřebu.

## Přednost vrstev (28. 10. 2026)

| Pořadí | Vrstva | Co ji gumuje |
| --- | --- | --- |
| 1 | tělo avatara | masky mazání všech oblečených kusů (původní ruce tam, kde je AI posunula) |
| 2 | obličej | nic |
| 3 | boty (100) | nic |
| 4 | spodky (200) – lem dlouhých přes boty | nic (široké kalhoty u rukou by dostaly díry) |
| 5 | šaty a overaly (250) | maska bundy |
| 6 | vršek (300) – lem přes pas kalhot | maska bundy |
| 7 | bunda, kabát (400) | nic |
| 8 | doplňky (500) | nic |

Maska bundy je širší (pás 30 px kolem paží a i tam, kde bylo na holém těle pozadí), protože ruce, které AI nakreslila u trička jinde než u bundy, by koukaly vedle rukávů.

## Formička pro kreslení kusů (30. 10. 2026)

**Co:** vršky, bundy a spodky kreslí AI na figurínu (výřez avatara v zóně kusu, jedna barva, pozadí jiné barvy) místo na celého avatara. Vrstva = vše, co nemá barvu figuríny ani pozadí.
**Proč:** dosavadní výřez z celého avatara potřeboval ~10 pravidel (kůže, šedé tílko, stíny, posunuté ruce, světlé kusy) a každá oprava rozbila jiný kus. Pokus na bundách, kalhotách a botách: čistý výřez, ruce avatara nedotčené.
**Zjištění:** realistickou figurínu v barvě podobné pleti blokuje moderace OpenAI (nahota) → plochá krejčovská panna; malé výstupní rozměry OpenAI odmítá → úspora ceny není; AI se drží tvaru figuríny → u kalhot širší nohy, jinak vyjdou úzké.
**Alternativy:** čistá silueta bez těla (horší sedění), ladit dál dosavadní postup (křehké).
**Zatím ne:** boty, šaty, doplňky (boty fungují, zapojí se v dalším kroku).
