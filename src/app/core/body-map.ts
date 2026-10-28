import { Category, OutfitLayer } from './models';

/** Logický rozměr avatara – všechny vrstvy a verze na postavu používají tento prostor. */
export const AVATAR_W = 688;
export const AVATAR_H = 1024;

/** Záložní avatar, než se načte knihovna těl (výchozí tělo: muž, M, střední pleť). */
export const AVATAR_URL = 'seed/avatars/male-M-medium-transparent.webp';

/**
 * Pořadí vrstev: avatar → boty → spodky → šaty → topy → svrchní → doplňky.
 * Dlouhé spodky jsou vždy nad botami (lem se překládá přes boty).
 */
export const CATEGORY_Z: Record<Category, number> = {
  shoes: 100,
  bottom: 200,
  dress: 250,
  top: 300,
  outerwear: 400,
  accessory: 500,
};

/** Zóny těla – v každé zóně může být na avatarovi vždy jen jeden kus. */
export type Zone = 'upper' | 'lower' | 'feet' | 'accessory';
/** Zóny, které kus zabírá – šaty a overaly vršek i spodek (sundají top, bundu i kalhoty). */
export const CATEGORY_ZONES: Record<Category, Zone[]> = {
  top: ['upper'],
  outerwear: ['upper'],
  bottom: ['lower'],
  dress: ['upper', 'lower'],
  shoes: ['feet'],
  accessory: ['accessory'],
};
/** Dva kusy se na avatarovi vylučují, když sdílí aspoň jednu zónu. */
export function zonesOverlap(a: Category, b: Category): boolean {
  return CATEGORY_ZONES[a].some((z) => CATEGORY_ZONES[b].includes(z));
}
/** Hlavní zóna kusu (pro starší kód). */
export const CATEGORY_ZONE: Record<Category, Zone> = {
  top: 'upper',
  outerwear: 'upper',
  bottom: 'lower',
  dress: 'upper',
  shoes: 'feet',
  accessory: 'accessory',
};

/**
 * Mapa těla avatara – oblasti pro automatické umístění katalogové verze,
 * když kus ještě nemá verzi na postavu.
 */
export const BODY_BOX: Record<Category, { x: number; y: number; w: number; h: number }> = {
  top: { x: 165, y: 200, w: 358, h: 360 },
  bottom: { x: 222, y: 470, w: 244, h: 495 },
  dress: { x: 165, y: 200, w: 358, h: 620 },
  outerwear: { x: 158, y: 195, w: 372, h: 385 },
  shoes: { x: 205, y: 885, w: 278, h: 110 },
  accessory: { x: 252, y: 4, w: 184, h: 120 },
};

export function fitLayer(
  itemId: string,
  z: number,
  box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: AVATAR_W, h: AVATAR_H },
): OutfitLayer {
  return { itemId, mode: 'fit', x: box.x, y: box.y, w: box.w, h: box.h, scale: 1, rotation: 0, z };
}

/** Umístí obrázek (přirozená velikost natW×natH) do oblasti kategorie se zachováním poměru stran. */
export function catalogLayer(
  itemId: string,
  category: Category,
  natW: number,
  natH: number,
  z: number,
): OutfitLayer {
  const box = BODY_BOX[category];
  const ratio = Math.min(box.w / natW, box.h / natH);
  const w = Math.round(natW * ratio);
  const h = Math.round(natH * ratio);
  return {
    itemId,
    mode: 'catalog',
    x: Math.round(box.x + (box.w - w) / 2),
    y: Math.round(box.y + (box.h - h) / 2),
    w,
    h,
    scale: 1,
    rotation: 0,
    z,
  };
}
