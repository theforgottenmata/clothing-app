import { inject, Injectable } from '@angular/core';
import { AvatarMeta, AvatarStore } from './avatar.store';
import { ImageKind, Outfit, OutfitLayer, WardrobeItem } from './models';
import { OutfitStore } from './outfit.store';
import { StorageService } from './storage.service';
import { WardrobeStore } from './wardrobe.store';

const KINDS: ImageKind[] = ['photo', 'catalog', 'fit'];

interface BackupFile {
  app: 'ai-wardrobe';
  version: 1;
  exportedAt: string;
  items: WardrobeItem[];
  outfits: Outfit[];
  current: OutfitLayer[];
  /** id kusu → druh obrázku → data URL */
  images: Record<string, Partial<Record<ImageKind, string>>>;
  /** Vlastní avatar (od verze se stránkou Můj avatar). */
  avatar?: { meta: AvatarMeta; opaque: string; transparent: string };
}

/** Záloha celého šatníku do jednoho JSON souboru (obrázky jako data URL) a obnova z něj. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly wardrobe = inject(WardrobeStore);
  private readonly outfit = inject(OutfitStore);
  private readonly storage = inject(StorageService);
  private readonly avatar = inject(AvatarStore);

  async export(): Promise<void> {
    const items = this.wardrobe.items();
    const images: BackupFile['images'] = {};
    for (const item of items) {
      images[item.id] = {};
      for (const kind of KINDS) {
        const blob = await this.storage.getImage(item.id, kind);
        if (blob) images[item.id][kind] = await toDataUrl(blob);
      }
    }
    const data: BackupFile = {
      app: 'ai-wardrobe',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      outfits: this.outfit.saved(),
      current: this.outfit.layers(),
      images,
    };
    const avatar = await this.avatar.snapshot();
    if (avatar) {
      data.avatar = { meta: avatar.meta, opaque: await toDataUrl(avatar.opaque), transparent: await toDataUrl(avatar.transparent) };
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `satnik-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Nahradí celý šatník obsahem zálohy. Vrací počet kusů. */
  async import(file: File): Promise<number> {
    let data: BackupFile;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('Soubor není platná záloha (neplatný JSON).');
    }
    if (data?.app !== 'ai-wardrobe' || !Array.isArray(data.items)) throw new Error('Soubor není záloha šatníku.');
    const images: Record<string, Partial<Record<ImageKind, Blob>>> = {};
    for (const [id, kinds] of Object.entries(data.images ?? {})) {
      images[id] = {};
      for (const kind of KINDS) {
        const url = kinds[kind];
        if (url) images[id][kind] = await (await fetch(url)).blob();
      }
    }
    const ids = new Set(data.items.map((i) => i.id));
    await this.wardrobe.replaceAll(data.items, images);
    await this.outfit.replaceAll(
      (data.current ?? []).filter((l) => ids.has(l.itemId)),
      (data.outfits ?? []).map((o) => ({ ...o, layers: o.layers.filter((l) => ids.has(l.itemId)) })),
    );
    if (data.avatar) {
      const [opaque, transparent] = await Promise.all([
        fetch(data.avatar.opaque).then((r) => r.blob()),
        fetch(data.avatar.transparent).then((r) => r.blob()),
      ]);
      await this.avatar.save(data.avatar.meta, { opaque, transparent });
    }
    return data.items.length;
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
