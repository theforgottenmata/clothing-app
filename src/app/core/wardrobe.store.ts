import { computed, inject, Injectable, signal } from '@angular/core';
import { blobSize, trimToContent } from './image-utils';
import { ImageKind, WardrobeItem } from './models';
import { SEED_ITEMS } from './seed';
import { StorageService } from './storage.service';

type UrlMap = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class WardrobeStore {
  private readonly storage = inject(StorageService);

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
      for (const kind of ['catalog', 'fit'] as ImageKind[]) {
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

  async add(meta: WardrobeItem, images: Partial<Record<ImageKind, Blob>>): Promise<void> {
    if (images.fit) {
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

  async update(id: string, patch: Partial<WardrobeItem>): Promise<void> {
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await this.storage.setItems(this.items());
  }

  async remove(id: string): Promise<void> {
    const next: UrlMap = { ...this.urls() };
    for (const kind of ['catalog', 'fit'] as ImageKind[]) {
      const k = key(id, kind);
      if (next[k]) URL.revokeObjectURL(next[k]);
      delete next[k];
    }
    this.urls.set(next);
    this.items.update((list) => list.filter((i) => i.id !== id));
    await this.storage.deleteImages(id);
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

function key(id: string, kind: ImageKind): string {
  return `${id}:${kind}`;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Výchozí obrázek chybí: ${url}`);
  return res.blob();
}
