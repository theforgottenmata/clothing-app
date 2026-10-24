# AI Wardrobe (clothing-app)

Osobní digitální šatník: nahraješ fotku oblečení, AI z ní udělá ilustraci ve stylu 3D cartoon avatara a avatara v ní oblečeš.

**Stav:** fáze návrhu dokončena, kód aplikace zatím nevznikl. Dalším krokem je vygenerovat Angular prototyp.

## Kde co je

| Cesta | Obsah |
|---|---|
| `docs/rozhodnuti.md` | Všechna dohodnutá rozhodnutí: stack, vzhled (Glass · Grafit), pipeline AI, pravidla vrstev |
| `docs/design-source/` | Zdrojové soubory obrazovek z návrhu (směr F). Obrázky v nich odkazují na úložiště návrhu, slouží jako reference rozložení a stylů |
| `design-assets/avatar/avatar.png` | Avatar 688×1024 se šedým pozadím (originál z Higgsfieldu) |
| `design-assets/avatar/avatar-transparent.png` | Avatar s odstraněným pozadím pro glass UI |
| `design-assets/clothes/` | Katalogové verze 6 kusů (3D cartoon styl, průhledné pozadí) |
| `design-assets/clothes-fit/` | Verze na postavu (688×1024, průhledné), přesně sedí přes avatara na pozici 0,0 |

## Návrh

Interaktivní návrh všech obrazovek je na plátně Claude Design:
https://claude.ai/artifact/XkxxPENUqUhkJ6aczpuUSj

Platná je řada **F · Glassmorphism** (paleta Grafit) a **F · Přidání kusu**. Řady A–E jsou starší varianty.

## Výchozí šatník

| Kus | Kategorie | Katalog | Na postavu |
|---|---|---|---|
| Bílé tričko | Topy | `clothes/tricko-bile.png` | `clothes-fit/tricko-bile-fit.png` |
| Krémová mikina | Topy | `clothes/mikina-kremova.png` | `clothes-fit/mikina-kremova-fit.png` |
| Hnědá bunda | Svrchní | `clothes/bunda-hneda.png` | `clothes-fit/bunda-hneda-fit.png` |
| Hnědé kalhoty | Spodky (dlouhé) | `clothes/kalhoty-hnede.png` | `clothes-fit/kalhoty-hnede-fit.png` |
| Černé džíny | Spodky (dlouhé) | `clothes/dziny-cerne.png` | `clothes-fit/dziny-cerne-fit.png` |
| Bílé tenisky | Boty | `clothes/tenisky-bile.png` | `clothes-fit/tenisky-bile-fit.png` |

Pořadí vrstev při skládání: avatar → boty → spodky → topy → svrchní → doplňky.
