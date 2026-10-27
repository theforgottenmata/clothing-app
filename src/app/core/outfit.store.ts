import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AvatarStore } from './avatar.store';
import { catalogLayer, CATEGORY_Z, CATEGORY_ZONE, fitLayer } from './body-map';
import { FitService } from './fit.service';
import { Outfit, OutfitLayer, uid, WardrobeItem } from './models';
import { SEED_OUTFIT } from './seed';
import { StorageService } from './storage.service';
import { WardrobeStore } from './wardrobe.store';

@Injectable({ providedIn: 'root' })
export class OutfitStore {
  private readonly storage = inject(StorageService);
  private readonly wardrobe = inject(WardrobeStore);
  private readonly avatar = inject(AvatarStore);
  private readonly fit = inject(FitService);

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
      this.layers.set(SEED_OUTFIT.map((id) => byId.get(id)).filter((i) => !!i).map((i) => this.layerFor(i!)));
    }
    this.loaded = true;
  }

  isWorn(itemId: string): boolean {
    return this.wornIds().has(itemId);
  }

  /**
   * Oblékne kus (nebo ho jen vybere, pokud už je na avatarovi).
   * V každé zóně těla (vršek, spodek, boty, doplňky) je vždy jen jeden kus – nový nahradí předchozí.
   */
  wear(item: WardrobeItem): void {
    if (this.isWorn(item.id)) {
      this.selectedId.set(item.id);
      return;
    }
    const zone = CATEGORY_ZONE[item.category];
    this.layers.update((layers) => {
      const kept = layers.filter((l) => {
        const cat = this.wardrobe.byId().get(l.itemId)?.category;
        return !cat || CATEGORY_ZONE[cat] !== zone;
      });
      return [...kept, this.layerFor(item)];
    });
    this.selectedId.set(item.id);
    this.dress(item);
  }

  /**
   * Kus ještě nemá verzi na aktuální tělo → AI ho oblékne (jednou, pak je uložený).
   * Do té doby je na avatarovi katalogový obrázek; po dokončení se vrstva vymění.
   */
  private dress(item: WardrobeItem, retry = false): void {
    if (!retry && (this.fit.has(item) || !this.fit.canDress(item))) return;
    const body = this.avatar.id();
    this.fit.ensure(item, retry).then((updated) => {
      if (!updated || this.avatar.id() !== body || !this.isWorn(item.id)) return;
      this.layers.update((ls) => ls.map((l) => (l.itemId === item.id ? this.layerFor(updated) : l)));
    });
  }

  /** Přepočítá vrstvy z verzí na postavu (po přepočtu výřezu se mohla změnit poloha). */
  relayout(): void {
    const byId = this.wardrobe.byId();
    this.layers.update((ls) =>
      ls.map((l) => {
        const item = byId.get(l.itemId);
        return item && l.mode === 'fit' && l.body ? this.layerFor(item) : l;
      }),
    );
  }

  /** Znovu vygenerovat verzi kusu na postavu (placené volání AI). */
  redress(item: WardrobeItem): void {
    this.dress(item, true);
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

  /** Oblečené kusy z ostatních zón – kontext pro editor umístění. */
  contextFor(item: WardrobeItem): OutfitLayer[] {
    const zone = CATEGORY_ZONE[item.category];
    return this.layers().filter((l) => {
      if (l.itemId === item.id) return false;
      const cat = this.wardrobe.byId().get(l.itemId)?.category;
      return cat && CATEGORY_ZONE[cat] !== zone;
    });
  }

  /** Po změně kusu (umístění, typ) přepočítá jeho vrstvu, pokud je na avatarovi. */
  refresh(item: WardrobeItem): void {
    if (!this.isWorn(item.id)) return;
    this.remove(item.id);
    this.wear(item);
    this.selectedId.set(null);
  }

  /** Nahradí celý stav (import zálohy). */
  async replaceAll(current: OutfitLayer[], saved: Outfit[]): Promise<void> {
    this.layers.set(current);
    this.saved.set(saved);
    this.selectedId.set(null);
    await this.storage.setOutfits(saved);
    await this.storage.setCurrentOutfit(current);
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

  /** Výchozí vrstva kusu: verze na aktuální tělo → uložené umístění → starší verze na postavu → mapa těla. */
  layerFor(item: WardrobeItem, opts: { ignorePlacement?: boolean } = {}): OutfitLayer {
    const z = CATEGORY_Z[item.category];
    // Verze na postavu pro aktuální tělo (z AI) – sedí přesně, ruční umístění se nepoužije.
    const body = this.avatar.id();
    const fit = item.fits?.[body];
    if (fit) return { ...fitLayer(item.id, z, fit.box), body };
    if (item.placement && !opts.ignorePlacement) return { itemId: item.id, mode: item.hasFit ? 'fit' : 'catalog', ...item.placement, z };
    if (item.hasFit) return fitLayer(item.id, z, item.fitBox);
    const size = item.catalogSize ?? { w: 600, h: 600 };
    return catalogLayer(item.id, item.category, size.w, size.h, z);
  }
}
