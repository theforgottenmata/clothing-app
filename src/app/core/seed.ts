import { WardrobeItem } from './models';

/** Výchozí šatník – obrázky leží v design-assets/ a při buildu se kopírují do /seed. */
export interface SeedItem {
  meta: Omit<WardrobeItem, 'createdAt'>;
  catalog: string;
  fit: string;
}

const base = (id: string, rest: Partial<WardrobeItem> & Pick<WardrobeItem, 'name' | 'category'>) => ({
  id,
  seasons: [],
  weather: [],
  occasions: [],
  catalogSource: 'ai' as const,
  hasFit: true,
  favorite: false,
  ...rest,
});

export const SEED_ITEMS: SeedItem[] = [
  {
    meta: base('seed-tricko', { name: 'Bílé tričko', category: 'top', color: 'Bílá', seasons: ['Jaro', 'Léto'], weather: ['Slunce'], occasions: ['Ven', 'Doma'], favorite: true }),
    catalog: 'seed/clothes/tricko-bile.png',
    fit: 'seed/clothes-fit/tricko-bile-fit.png',
  },
  {
    meta: base('seed-mikina', { name: 'Krémová mikina', category: 'top', color: 'Béžová', seasons: ['Podzim', 'Zima'], weather: ['Zataženo'], occasions: ['Doma', 'Ven'] }),
    catalog: 'seed/clothes/mikina-kremova.png',
    fit: 'seed/clothes-fit/mikina-kremova-fit.png',
  },
  {
    meta: base('seed-bunda', { name: 'Hnědá bunda', category: 'outerwear', color: 'Hnědá', seasons: ['Jaro', 'Podzim'], weather: ['Zataženo', 'Vítr'], occasions: ['Ven', 'Práce'] }),
    catalog: 'seed/clothes/bunda-hneda.png',
    fit: 'seed/clothes-fit/bunda-hneda-fit.png',
  },
  {
    meta: base('seed-kalhoty', { name: 'Hnědé kalhoty', category: 'bottom', bottomLength: 'long', color: 'Hnědá', seasons: ['Jaro', 'Podzim'], occasions: ['Ven', 'Práce'] }),
    catalog: 'seed/clothes/kalhoty-hnede.png',
    fit: 'seed/clothes-fit/kalhoty-hnede-fit.png',
  },
  {
    meta: base('seed-dziny', { name: 'Černé džíny', category: 'bottom', bottomLength: 'long', color: 'Černá', seasons: ['Jaro', 'Podzim', 'Zima'], occasions: ['Ven', 'Práce'] }),
    catalog: 'seed/clothes/dziny-cerne.png',
    fit: 'seed/clothes-fit/dziny-cerne-fit.png',
  },
  {
    meta: base('seed-tenisky', { name: 'Bílé tenisky', category: 'shoes', color: 'Bílá', seasons: ['Jaro', 'Léto', 'Podzim'], weather: ['Slunce', 'Zataženo'], occasions: ['Ven', 'Sport'], favorite: true }),
    catalog: 'seed/clothes/tenisky-bile.png',
    fit: 'seed/clothes-fit/tenisky-bile-fit.png',
  },
];

/** Výchozí outfit při prvním spuštění. */
export const SEED_OUTFIT = ['seed-tenisky', 'seed-kalhoty', 'seed-tricko'];
