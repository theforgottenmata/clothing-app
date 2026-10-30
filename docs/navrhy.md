# Návrhy k probrání

Před každým větším vývojem: možnosti stručně, doporučení, rozhodnutí → `docs/rozhodnuti.md`.

## 30. 10. 2026 – Optimalizace kreslení kusů na avatara (jen jedno tělo)

Cíl: spolehlivý výsledek na jednom těle (muž M, střední pleť), pak teprve ostatní postavy.

| # | Možnost | Co to je | Cena / práce | Plus | Minus |
| --- | --- | --- | --- | --- | --- |
| 1 | **Jen jedno tělo** | Aplikace zatím vždy použije muže M; výběr postavy skrytý. | zdarma, 1 h | méně kombinací k ladění | – |
| 2 | **Testovací sada** | 10–15 tvých kusů (výstupy AI z `server/.cache/dress`) + skript, který po každé změně vyřízne vše a dá přehled „před / po“. | zdarma, 2 h | konec rozbíjení toho, co fungovalo | potřebuju tvoje soubory |
| 3 | **Barevné spodní prádlo na „pracovním“ těle** | AI se posílá tělo v jasně zeleném tílku a šortkách (jen pro kreslení, nikdy se neukáže). Co zůstane zelené = není kus. | 1 volání AI, 3 h | odpadne většina filtrů (šedé tílko vs. šedý / bílý / béžový kus) | nové tělo = nová kalibrace |
| 4 | **Barevné pozadí** | Pozadí pracovního těla jednolitá výrazná barva (např. purpurová). | zdarma, s bodem 3 | jednoduché oddělení kusu od pozadí, bílé kusy bez děr | AI barvu občas „rozlije“ na okraj |
| 5 | **Pevné ruce** | AI nesmí měnit paže vůbec (maska bez paží), rukávy se kreslí přes ně. | zdarma, 1 h | žádné dvojité / posunuté ruce, žádná maska mazání | rukávy můžou být užší / méně přirozené |
| 6 | **2 varianty, vybrat lepší** | AI vrátí 2 obrázky najednou, skript vybere ten s čistší vrstvou. | ~1,7× cena | méně nepovedených kusů | dražší |
| 7 | **Vyšší kvalita** | `quality: high`. | ~2–3× cena | detailnější, věrnější kus | dražší, pomalejší |

**Doporučení:** 1 + 2 hned (zdarma, ochrana před regresemi), pak 3 + 4 + 5 jako jeden krok (zjednoduší výřez z ~10 pravidel na 2–3). 6 a 7 až podle výsledků.

### Doplněk 30. 10. – „formička“ místo celého avatara

Nápad (Martin): neposílat AI celého avatara, ale šablonu, do které kus napasuje – výstup bude vždy ve stejném formátu a sedne na postavu.

| # | Možnost | Co to je | Cena / práce | Plus | Minus |
| --- | --- | --- | --- | --- | --- |
| A | **Silueta (formička)** | Na jednobarevném pozadí jen obrys oblasti kusu (např. tvar trička v póze avatara). AI do něj nakreslí kus „ghost mannequin“ stylem. | levnější (menší obrázek), 1 den | čistý výstup: kus na pozadí, žádné ruce / kůže / tílko → výřez = jen odstranit pozadí | bez těla chybí stínování a záhyby podle postavy; AI obrys nemusí přesně dodržet → posun / deformace |
| B | **Figurína** | Tělo avatara přebarvené na jednolitou barvu (bez kůže, obličeje, prádla), stejná póza; pozadí jiná jednolitá barva. AI obléká figurínu. | 1 volání AI na figurínu, 1 den | kus sedí na tvar těla jako dnes, výřez = „vše, co není barva figuríny ani pozadí“ (2 pravidla místo ~10) | ruce stále můžou být posunuté (řeší maska bez paží) |
| C | **Výřez jen zóny** | AI se pošle jen výřez obrázku kolem zóny (např. trup 512×512 u trička, chodidla u bot), výsledek se vrátí na místo. | zdarma, půl dne | levnější výstup (menší obrázek), AI nevidí a nemění zbytek těla | u velkých kusů (kabát, šaty) skoro žádná úspora |

**Doporučení:** B + C (+ pevné paže z bodu 5). Figurína dá skoro stejně čistý výstup jako formička, ale kus se pořád kreslí na tvar těla, takže sedí. Čistá formička (A) je nejjednodušší na výřez, ale riziko, že kus na postavě nesedí, je největší – dá se vyzkoušet jako pokus na 3 kusech.
