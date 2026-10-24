import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { catalogLayer, CATEGORY_Z, fitLayer } from './body-map';
import { Outfit, OutfitLayer, uid, WardrobeItem } from './models';
import { SEED_OUTFIT } from './seed';
import { StorageService } from './storage.service';
import { WardrobeStore } from './wardrobe.store';

@Injectable({ providedIn: 'root' })
export class OutfitStore {
  private readonly storage = inject(StorageService);
  private readonly wardrobe = inject(WardrobeStore);

  /** Vrstvy aktuálně oblečené na avatarovi. */
  readonly layers = signal<OutfitLayer[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly saved = signal<Outfit[]>([]);

  readonly sortedLayers = computed(() => [...this.layers()].sort((a, b) => a.z - b.z));
  readonly wornIds = computed(() => new Set(this.layers().map((l) => l.itemId)));
  readonly selectedLayer = computed(() => this.layers().find((l) => l.itemId === this.selectedId()) ?? null);
  readonly selectedItem = computed(() => {
    const id = this.selectedId();
    return id ? (this.wardrobe.byId().get(id) ?? null) : null;
  });

  private loaded = false;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Automatické ukládání pozic (debounce 300 ms).
    effect(() => {
      const layers = this.layers();
      if (!this.loaded) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.storage.setCurrentOutfit(layers), 300);
    });
    // Když se kus smaže ze šatníku, sundá se i z avatara.
    effect(() => {
      const ids = this.wardrobe.byId();
      const layers = untracked(this.layers);
      if (layers.some((l) => !ids.has(l.itemId))) this.layers.set(layers.filter((l) => ids.has(l.itemId)));
    });
  }

  async init(seeded: boolean): Promise<void> {
    const [current, saved] = await Promise.all([this.storage.getCurrentOutfit(), this.storage.getOutfits()]);
    this.saved.set(saved ?? []);
    if (current) {
      this.layers.set(current);
    } else if (seeded) {
      const byId = this.wardrobe.byId();
      this.layers.set(SEED_OUTFIT.map((id) => byId.get(id)).filter((i) => !!i).map((i) => this.createLayer(i!)));
    }
    this.loaded = true;
  }

  isWorn(itemId: string): boolean {
    return this.wornIds().has(itemId);
  }

  /** Oblékne kus (nebo ho jen vybere, pokud už je na avatarovi). Kus stejné kategorie (kromě doplňků) nahradí. */
  wear(item: WardrobeItem): void {
    if (this.isWorn(item.id)) {
      this.selectedId.set(item.id);
      return;
    }
    const replaceSameSlot = item.category !== 'accessory';
    this.layers.update((layers) => {
      const kept = replaceSameSlot
        ? layers.filter((l) => this.wardrobe.byId().get(l.itemId)?.category !== item.category)
        : layers;
      return [...kept, this.createLayer(item)];
    });
    this.selectedId.set(item.id);
  }

  toggle(item: WardrobeItem): void {
    if (this.isWorn(item.id) && this.selectedId() === item.id) this.remove(item.id);
    else this.wear(item);
  }

  remove(itemId: string): void {
    this.layers.update((ls) => ls.filter((l) => l.itemId !== itemId));
    if (this.selectedId() === itemId) this.selectedId.set(null);
  }

  clear(): void {
    this.layers.set([]);
    this.selectedId.set(null);
  }

  select(itemId: string | null): void {
    this.selectedId.set(itemId);
  }

  updateLayer(itemId: string, patch: Partial<OutfitLayer>): void {
    this.layers.update((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));
  }

  /** Vrátí kus na výchozí pozici (verze na postavu na 0,0, jinak podle mapy těla). */
  resetLayer(itemId: string): void {
    const item = this.wardrobe.byId().get(itemId);
    const layer = this.layers().find((l) => l.itemId === itemId);
    if (!item || !layer) return;
    const fresh = this.createLayer(item);
    this.updateLayer(itemId, { ...fresh, z: layer.z });
  }

  /** Posune vrstvu o jednu pozici dopředu (+1) nebo dozadu (−1). */
  move(itemId: string, dir: 1 | -1): void {
    const sorted = this.sortedLayers();
    const i = sorted.findIndex((l) => l.itemId === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i];
    const b = sorted[j];
    this.layers.update((ls) =>
      ls.map((l) => (l.itemId === a.itemId ? { ...l, z: b.z } : l.itemId === b.itemId ? { ...l, z: a.z } : l)),
    );
  }

  async saveCurrent(name: string, occasion?: string): Promise<Outfit> {
    const outfit: Outfit = { id: uid(), name, occasion, layers: this.layers(), createdAt: Date.now() };
    this.saved.update((s) => [outfit, ...s]);
    await this.storage.setOutfits(this.saved());
    return outfit;
  }

  load(outfit: Outfit): void {
    const ids = this.wardrobe.byId();
    this.layers.set(outfit.layers.filter((l) => ids.has(l.itemId)).map((l) => ({ ...l })));
    this.selectedId.set(null);
  }

  async deleteSaved(id: string): Promise<void> {
    this.saved.update((s) => s.filter((o) => o.id !== id));
    await this.storage.setOutfits(this.saved());
  }

  private createLayer(item: WardrobeItem): OutfitLayer {
    const sameCat = this.layers().filter((l) => this.wardrobe.byId().get(l.itemId)?.category === item.category).length;
    const z = CATEGORY_Z[item.category] + sameCat;
    if (item.hasFit) return fitLayer(item.id, z, item.fitBox);
    const size = item.catalogSize ?? { w: 600, h: 600 };
    return catalogLayer(item.id, item.category, size.w, size.h, z);
  }
}
