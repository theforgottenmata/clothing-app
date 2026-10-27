import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal, WritableSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ClothingAnalysis, ClothingAnalysisService, ScannedGarment } from '../../ai/clothing-analysis';
import { CLOTHING_TRANSFORMER } from '../../ai/clothing-transformer';
import { catalogLayer, CATEGORY_Z, CATEGORY_ZONE } from '../../core/body-map';
import { blobSize, downscale } from '../../core/image-utils';
import {
  BottomLength,
  Category,
  CATEGORIES,
  CATEGORY_LABEL,
  COLORS,
  OCCASIONS,
  OutfitLayer,
  PhotoMode,
  Reach,
  SEASONS,
  uid,
  WEATHER,
} from '../../core/models';
import { AvatarStore } from '../../core/avatar.store';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { PlacementEditor } from '../try-on/placement-editor';

/**
 * Stav obrazovky:
 * - pick: výběr fotky
 * - scanning: analýza + výřez běží
 * - review: procházení nalezených kusů (Kus X z N)
 * - placement: umístění na avatarovi (jen když je na fotce jediný kus)
 * - done: shrnutí po uložení více kusů
 */
type Phase = 'pick' | 'scanning' | 'review' | 'placement' | 'done';

/** Kus k uložení – z analýzy, nebo prázdný pro ruční vyplnění. */
interface Draft {
  analysis: ClothingAnalysis | null;
  image: string | null;
  warning: string | null;
}

const NEW_ID = '__new__';
const SCAN_MESSAGES = [
  'Rozpoznávám jednotlivé kusy…',
  'Ignoruji postavu a okolí…',
  'Vyřezávám oblečení z fotky…',
  'Hledám barvy a materiál…',
  'Dokončuji…',
] as const;

@Component({
  selector: 'app-add-item-page',
  imports: [RouterLink, Icon, PlacementEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-item-page.html',
})
export class AddItemPage implements OnDestroy {
  private readonly scanner = inject(ClothingAnalysisService);
  private readonly transformer = inject(CLOTHING_TRANSFORMER);
  private readonly wardrobe = inject(WardrobeStore);
  private readonly outfit = inject(OutfitStore);
  private readonly router = inject(Router);
  /** Tělo z knihovny → kus oblékne AI přesně na postavu, ruční umístění není potřeba. */
  private readonly avatar = inject(AvatarStore);
  protected readonly aiFit = computed(() => this.avatar.ready());

  protected readonly categories = CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly colors = COLORS;
  protected readonly seasons = SEASONS;
  protected readonly weather = WEATHER;
  protected readonly occasions = OCCASIONS;

  protected readonly phase = signal<Phase>('pick');
  protected readonly photo = signal<Blob | null>(null);
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly scanMessageIndex = signal(0);
  protected readonly scanMessage = computed(() => SCAN_MESSAGES[this.scanMessageIndex()]);
  private scanTimer?: ReturnType<typeof setInterval>;
  private scanAbort?: AbortController;

  /** Kusy nalezené na fotce a pozice v procházení. */
  protected readonly drafts = signal<Draft[]>([]);
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.drafts()[this.index()] ?? null);
  protected readonly total = computed(() => this.drafts().length);
  protected readonly isLast = computed(() => this.index() >= this.total() - 1);
  protected readonly manual = signal(false);
  private photoMode: PhotoMode = 'other';
  private containsPerson = false;
  protected readonly savedCount = signal(0);
  protected readonly skippedCount = signal(0);
  private readonly savedIds: string[] = [];

  /** Obrázek kusu, který se uloží do šatníku (výřez, nebo záchranný výřez celé fotky). */
  private readonly cutout = signal<Blob | null>(null);
  protected readonly cutoutUrl = signal<string | null>(null);
  private readonly cutoutSize = signal<{ w: number; h: number } | null>(null);

  protected readonly name = signal('');
  protected readonly category = signal<Category>('top');
  protected readonly bottomLength = signal<BottomLength>('long');
  private readonly reach = signal<Reach | undefined>(undefined);
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
  protected readonly showMore = signal(false);

  protected readonly placement = signal<OutfitLayer | null>(null);

  protected readonly contextLayers = computed(() => {
    const zone = CATEGORY_ZONE[this.category()];
    return this.outfit.layers().filter((layer) => {
      const category = this.wardrobe.byId().get(layer.itemId)?.category;
      return category && CATEGORY_ZONE[category] !== zone;
    });
  });

  protected readonly urlFor = computed(() => {
    const cutout = this.cutoutUrl();
    this.wardrobe.items();
    return (layer: OutfitLayer) =>
      layer.itemId === NEW_ID ? (cutout ?? undefined) : this.wardrobe.layerUrl(layer);
  });

  protected readonly lowConfidence = computed(() => (this.confidence() ?? 1) < 0.6);
  protected readonly canSave = computed(() => !!this.cutout() && this.name().trim().length > 0 && !this.saving());

  ngOnDestroy(): void {
    this.scanAbort?.abort();
    this.stopScanAnimation();
    this.setPhotoUrl(null);
    this.setCutout(null);
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    try {
      const blob = await downscale(file, 1400, 'image/jpeg');
      this.photo.set(blob);
      this.setPhotoUrl(URL.createObjectURL(blob));
    } catch {
      this.error.set('Tenhle soubor se nepodařilo načíst jako obrázek.');
      return;
    }
    this.scan();
  }

  /** Analýza + výřez se spustí hned po výběru fotky. */
  protected async scan(): Promise<void> {
    const photo = this.photo();
    if (!photo) return;
    this.scanAbort?.abort();
    const abort = (this.scanAbort = new AbortController());
    this.phase.set('scanning');
    this.error.set(null);
    this.startScanAnimation();
    try {
      const result = await this.scanner.scan(photo, abort.signal);
      if (abort.signal.aborted) return;
      this.savedCount.set(0);
      this.skippedCount.set(0);
      this.savedIds.length = 0;
      if ('analysisError' in result) {
        this.error.set(`${result.analysisError.message} Kus můžeš vyplnit ručně.`);
        this.photoMode = 'other';
        this.containsPerson = false;
        this.manual.set(true);
        this.drafts.set([{ analysis: null, image: result.fallbackImage, warning: null }]);
      } else {
        this.photoMode = result.photoMode;
        this.containsPerson = result.containsPerson;
        this.manual.set(false);
        this.drafts.set(result.garments.map((g: ScannedGarment) => ({ analysis: g, image: g.image, warning: g.warning })));
      }
      await this.openDraft(0);
    } catch (error) {
      if (abort.signal.aborted) return;
      this.error.set(error instanceof Error ? error.message : 'Zpracování fotografie se nepodařilo.');
      this.phase.set('pick');
    } finally {
      if (this.scanAbort === abort) this.stopScanAnimation();
    }
  }

  protected cancelScan(): void {
    this.scanAbort?.abort();
    this.stopScanAnimation();
    this.phase.set('pick');
  }

  /** Ruční vyplnění bez AI (když analýza selže nebo ji nechceš čekat). */
  protected async fillManually(): Promise<void> {
    this.scanAbort?.abort();
    this.stopScanAnimation();
    this.error.set(null);
    this.manual.set(true);
    this.photoMode = 'other';
    this.containsPerson = false;
    this.drafts.set([{ analysis: null, image: null, warning: null }]);
    await this.openDraft(0);
  }

  /** Otevře kus k úpravě: předvyplní formulář a připraví obrázek. */
  private async openDraft(i: number): Promise<void> {
    const draft = this.drafts()[i];
    if (!draft) return;
    this.index.set(i);
    this.showMore.set(false);
    this.clearFields();
    if (draft.analysis) this.applyAnalysis(draft.analysis);
    let blob: Blob | null = null;
    if (draft.image) blob = await (await fetch(draft.image)).blob();
    else if (this.photo()) blob = (await this.transformer.transform(this.photo()!)).catalog;
    this.setCutout(blob);
    this.cutoutSize.set(blob ? await blobSize(blob) : null);
    this.phase.set('review');
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected goToPlacement(): void {
    if (!this.canSave()) return;
    this.resetPlacement();
    this.phase.set('placement');
  }

  protected resetPlacement(): void {
    const size = this.cutoutSize() ?? { w: 600, h: 600 };
    this.placement.set(catalogLayer(NEW_ID, this.category(), size.w, size.h, CATEGORY_Z[this.category()] + 50));
  }

  /** Jeden kus: uložit (s umístěním) a odejít. */
  protected async saveSingle(wearNow: boolean): Promise<void> {
    const id = await this.store(true);
    if (!id) return;
    if (wearNow) {
      const item = this.wardrobe.byId().get(id);
      if (item) this.outfit.wear(item);
    }
    this.router.navigateByUrl(wearNow ? '/vyzkouset' : '/satnik');
  }

  /** Víc kusů: uložit aktuální a přejít na další. */
  protected async saveAndNext(): Promise<void> {
    const id = await this.store(false);
    if (!id) return;
    this.savedIds.push(id);
    this.savedCount.update((n) => n + 1);
    await this.next();
  }

  protected async skip(): Promise<void> {
    this.skippedCount.update((n) => n + 1);
    await this.next();
  }

  private async next(): Promise<void> {
    if (this.isLast()) {
      this.setCutout(null);
      this.phase.set('done');
      return;
    }
    await this.openDraft(this.index() + 1);
  }

  protected wearSaved(): void {
    for (const id of this.savedIds) {
      const item = this.wardrobe.byId().get(id);
      if (item) this.outfit.wear(item);
    }
    this.router.navigateByUrl('/vyzkouset');
  }

  protected restart(): void {
    this.setPhotoUrl(null);
    this.photo.set(null);
    this.drafts.set([]);
    this.error.set(null);
    this.phase.set('pick');
  }

  protected toggle(list: WritableSignal<string[]>, value: string): void {
    list.update((values) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]));
  }

  private async store(withPlacement: boolean): Promise<string | null> {
    const cutout = this.cutout();
    if (!cutout || !this.canSave()) return null;
    this.saving.set(true);
    try {
      const id = uid();
      const category = this.category();
      const placement = withPlacement ? this.placement() : null;
      await this.wardrobe.add(
        {
          id,
          name: this.name().trim(),
          category,
          bottomLength: category === 'bottom' ? this.bottomLength() : undefined,
          // kategorie změněná ručně → reach z analýzy už nemusí platit
          reach: this.current()?.analysis?.category === category ? this.reach() : undefined,
          color: this.color(),
          attributes: {
            subtype: valueOrUndefined(this.subtype()),
            secondaryColors: splitList(this.secondaryColors()),
            fit: valueOrUndefined(this.fit()),
            length: valueOrUndefined(this.length()),
            sleeveLength: valueOrUndefined(this.sleeveLength()),
            legShape: valueOrUndefined(this.legShape()),
            material: valueOrUndefined(this.material()),
            pattern: valueOrUndefined(this.pattern()),
            details: splitList(this.details()),
            containsPerson: this.containsPerson,
            photoMode: this.photoMode,
            confidence: this.confidence(),
          },
          seasons: this.selSeasons(),
          weather: this.selWeather(),
          occasions: this.selOccasions(),
          catalogSource: 'photo',
          hasFit: false,
          placement: placement
            ? { x: placement.x, y: placement.y, w: placement.w, h: placement.h, scale: placement.scale, rotation: placement.rotation }
            : undefined,
          favorite: false,
          createdAt: Date.now(),
        },
        { photo: this.photo()!, catalog: cutout },
      );
      return id;
    } catch (error) {
      console.error(error);
      this.error.set('Kus se nepodařilo uložit.');
      return null;
    } finally {
      this.saving.set(false);
    }
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
    this.reach.set(garment.reach ?? undefined);
    if (garment.category === 'bottom') this.bottomLength.set(inferBottomLength(garment.length, garment.reach));
  }

  private clearFields(): void {
    this.name.set('');
    this.category.set('top');
    this.bottomLength.set('long');
    this.reach.set(undefined);
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
    this.selSeasons.set([]);
    this.selWeather.set([]);
    this.selOccasions.set([]);
  }

  private setPhotoUrl(url: string | null): void {
    if (this.photoUrl()) URL.revokeObjectURL(this.photoUrl()!);
    this.photoUrl.set(url);
  }

  private setCutout(blob: Blob | null): void {
    if (this.cutoutUrl()) URL.revokeObjectURL(this.cutoutUrl()!);
    this.cutout.set(blob);
    this.cutoutUrl.set(blob ? URL.createObjectURL(blob) : null);
  }

  private startScanAnimation(): void {
    this.stopScanAnimation();
    this.scanMessageIndex.set(0);
    this.scanTimer = setInterval(() => {
      this.scanMessageIndex.update((index) => Math.min(index + 1, SCAN_MESSAGES.length - 1));
    }, 1600);
  }

  private stopScanAnimation(): void {
    if (this.scanTimer !== undefined) clearInterval(this.scanTimer);
    this.scanTimer = undefined;
  }
}

function inferBottomLength(length: string | null, reach?: Reach | null): BottomLength {
  if (reach) return reach === 'hip' || reach === 'thigh' || reach === 'knee' ? 'short' : 'long';
  const normalized = length?.toLocaleLowerCase('cs') ?? '';
  return normalized.includes('krát') || normalized.includes('šort') ? 'short' : 'long';
}

function valueOrUndefined(value: string): string | undefined {
  return value.trim() || undefined;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
