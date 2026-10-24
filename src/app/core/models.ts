export type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
export type BottomLength = 'long' | 'short';

export const CATEGORIES: Category[] = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'];

export const CATEGORY_LABEL: Record<Category, string> = {
  top: 'Topy',
  bottom: 'Spodky',
  outerwear: 'Svrchní',
  shoes: 'Boty',
  accessory: 'Doplňky',
};

export const COLORS: { label: string; hex: string }[] = [
  { label: 'Černá', hex: '#1F2328' },
  { label: 'Šedá', hex: '#9FA3A7' },
  { label: 'Bílá', hex: '#FFFFFF' },
  { label: 'Béžová', hex: '#C9B49A' },
  { label: 'Hnědá', hex: '#7A5236' },
  { label: 'Zelená', hex: '#4F7A55' },
  { label: 'Modrá', hex: '#3A6FB0' },
  { label: 'Červená', hex: '#B5432E' },
];
export const SEASONS = ['Jaro', 'Léto', 'Podzim', 'Zima'];
export const WEATHER = ['Slunce', 'Zataženo', 'Déšť', 'Vítr', 'Sníh'];
export const OCCASIONS = ['Ven', 'Práce', 'Sport', 'Rande', 'Doma'];

export interface WardrobeItem {
  id: string;
  name: string;
  category: Category;
  bottomLength?: BottomLength;
  color?: string;
  seasons: string[];
  weather: string[];
  occasions: string[];
  /** 'ai' = ilustrace ve stylu avatara, 'photo' = původní fotka (fallback) */
  catalogSource: 'ai' | 'photo';
  /** existuje verze na postavu (vyříznutá z oblečeného avatara, poloha viz fitBox) */
  hasFit: boolean;
  /** oblast verze na postavu v souřadnicích avatara (obrázek je oříznutý na tuto oblast) */
  fitBox?: { x: number; y: number; w: number; h: number };
  /** přirozená velikost katalogového obrázku (pro automatické umístění) */
  catalogSize?: { w: number; h: number };
  favorite: boolean;
  createdAt: number;
}

/** Vrstva oblečení na avatarovi – souřadnice v logickém prostoru avatara (688×1024). */
export interface OutfitLayer {
  itemId: string;
  mode: 'fit' | 'catalog';
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  rotation: number;
  z: number;
}

export interface Outfit {
  id: string;
  name: string;
  occasion?: string;
  layers: OutfitLayer[];
  createdAt: number;
}

export type ImageKind = 'photo' | 'catalog' | 'fit';

export function uid(): string {
  return crypto.randomUUID();
}
