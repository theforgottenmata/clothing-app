import { computed, inject, Injectable, signal } from '@angular/core';
import { AvatarStore } from './avatar.store';
import { blobSize, trimToContent } from './image-utils';
import { ImageKind, OutfitLayer, WardrobeItem } from './models';
import { SEED_ITEMS } from './seed';
import { StorageService } from './storage.service';

type UrlMap = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class WardrobeStore {
  private readonly storage = inject(StorageService);
  private readonly avatar = inject(AvatarStore);

  readonly items = signal<WardrobeItem[]>([]);
  private readonly urls = signal<UrlMap>({});

  readonly byId = computed(() => new Map(this.items().map((i) => [i.id, i])));

  /** Načte šatník z IndexedDB; při prvním spuštění ho naplní výchozími kusy. Vrací true, pokud proběhl seed. */
  async init(): Promise<boolean> {
    let items = await this.storage.getItems();
    let seeded = false;
    if (!items) {
      items = await this.seed();
      seeded = true;
    }
    const urls: UrlMap = {};
    for (const item of items) {
      for (const kind of viewKinds(item)) {
        const blob = await this.storage.getImage(item.id, kind);
        if (blob) urls[key(item.id, kind)] = URL.createObjectURL(blob);
      }
    }
    this.urls.set(urls);
    this.items.set(items);
    return seeded;
  }

  url(id: string, kind: ImageKind): string | undefined {
    return this.urls()[key(id, kind)];
  }

  /** Náhled kusu v šatníku a na Vyzkoušet: kus tak, jak je na postavě; dokud není, výřez z fotky. */
  thumbUrl(item: WardrobeItem): string | undefined {
    return this.fitThumbUrl(item) ?? this.url(item.id, 'catalog');
  }

  /** Kus tak, jak je na avatarovi (aktuální tělo, jinak jakékoli) – pro detail kusu. */
  fitThumbUrl(item: WardrobeItem): string | undefined {
    const bodies = Object.keys(item.fits ?? {});
    const body = bodies.includes(this.avatar.id()) ? this.avatar.id() : bodies[0];
    return body ? this.url(item.id, `thumb:${body}`) || this.url(item.id, `fit:${body}`) : undefined;
  }

  /** Obrázek vrstvy na avatarovi: verze na postavu pro dané tělo, starší verze na postavu, nebo katalog. */
  layerUrl(l: OutfitLayer): string | undefined {
    if (l.mode !== 'fit') return this.url(l.itemId, 'catalog');
    return this.url(l.itemId, l.body ? `fit:${l.body}` : 'fit');
  }

  /** Maska mazání avatara pod kusem (kde AI posunula ruce apod.), jen u verze na postavu. */
  eraseUrl(l: OutfitLayer): string | undefined {
    return l.mode === 'fit' && l.body ? this.url(l.itemId, `erase:${l.body}`) : undefined;
  }

  /** Smaže verze na postavu (např. po změně typu kusu – AI ho musí obléct znovu). */
  async clearFits(id: string): Promise<void> {
    const item = this.byId().get(id);
    if (!item?.fits) return;
    const kinds = viewKinds(item).filter((k) => k.includes(':'));
    const next: UrlMap = { ...this.urls() };
    for (const kind of kinds) {
      const k = key(id, kind);
      if (next[k]) URL.revokeObjectURL(next[k]);
      delete next[k];
    }
    await this.storage.deleteImages(id, kinds);
    this.urls.set(next);
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, fits: undefined } : i)));
    await this.storage.setItems(this.items());
  }

  /** Uloží verzi kusu na tělo avatara (vrstva se ořízne na obsah). */
  async setFit(id: string, body: string, layer: Blob, erase: Blob | null, v?: number, thumb: Blob | null = null): Promise<WardrobeItem | undefined> {
    const item = this.byId().get(id);
    if (!item) return undefined;
    const trimmed = await trimToContent(layer);
    const thumbTrimmed = thumb ? (await trimToContent(thumb)).blob : null;
    const next: UrlMap = { ...this.urls() };
    const put = async (kind: ImageKind, blob: Blob | null) => {
      const k = key(id, kind);
      if (next[k]) URL.revokeObjectURL(next[k]);
      delete next[k];
      if (blob) {
        await this.storage.setImage(id, kind, blob);
        next[k] = URL.createObjectURL(blob);
      }
    };
    await put(`fit:${body}`, trimmed.blob);
    await put(`erase:${body}`, erase);
    await put(`thumb:${body}`, thumbTrimmed);
    this.urls.set(next);
    const updated: WardrobeItem = { ...item, fits: { ...item.fits, [body]: { box: trimmed.box, erase: !!erase, v } } };
    this.items.update((list) => list.map((i) => (i.id === id ? updated : i)));
    await this.storage.setItems(this.items());
    return updated;
  }

  async add(meta: WardrobeItem, images: Partial<Record<ImageKind, Blob>>): Promise<void> {
    if (images.fit && !meta.fitBox) {
      const trimmed = await trimToContent(images.fit);
      images = { ...images, fit: trimmed.blob };
      meta = { ...meta, fitBox: trimmed.box };
    }
    const next: UrlMap = { ...this.urls() };
    for (const [kind, blob] of Object.entries(images) as [ImageKind, Blob][]) {
      await this.storage.setImage(meta.id, kind, blob);
      if (kind !== 'photo') next[key(meta.id, kind)] = URL.createObjectURL(blob);
    }
    if (images.catalog && !meta.catalogSize) meta = { ...meta, catalogSize: await blobSize(images.catalog) };
    this.urls.set(next);
    this.items.update((list) => [meta, ...list]);
    await this.storage.setItems(this.items());
  }

  /** Původní fotka se drží jen v IndexedDB – načte se na vyžádání. */
  async photoUrl(id: string): Promise<string | undefined> {
    const blob = await this.storage.getImage(id, 'photo');
    return blob ? URL.createObjectURL(blob) : undefined;
  }

  /** Nahradí celý šatník (import zálohy). */
  async replaceAll(items: WardrobeItem[], images: Record<string, Partial<Record<ImageKind, Blob>>>): Promise<void> {
    for (const old of this.items()) await this.storage.deleteImages(old.id, viewKinds(old));
    for (const u of Object.values(this.urls())) URL.revokeObjectURL(u);
    const urls: UrlMap = {};
    for (const item of items) {
      for (const [kind, blob] of Object.entries(images[item.id] ?? {}) as [ImageKind, Blob][]) {
        await this.storage.setImage(item.id, kind, blob);
        if (kind !== 'photo') urls[key(item.id, kind)] = URL.createObjectURL(blob);
      }
    }
    await this.storage.setItems(items);
    this.urls.set(urls);
    this.items.set(items);
  }

  async update(id: string, patch: Partial<WardrobeItem>): Promise<void> {
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await this.storage.setItems(this.items());
  }

  async remove(id: string): Promise<void> {
    const item = this.byId().get(id);
    const kinds = item ? viewKinds(item) : (['catalog', 'fit'] as ImageKind[]);
    const next: UrlMap = { ...this.urls() };
    for (const kind of kinds) {
      const k = key(id, kind);
      if (next[k]) URL.revokeObjectURL(next[k]);
      delete next[k];
    }
    this.urls.set(next);
    this.items.update((list) => list.filter((i) => i.id !== id));
    await this.storage.deleteImages(id, kinds);
    await this.storage.setItems(this.items());
  }

  private async seed(): Promise<WardrobeItem[]> {
    const now = Date.now();
    const items: WardrobeItem[] = [];
    for (const [i, s] of SEED_ITEMS.entries()) {
      const [catalog, fitFull] = await Promise.all([fetchBlob(s.catalog), fetchBlob(s.fit)]);
      const fit = await trimToContent(fitFull);
      await this.storage.setImage(s.meta.id, 'catalog', catalog);
      await this.storage.setImage(s.meta.id, 'fit', fit.blob);
      items.push({ ...s.meta, catalogSize: await blobSize(catalog), fitBox: fit.box, createdAt: now - i });
    }
    await this.storage.setItems(items);
    return items;
  }
}

/** Obrázky kusu, které se zobrazují (bez původní fotky): katalog + verze na postavu pro každé tělo. */
export function viewKinds(item: WardrobeItem): ImageKind[] {
  const kinds: ImageKind[] = ['catalog', 'fit'];
  for (const body of Object.keys(item.fits ?? {})) kinds.push(`fit:${body}`, `erase:${body}`, `thumb:${body}`);
  return kinds;
}

function key(id: string, kind: ImageKind): string {
  return `${id}:${kind}`;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Výchozí obrázek chybí: ${url}`);
  return res.blob();
}
