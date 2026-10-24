import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal, WritableSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CLOTHING_TRANSFORMER, StepStatus, TransformResult } from '../../ai/clothing-transformer';
import { catalogLayer, CATEGORY_Z, CATEGORY_ZONE, fitLayer } from '../../core/body-map';
import { blobSize, downscale, trimToContent } from '../../core/image-utils';
import {
  BottomLength,
  Category,
  CATEGORIES,
  CATEGORY_LABEL,
  COLORS,
  OCCASIONS,
  OutfitLayer,
  SEASONS,
  uid,
  WEATHER,
} from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { PlacementEditor } from '../try-on/placement-editor';

type Step = 1 | 2 | 3 | 4;

const NEW_ID = '__new__';
const ANALYSIS_MESSAGES = [
  'Rozpoznávám typ oblečení…',
  'Hledám barvy a materiál…',
  'Určuji střih a detaily…',
  'Dokončuji analýzu…',
] as const;
/** Dočasně drží animaci dost dlouho, aby šla při vývoji pohodlně zkontrolovat. */
const MIN_ANALYSIS_DURATION_MS = 5000;

@Component({
  selector: 'app-add-item-page',
  imports: [RouterLink, Icon, PlacementEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-item-page.html',
})
export class AddItemPage implements OnDestroy {
  private readonly transformer = inject(CLOTHING_TRANSFORMER);
  private readonly wardrobe = inject(WardrobeStore);
  private readonly outfit = inject(OutfitStore);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly colors = COLORS;
  protected readonly seasons = SEASONS;
  protected readonly weather = WEATHER;
  protected readonly occasions = OCCASIONS;
  protected readonly isAi = this.transformer.isAi;
  protected readonly titles = ['Nový kus', 'Zpracování', 'Detaily', 'Umístění'];

  protected readonly step = signal<Step>(1);
  protected readonly photo = signal<Blob | null>(null);
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly result = signal<TransformResult | null>(null);
  protected readonly resultUrl = signal<string | null>(null);
  protected readonly processing = signal(false);
  protected readonly analysisMessageIndex = signal(0);
  protected readonly analysisMessage = computed(() => ANALYSIS_MESSAGES[this.analysisMessageIndex()]);
  protected readonly error = signal<string | null>(null);
  private analysisTimer?: ReturnType<typeof setInterval>;

  // Detaily
  protected readonly name = signal('');
  protected readonly category = signal<Category>('top');
  protected readonly bottomLength = signal<BottomLength>('long');
  protected readonly color = signal<string | undefined>(undefined);
  protected readonly selSeasons = signal<string[]>([]);
  protected readonly selWeather = signal<string[]>([]);
  protected readonly selOccasions = signal<string[]>([]);
  protected readonly saving = signal(false);

  // Umístění na avatarovi
  private readonly fitTrim = signal<{ blob: Blob; url: string; box: { x: number; y: number; w: number; h: number } } | null>(null);
  private readonly catalogSize = signal<{ w: number; h: number } | null>(null);
  protected readonly placement = signal<OutfitLayer | null>(null);

  /** Ostatní oblečené kusy z jiných zón (pro kontext). */
  protected readonly contextLayers = computed(() => {
    const zone = CATEGORY_ZONE[this.category()];
    return this.outfit.layers().filter((l) => {
      const cat = this.wardrobe.byId().get(l.itemId)?.category;
      return cat && CATEGORY_ZONE[cat] !== zone;
    });
  });

  protected readonly urlFor = computed(() => {
    const fit = this.fitTrim()?.url;
    const catalog = this.resultUrl();
    this.wardrobe.items();
    return (l: OutfitLayer) =>
      l.itemId === NEW_ID ? (fit ?? catalog ?? undefined) : this.wardrobe.url(l.itemId, l.mode === 'fit' ? 'fit' : 'catalog');
  });

  protected readonly canSave = computed(() => !!this.result() && this.name().trim().length > 0 && !this.saving());

  protected readonly stepRows = computed(() => {
    const r = this.result();
    const st = (s: StepStatus | undefined, done: string, skipped: string) =>
      !r ? { state: 'active', text: 'Zpracovávám…' } : s === 'done' ? { state: 'done', text: done } : { state: 'skipped', text: skipped };
    return [
      { title: 'Rozpoznání kusu', ...st(r?.steps.detect, 'Hotovo', 'Přeskočeno – AI není připojená') },
      { title: 'Ilustrace ve stylu avatara', ...st(r?.steps.illustration, 'Hotovo', 'Použije se fotka bez pozadí') },
      { title: 'Verze na postavu', ...st(r?.steps.fit, 'Hotovo', 'Kus se umístí podle kategorie') },
    ];
  });

  ngOnDestroy(): void {
    this.stopAnalysisAnimation();
    this.revoke();
    if (this.fitTrim()) URL.revokeObjectURL(this.fitTrim()!.url);
  }

  protected async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set(null);
    try {
      const blob = await downscale(file, 1400);
      this.revoke();
      this.photo.set(blob);
      this.photoUrl.set(URL.createObjectURL(blob));
    } catch {
      this.error.set('Tenhle soubor se nepodařilo načíst jako obrázek.');
    }
  }

  protected async process(): Promise<void> {
    const photo = this.photo();
    if (!photo) return;
    this.step.set(2);
    this.processing.set(true);
    this.startAnalysisAnimation();
    this.result.set(null);
    this.error.set(null);
    try {
      const [res] = await Promise.all([
        this.transformer.transform(photo, { category: this.category(), bottomLength: this.bottomLength() }),
        wait(MIN_ANALYSIS_DURATION_MS),
      ]);
      this.result.set(res);
      if (this.resultUrl()) URL.revokeObjectURL(this.resultUrl()!);
      this.resultUrl.set(URL.createObjectURL(res.catalog));
      this.catalogSize.set(await blobSize(res.catalog));
      if (this.fitTrim()) URL.revokeObjectURL(this.fitTrim()!.url);
      if (res.fit) {
        const t = await trimToContent(res.fit);
        this.fitTrim.set({ ...t, url: URL.createObjectURL(t.blob) });
      } else {
        this.fitTrim.set(null);
      }
      const d = res.detected;
      if (d?.category) this.category.set(d.category);
      if (d?.bottomLength) this.bottomLength.set(d.bottomLength);
      if (d?.color) this.color.set(d.color);
      if (d?.name && !this.name()) this.name.set(d.name);
    } catch (e) {
      this.error.set('Zpracování selhalo. Zkus to prosím znovu.');
      console.error(e);
    } finally {
      this.stopAnalysisAnimation();
      this.processing.set(false);
    }
  }

  /** Přejde na krok Umístění s výchozí polohou podle kategorie. */
  protected goToPlacement(): void {
    this.resetPlacement();
    this.step.set(4);
  }

  protected resetPlacement(): void {
    const z = CATEGORY_Z[this.category()] + 50;
    const fit = this.fitTrim();
    if (fit) {
      this.placement.set(fitLayer(NEW_ID, z, fit.box));
    } else {
      const size = this.catalogSize() ?? { w: 600, h: 600 };
      this.placement.set(catalogLayer(NEW_ID, this.category(), size.w, size.h, z));
    }
  }

  protected toggle(list: WritableSignal<string[]>, value: string): void {
    list.update((l) => (l.includes(value) ? l.filter((v) => v !== value) : [...l, value]));
  }

  protected async save(wearNow: boolean): Promise<void> {
    const res = this.result();
    if (!res || !this.canSave()) return;
    this.saving.set(true);
    const id = uid();
    const category = this.category();
    const p = this.placement();
    const fit = this.fitTrim();
    await this.wardrobe.add(
      {
        id,
        name: this.name().trim(),
        category,
        bottomLength: category === 'bottom' ? this.bottomLength() : undefined,
        color: this.color(),
        seasons: this.selSeasons(),
        weather: this.selWeather(),
        occasions: this.selOccasions(),
        catalogSource: res.catalogIsAi ? 'ai' : 'photo',
        hasFit: !!fit,
        fitBox: fit?.box,
        placement: p ? { x: p.x, y: p.y, w: p.w, h: p.h, scale: p.scale, rotation: p.rotation } : undefined,
        favorite: false,
        createdAt: Date.now(),
      },
      { photo: this.photo()!, catalog: res.catalog, ...(fit ? { fit: fit.blob } : {}) },
    );
    if (wearNow) {
      const item = this.wardrobe.byId().get(id);
      if (item) this.outfit.wear(item);
    }
    this.router.navigateByUrl(wearNow ? '/vyzkouset' : '/satnik');
  }

  private revoke(): void {
    if (this.photoUrl()) URL.revokeObjectURL(this.photoUrl()!);
  }

  private startAnalysisAnimation(): void {
    this.stopAnalysisAnimation();
    this.analysisMessageIndex.set(0);
    this.analysisTimer = setInterval(() => {
      this.analysisMessageIndex.update((index) => Math.min(index + 1, ANALYSIS_MESSAGES.length - 1));
    }, 1100);
  }

  private stopAnalysisAnimation(): void {
    if (this.analysisTimer !== undefined) clearInterval(this.analysisTimer);
    this.analysisTimer = undefined;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
