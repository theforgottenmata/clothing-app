import { inject, Injectable, signal } from '@angular/core';
import { AvatarStore } from './avatar.store';
import { WardrobeItem } from './models';
import { WardrobeStore } from './wardrobe.store';

interface DressResponse {
  layer: string | null;
  erase: string | null;
  warning: string | null;
  usd: number;
  missing?: boolean;
  error?: string;
}

const TIMEOUT_MS = 240_000;
/** Verze výřezu vrstvy na serveru – po zvýšení se uložené verze kusů přepočítají zdarma (z cache výstupu AI). */
export const FIT_VERSION = 2;

/**
 * Verze kusu na postavu: AI oblékne tělo avatara (server /api/clothing/dress) a vyřízne vrstvu kusu.
 * Šetří AI: generuje se až při prvním oblečení kusu na dané tělo, výsledek se uloží ke kusu
 * (další oblečení je zdarma), stejný kus se nespouští dvakrát a server si výstup AI pamatuje i pro jinou pleť.
 */
@Injectable({ providedIn: 'root' })
export class FitService {
  private readonly wardrobe = inject(WardrobeStore);
  private readonly avatar = inject(AvatarStore);

  /** Kusy, které se právě oblékají (id kusu). */
  readonly pending = signal<ReadonlySet<string>>(new Set());
  /** Poslední chyba u kusu (id kusu → zpráva). */
  readonly errors = signal<ReadonlyMap<string, string>>(new Map());
  private readonly running = new Map<string, Promise<WardrobeItem | null>>();

  /** Má kus verzi na aktuální tělo? */
  has(item: WardrobeItem): boolean {
    return !!item.fits?.[this.avatar.id()];
  }

  /** Lze kus obléct přes AI (tělo je z knihovny a kus má katalogový obrázek)? */
  canDress(item: WardrobeItem): boolean {
    return this.avatar.ready() && !!this.wardrobe.url(item.id, 'catalog');
  }

  /**
   * Zajistí verzi na aktuální tělo. Vrací aktualizovaný kus, nebo null (chyba – kus zůstane jako katalog).
   * @param retry  nové generování (ignoruje uloženou verzi i cache serveru – placené)
   */
  ensure(item: WardrobeItem, retry = false): Promise<WardrobeItem | null> {
    const body = this.avatar.id();
    if (!retry && item.fits?.[body]) return Promise.resolve(item);
    if (!this.canDress(item)) return Promise.resolve(null);
    const key = `${item.id}:${body}`;
    const running = this.running.get(key);
    if (running) return running;
    const job = this.dress(item, body, retry).finally(() => {
      this.running.delete(key);
      this.setPending(item.id, false);
    });
    this.running.set(key, job);
    this.setPending(item.id, true);
    this.setError(item.id, null);
    return job;
  }

  /**
   * Po vylepšení výřezu (FIT_VERSION) přepočítá uložené verze kusů z výstupu AI, který si drží server.
   * Nikdy nevolá AI (cachedOnly) – když výstup na serveru chybí, zůstane stará verze. Běží na pozadí po startu.
   */
  async upgradeAll(): Promise<void> {
    for (const item of this.wardrobe.items()) {
      for (const [body, fit] of Object.entries(item.fits ?? {})) {
        if ((fit.v ?? 1) >= FIT_VERSION) continue;
        try {
          const current = this.wardrobe.byId().get(item.id);
          if (!current) break;
          await this.request(current, body, { cachedOnly: true });
        } catch {
          // stará verze zůstane, nic se neděje
        }
      }
    }
  }

  private async dress(item: WardrobeItem, body: string, retry: boolean): Promise<WardrobeItem | null> {
    try {
      return await this.request(item, body, { retry });
    } catch (error) {
      this.setError(item.id, error instanceof Error ? error.message : 'Oblečení kusu na avatara se nepodařilo.');
      return null;
    }
  }

  private async request(item: WardrobeItem, body: string, opts: { retry?: boolean; cachedOnly?: boolean }): Promise<WardrobeItem | null> {
    const catalog = await fetch(this.wardrobe.url(item.id, 'catalog')!).then((r) => r.blob());
    let response: Response;
    try {
      response = await fetch('/api/clothing/dress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          image: await toDataUrl(catalog),
          category: item.category,
          bottomLength: item.bottomLength,
          reach: item.reach,
          name: item.name,
          subtype: item.attributes?.subtype,
          body,
          retry: opts.retry ?? false,
          cachedOnly: opts.cachedOnly ?? false,
        }),
      });
    } catch {
      throw new Error('Server aplikace neodpovídá nebo AI nestihla odpovědět. Zkus to znovu.');
    }
    const data = (await response.json().catch(() => null)) as DressResponse | null;
    if (!response.ok || !data) throw new Error(data?.error ?? 'Oblečení kusu na avatara se nepodařilo.');
    if (data.missing) return null;
    if (!data.layer) throw new Error(data.warning ?? 'AI kus na postavu nenakreslila.');
    const [layer, erase] = await Promise.all([dataUrlToBlob(data.layer), data.erase ? dataUrlToBlob(data.erase) : null]);
    // Mezitím se mohlo změnit tělo avatara – verze se uloží ke svému tělu tak jako tak.
    return (await this.wardrobe.setFit(item.id, body, layer, erase, FIT_VERSION)) ?? null;
  }

  private setPending(id: string, on: boolean): void {
    this.pending.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private setError(id: string, message: string | null): void {
    this.errors.update((m) => {
      const next = new Map(m);
      if (message) next.set(id, message);
      else next.delete(id);
      return next;
    });
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Obrázek kusu se nepodařilo načíst.'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}
