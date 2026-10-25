import { Injectable } from '@angular/core';
import { createStore, del, get, set, UseStore } from 'idb-keyval';
import { ImageKind, Outfit, OutfitLayer, WardrobeItem } from './models';

/** Lokální úložiště v IndexedDB – metadata jako JSON, obrázky jako Blob. Žádný backend. */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly db: UseStore = createStore('ai-wardrobe', 'kv');

  getItems(): Promise<WardrobeItem[] | undefined> {
    return get('items', this.db);
  }
  setItems(items: WardrobeItem[]): Promise<void> {
    return set('items', items, this.db);
  }

  getImage(id: string, kind: ImageKind): Promise<Blob | undefined> {
    return get(`img:${id}:${kind}`, this.db);
  }
  setImage(id: string, kind: ImageKind, blob: Blob): Promise<void> {
    return set(`img:${id}:${kind}`, blob, this.db);
  }
  async deleteImages(id: string): Promise<void> {
    await Promise.all((['photo', 'catalog', 'fit'] as ImageKind[]).map((k) => del(`img:${id}:${k}`, this.db)));
  }

  getCurrentOutfit(): Promise<OutfitLayer[] | undefined> {
    return get('outfit:current', this.db);
  }
  setCurrentOutfit(layers: OutfitLayer[]): Promise<void> {
    return set('outfit:current', layers, this.db);
  }

  getOutfits(): Promise<Outfit[] | undefined> {
    return get('outfits', this.db);
  }
  setOutfits(outfits: Outfit[]): Promise<void> {
    return set('outfits', outfits, this.db);
  }

  /** Obecné hodnoty (avatar apod.). */
  getValue<T>(key: string): Promise<T | undefined> {
    return get(key, this.db);
  }
  setValue(key: string, value: unknown): Promise<void> {
    return set(key, value, this.db);
  }
  deleteValue(key: string): Promise<void> {
    return del(key, this.db);
  }
}
