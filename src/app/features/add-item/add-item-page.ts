import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal, WritableSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ClothingAnalysis, ClothingAnalysisResult, ClothingAnalysisService } from '../../ai/clothing-analysis';
import { CLOTHING_TRANSFORMER, TransformResult } from '../../ai/clothing-transformer';
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

type Step = 1 | 2;

const NEW_ID = '__new__';
const ANALYSIS_MESSAGES = [
  'Rozpoznávám jednotlivé kusy…',
  'Ignoruji postavu a okolí…',
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
  private readonly analysis = inject(ClothingAnalysisService);
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
  protected readonly titles = ['Nový kus', 'Umístění'];

  protected readonly step = signal<Step>(1);
  protected readonly photo = signal<Blob | null>(null);
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly result = signal<TransformResult | null>(null);
  protected readonly resultUrl = signal<string | null>(null);
  protected readonly processing = signal(false);
  protected readonly preparing = signal(false);
  protected readonly analysisMessageIndex = signal(0);
  protected readonly analysisMessage = computed(() => ANALYSIS_MESSAGES[this.analysisMessageIndex()]);
  protected readonly analysisResult = signal<ClothingAnalysisResult | null>(null);
  protected readonly selectedGarment = signal(0);
  protected readonly error = signal<string | null>(null);
  private analysisTimer?: ReturnType<typeof setInterval>;

  protected readonly name = signal('');
  protected readonly category = signal<Category>('top');
  protected readonly bottomLength = signal<BottomLength>('long');
  protected readonly color = signal<string | undefined>(undefined);
  protected readonly secondaryColors = signal('');
  protected readonly subtype = signal('');
  protected readonly fit = signal('');
  protected readonly material = signal('');
  protected readonly pattern = signal('');
  protected readonly length = signal('');
  protected readonly sleeveLength = signal('');
  protected readonly legShape = signal('');
  protected readonly details = signal('');
  protected readonly confidence = signal<number | undefined>(undefined);
  protected readonly selSeasons = signal<string[]>([]);
  protected readonly selWeather = signal<string[]>([]);
  protected readonly selOccasions = signal<string[]>([]);
  protected readonly saving = signal(false);

  private readonly fitTrim = signal<{ blob: Blob; url: string; box: { x: number; y: number; w: number; h: number } } | null>(null);
  private readonly catalogSize = signal<{ w: number; h: number } | null>(null);
  protected readonly placement = signal<OutfitLayer | null>(null);

  protected readonly contextLayers = computed(() => {
    const zone = CATEGORY_ZONE[this.category()];
    return this.outfit.layers().filter((layer) => {
      const category = this.wardrobe.byId().get(layer.itemId)?.category;
      return category && CATEGORY_ZONE[category] !== zone;
    });
  });

  protected readonly urlFor = computed(() => {
    const fit = this.fitTrim()?.url;
    const catalog = this.resultUrl();
    this.wardrobe.items();
    return (layer: OutfitLayer) =>
      layer.itemId === NEW_ID
        ? (fit ?? catalog ?? undefined)
        : this.wardrobe.url(layer.itemId, layer.mode === 'fit' ? 'fit' : 'catalog');
  });

  protected readonly canConfirm = computed(
    () => !!this.analysisResult() && this.name().trim().length > 0 && !this.processing() && !this.preparing(),
  );
  protected readonly canSave = computed(() => !!this.result() && this.name().trim().length > 0 && !this.saving());

  ngOnDestroy(): void {
    this.stopAnalysisAnimation();
    this.revoke();
    if (this.resultUrl()) URL.revokeObjectURL(this.resultUrl()!);
    if (this.fitTrim()) URL.revokeObjectURL(this.fitTrim()!.url);
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    try {
      const blob = await downscale(file, 1400);
      this.revoke();
      this.photo.set(blob);
      this.photoUrl.set(URL.createObjectURL(blob));
      this.analysisResult.set(null);
      this.result.set(null);
      this.clearDetectedFields();
      input.value = '';
    } catch {
      this.error.set('Tenhle soubor se nepodařilo načíst jako obrázek.');
    }
  }

  protected async analyze(): Promise<void> {
    const photo = this.photo();
    if (!photo || this.processing()) return;
    this.processing.set(true);
    this.startAnalysisAnimation();
    this.analysisResult.set(null);
    this.error.set(null);
    try {
      const [result] = await Promise.all([this.analysis.analyze(photo), wait(MIN_ANALYSIS_DURATION_MS)]);
      this.analysisResult.set(result);
      this.selectedGarment.set(0);
      this.applyAnalysis(result.garments[0]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Analýza fotografie se nepodařila.');
    } finally {
      this.stopAnalysisAnimation();
      this.processing.set(false);
    }
  }

  protected chooseGarment(index: number): void {
    const garment = this.analysisResult()?.garments[index];
    if (!garment) return;
    this.selectedGarment.set(index);
    this.applyAnalysis(garment);
  }

  protected async goToPlacement(): Promise<void> {
    const photo = this.photo();
    if (!photo || !this.canConfirm()) return;
    this.preparing.set(true);
    this.error.set(null);
    try {
      const result = await this.transformer.transform(photo, {
        category: this.category(),
        bottomLength: this.bottomLength(),
      });
      this.result.set(result);
      if (this.resultUrl()) URL.revokeObjectURL(this.resultUrl()!);
      this.resultUrl.set(URL.createObjectURL(result.catalog));
      this.catalogSize.set(await blobSize(result.catalog));
      if (this.fitTrim()) URL.revokeObjectURL(this.fitTrim()!.url);
      if (result.fit) {
        const trimmed = await trimToContent(result.fit);
        this.fitTrim.set({ ...trimmed, url: URL.createObjectURL(trimmed.blob) });
      } else {
        this.fitTrim.set(null);
      }
      this.resetPlacement();
      this.step.set(2);
    } catch (error) {
      console.error(error);
      this.error.set('Náhled kusu se nepodařilo připravit. Zkus to prosím znovu.');
    } finally {
      this.preparing.set(false);
    }
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
    list.update((values) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]));
  }

  protected async save(wearNow: boolean): Promise<void> {
    const result = this.result();
    const analysis = this.analysisResult();
    if (!result || !analysis || !this.canSave()) return;
    this.saving.set(true);
    const id = uid();
    const category = this.category();
    const placement = this.placement();
    const fit = this.fitTrim();
    await this.wardrobe.add(
      {
        id,
        name: this.name().trim(),
        category,
        bottomLength: category === 'bottom' ? this.bottomLength() : undefined,
        color: this.color(),
        attributes: {
          subtype: valueOrUndefined(this.subtype()),
          secondaryColors: splitDetails(this.secondaryColors()),
          fit: valueOrUndefined(this.fit()),
          length: valueOrUndefined(this.length()),
          sleeveLength: valueOrUndefined(this.sleeveLength()),
          legShape: valueOrUndefined(this.legShape()),
          material: valueOrUndefined(this.material()),
          pattern: valueOrUndefined(this.pattern()),
          details: splitDetails(this.details()),
          containsPerson: analysis.containsPerson,
          photoMode: analysis.photoMode,
          confidence: this.confidence(),
        },
        seasons: this.selSeasons(),
        weather: this.selWeather(),
        occasions: this.selOccasions(),
        catalogSource: result.catalogIsAi ? 'ai' : 'photo',
        hasFit: !!fit,
        fitBox: fit?.box,
        placement: placement
          ? {
              x: placement.x,
              y: placement.y,
              w: placement.w,
              h: placement.h,
              scale: placement.scale,
              rotation: placement.rotation,
            }
          : undefined,
        favorite: false,
        createdAt: Date.now(),
      },
      { photo: this.photo()!, catalog: result.catalog, ...(fit ? { fit: fit.blob } : {}) },
    );
    if (wearNow) {
      const item = this.wardrobe.byId().get(id);
      if (item) this.outfit.wear(item);
    }
    this.router.navigateByUrl(wearNow ? '/vyzkouset' : '/satnik');
  }

  private applyAnalysis(garment: ClothingAnalysis): void {
    this.name.set(garment.name);
    this.category.set(garment.category);
    this.color.set(garment.primaryColor ?? undefined);
    this.secondaryColors.set(garment.secondaryColors.join(', '));
    this.subtype.set(garment.subtype ?? '');
    this.fit.set(garment.fit ?? '');
    this.material.set(garment.material ?? '');
    this.pattern.set(garment.pattern ?? '');
    this.length.set(garment.length ?? '');
    this.sleeveLength.set(garment.sleeveLength ?? '');
    this.legShape.set(garment.legShape ?? '');
    this.details.set(garment.details.join(', '));
    this.confidence.set(garment.confidence);
    if (garment.category === 'bottom') this.bottomLength.set(inferBottomLength(garment.length));
  }

  private clearDetectedFields(): void {
    this.name.set('');
    this.category.set('top');
    this.bottomLength.set('long');
    this.color.set(undefined);
    this.secondaryColors.set('');
    this.subtype.set('');
    this.fit.set('');
    this.material.set('');
    this.pattern.set('');
    this.length.set('');
    this.sleeveLength.set('');
    this.legShape.set('');
    this.details.set('');
    this.confidence.set(undefined);
  }

  private revoke(): void {
    if (this.photoUrl()) URL.revokeObjectURL(this.photoUrl()!);
  }

  private startAnalysisAnimation(): void {
    this.stopAnalysisAnimation();
    this.analysisMessageIndex.set(0);
    this.analysisTimer = setInterval(() => {
      this.analysisMessageIndex.update((index) => Math.min(index + 1, ANALYSIS_MESSAGES.length - 1));
    }, 1000);
  }

  private stopAnalysisAnimation(): void {
    if (this.analysisTimer !== undefined) clearInterval(this.analysisTimer);
    this.analysisTimer = undefined;
  }
}

function inferBottomLength(length: string | null): BottomLength {
  const normalized = length?.toLocaleLowerCase('cs') ?? '';
  return normalized.includes('krát') || normalized.includes('šort') ? 'short' : 'long';
}

function valueOrUndefined(value: string): string | undefined {
  return value.trim() || undefined;
}

function splitDetails(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
