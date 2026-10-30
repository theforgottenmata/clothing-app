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
