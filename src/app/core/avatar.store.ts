import { Injectable, computed, inject, signal } from '@angular/core';
import { AVATAR_URL } from './body-map';
import { StorageService } from './storage.service';

export type Gender = 'male' | 'female';
export type BodySize = 'S' | 'M' | 'L' | 'XL';
export type SkinTone = 'light' | 'medium' | 'tan' | 'dark';

/** Tělo avatara – určuje, jak sedí oblečení. Obličej bude samostatná vrstva (později). */
export interface AvatarBody {
  gender: Gender;
  size: BodySize;
  skin: SkinTone;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mapa hlavy a zón těla v prostoru 688×1024 (z manifestu knihovny těl). */
export interface BodyMap {
  head: Box | null;
  face: Box | null;
  torso: Box | null;
  hips: Box | null;
  arms: Box | null;
  legs: Box | null;
  feet: Box | null;
  body: Box | null;
}

interface Manifest {
  bodies: Record<string, AvatarBody & { map: BodyMap }>;
}

export const DEFAULT_BODY: AvatarBody = { gender: 'male', size: 'M', skin: 'medium' };
const KEY = 'avatar:body';

export const bodyId = (b: AvatarBody) => `${b.gender}-${b.size}-${b.skin}`;

/**
 * Avatar = výběr z knihovny 32 těl (design-assets/avatars, generuje tools/avatar-library.mjs).
 * Přepnutí je okamžité a zdarma; dokud tělo v knihovně chybí, použije se výchozí avatar.
 */
@Injectable({ providedIn: 'root' })
export class AvatarStore {
  private readonly storage = inject(StorageService);

  readonly body = signal<AvatarBody>(DEFAULT_BODY);
  private readonly manifest = signal<Manifest['bodies']>({});

  readonly available = computed(() => new Set(Object.keys(this.manifest())));
  readonly isAvailable = (b: AvatarBody) => this.available().has(bodyId(b));
  readonly ready = computed(() => this.isAvailable(this.body()));
  /** URL průhledného avatara pro plátno a náhledy. */
  readonly url = computed(() => (this.ready() ? `seed/avatars/${bodyId(this.body())}-transparent.webp` : AVATAR_URL));
  readonly map = computed<BodyMap | null>(() => this.manifest()[bodyId(this.body())]?.map ?? null);

  async init(): Promise<void> {
    const [saved, manifest] = await Promise.all([
      this.storage.getValue<AvatarBody>(KEY),
      fetch('seed/avatars/manifest.json')
        .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
        .catch(() => null),
    ]);
    if (manifest?.bodies) this.manifest.set(manifest.bodies);
    if (saved) this.body.set(saved);
  }

  async setBody(body: AvatarBody): Promise<void> {
    this.body.set(body);
    await this.storage.setValue(KEY, body);
  }

  /** Náhled libovolného těla (pro výběr), bez uložení. */
  urlFor(body: AvatarBody): string {
    return this.isAvailable(body) ? `seed/avatars/${bodyId(body)}-transparent.webp` : AVATAR_URL;
  }
}
