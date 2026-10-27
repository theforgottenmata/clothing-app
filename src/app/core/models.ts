export type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
export type BottomLength = 'long' | 'short';
/** Kam kus na těle sahá (z analýzy) – podle toho AI kreslí kus na avatara. */
export type Reach = 'head' | 'neck' | 'waist' | 'hip' | 'thigh' | 'knee' | 'calf' | 'ankle';
export const REACHES: Reach[] = ['head', 'neck', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'];

/** Verze kusu na konkrétní tělo avatara (vrstva oříznutá na `box`, případně maska mazání avatara pod kusem). */
export interface FitInfo {
  box: { x: number; y: number; w: number; h: number };
  erase: boolean;
  /** verze výřezu vrstvy (po vylepšení se přepočítá zdarma z uloženého výstupu AI) */
  v?: number;
}

export type PhotoMode = 'flat_lay' | 'hanger' | 'on_person' | 'mannequin' | 'other';

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

export interface ClothingAttributes {
  subtype?: string;
  secondaryColors: string[];
  fit?: string;
  length?: string;
  sleeveLength?: string;
  legShape?: string;
  material?: string;
  pattern?: string;
  details: string[];
  containsPerson: boolean;
  photoMode: PhotoMode;
  confidence?: number;
}

export interface WardrobeItem {
  id: string;
  name: string;
  category: Category;
  bottomLength?: BottomLength;
  reach?: Reach;
  color?: string;
  attributes?: ClothingAttributes;
  seasons: string[];
  weather: string[];
  occasions: string[];
  /** 'ai' = ilustrace ve stylu avatara, 'photo' = původní fotka (fallback) */
  catalogSource: 'ai' | 'photo';
  /** verze na postavu podle těla avatara (id těla → poloha); obrázky `fit:<tělo>` a `erase:<tělo>` */
  fits?: Record<string, FitInfo>;
  /** starší jediná verze na postavu (výchozí kusy), poloha viz fitBox */
  hasFit: boolean;
  /** oblast verze na postavu v souřadnicích avatara (obrázek je oříznutý na tuto oblast) */
  fitBox?: { x: number; y: number; w: number; h: number };
  /** umístění na avatarovi nastavené při nahrání (použije se při každém oblečení) */
  placement?: Placement;
  /** přirozená velikost katalogového obrázku (pro automatické umístění) */
  catalogSize?: { w: number; h: number };
  favorite: boolean;
  createdAt: number;
}

/** Poloha a velikost kusu v prostoru avatara (688×1024). */
export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  rotation: number;
}

/** Vrstva oblečení na avatarovi – souřadnice v logickém prostoru avatara (688×1024). */
export interface OutfitLayer {
  itemId: string;
  mode: 'fit' | 'catalog';
  /** u verze na postavu: pro které tělo avatara (bez = starší jediná verze) */
  body?: string;
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

export type ImageKind = 'photo' | 'catalog' | 'fit' | `fit:${string}` | `erase:${string}`;

export function uid(): string {
  return crypto.randomUUID();
}
