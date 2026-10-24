# Copilot instructions

Plné pokyny k projektu (architektura, konvence, pravidla domény, AI pipeline) jsou v [`CLAUDE.md`](../CLAUDE.md) v kořeni repa – drž se jich. Nejdůležitější:

- Angular 22: standalone, zoneless, signals, OnPush, `@if`/`@for`, lazy routes. Žádné NgModules.
- Tailwind 4 s tokeny v `src/styles.css` (glassmorphism, paleta Grafit: ink #1f2328, ink-2 #3b414a, mist #9fa3a7, line #cfd4d8, paper #f4f6f8). UI texty česky.
- Prostor avatara 688×1024; jeden kus na zónu těla; pořadí vrstev boty → spodky → topy → svrchní → doplňky.
- Na obrazovce Vyzkoušet se oblečení neposouvá; umístění se ladí jen při přidání kusu a v detailu kusu.
- API klíče AI nikdy do frontendu ani do repa.
- Po změně ověř `npx ng build`.
