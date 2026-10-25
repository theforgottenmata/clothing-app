import { Injectable, computed, inject, signal } from '@angular/core';
import { AVATAR_URL } from './body-map';
import { StorageService } from './storage.service';

export type Gender = 'male' | 'female';
export type BodySize = 'S' | 'M' | 'L' | 'XL';
export type SkinTone = 'light' | 'medium' | 'tan' | 'dark';

export interface AvatarBody {
  gender: Gender;
  size: BodySize;
  skin: SkinTone;
}

export interface AvatarHead {
  hair?: string;
  hairColor?: string;
  eyes?: string;
  beard?: string;
  glasses?: string;
}

export interface AvatarMeta {
  /** null = výchozí avatar aplikace */
  body: AvatarBody | null;
  head: AvatarHead;
  updatedAt: number;
}

export interface AvatarImages {
  /** Neprůhledná verze – podklad pro další úpravy přes AI. */
  opaque: Blob;
  /** Průhledná verze – zobrazuje se na plátně. */
  transparent: Blob;
}

const DEFAULT_OPAQUE_URL = 'seed/avatar/avatar.png';
const KEY_META = 'avatar:meta';
const KEY_OPAQUE = 'avatar:opaque';
const KEY_TRANSPARENT = 'avatar:transparent';

/** Vlastní avatar uživatele (tělo + hlava). Bez vlastního se použije výchozí avatar aplikace. */
@Injectable({ providedIn: 'root' })
export class AvatarStore {
  private readonly storage = inject(StorageService);

  readonly meta = signal<AvatarMeta | null>(null);
  private readonly transparentUrl = signal<string | null>(null);
  /** URL průhledného avatara pro plátno a náhledy. */
  readonly url = computed(() => this.transparentUrl() ?? AVATAR_URL);
  readonly isCustom = computed(() => !!this.meta());

  async init(): Promise<void> {
    const [meta, transparent] = await Promise.all([
      this.storage.getValue<AvatarMeta>(KEY_META),
      this.storage.getValue<Blob>(KEY_TRANSPARENT),
    ]);
    if (meta && transparent) {
      this.meta.set(meta);
      this.transparentUrl.set(URL.createObjectURL(transparent));
    }
  }

  /** Neprůhledný obrázek aktuálního avatara (podklad pro úpravu hlavy). */
  async opaque(): Promise<Blob> {
    const own = this.meta() ? await this.storage.getValue<Blob>(KEY_OPAQUE) : undefined;
    return own ?? (await (await fetch(DEFAULT_OPAQUE_URL)).blob());
  }

  async save(meta: AvatarMeta, images: AvatarImages): Promise<void> {
    await Promise.all([
      this.storage.setValue(KEY_META, meta),
      this.storage.setValue(KEY_OPAQUE, images.opaque),
      this.storage.setValue(KEY_TRANSPARENT, images.transparent),
    ]);
    this.setUrl(URL.createObjectURL(images.transparent));
    this.meta.set(meta);
  }

  async reset(): Promise<void> {
    await Promise.all([KEY_META, KEY_OPAQUE, KEY_TRANSPARENT].map((k) => this.storage.deleteValue(k)));
    this.setUrl(null);
    this.meta.set(null);
  }

  /** Pro zálohu. */
  async snapshot(): Promise<{ meta: AvatarMeta; opaque: Blob; transparent: Blob } | null> {
    const meta = this.meta();
    if (!meta) return null;
    const [opaque, transparent] = await Promise.all([
      this.storage.getValue<Blob>(KEY_OPAQUE),
      this.storage.getValue<Blob>(KEY_TRANSPARENT),
    ]);
    return opaque && transparent ? { meta, opaque, transparent } : null;
  }

  private setUrl(url: string | null): void {
    if (this.transparentUrl()) URL.revokeObjectURL(this.transparentUrl()!);
    this.transparentUrl.set(url);
  }
}
