import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal, WritableSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CLOTHING_TRANSFORMER, StepStatus, TransformResult } from '../../ai/clothing-transformer';
import { downscale } from '../../core/image-utils';
import {
  BottomLength,
  Category,
  CATEGORIES,
  CATEGORY_LABEL,
  COLORS,
  OCCASIONS,
  SEASONS,
  uid,
  WEATHER,
} from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';

type Step = 1 | 2 | 3;

@Component({
  selector: 'app-add-item-page',
  imports: [RouterLink, Icon],
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

  protected readonly step = signal<Step>(1);
  protected readonly photo = signal<Blob | null>(null);
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly result = signal<TransformResult | null>(null);
  protected readonly resultUrl = signal<string | null>(null);
  protected readonly processing = signal(false);
  protected readonly error = signal<string | null>(null);

  // Detaily
  protected readonly name = signal('');
  protected readonly category = signal<Category>('top');
  protected readonly bottomLength = signal<BottomLength>('long');
  protected readonly color = signal<string | undefined>(undefined);
  protected readonly selSeasons = signal<string[]>([]);
  protected readonly selWeather = signal<string[]>([]);
  protected readonly selOccasions = signal<string[]>([]);
  protected readonly saving = signal(false);

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
    this.revoke();
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
    this.result.set(null);
    this.error.set(null);
    try {
      const res = await this.transformer.transform(photo, { category: this.category(), bottomLength: this.bottomLength() });
      this.result.set(res);
      if (this.resultUrl()) URL.revokeObjectURL(this.resultUrl()!);
      this.resultUrl.set(URL.createObjectURL(res.catalog));
      const d = res.detected;
      if (d?.category) this.category.set(d.category);
      if (d?.bottomLength) this.bottomLength.set(d.bottomLength);
      if (d?.color) this.color.set(d.color);
      if (d?.name && !this.name()) this.name.set(d.name);
    } catch (e) {
      this.error.set('Zpracování selhalo. Zkus to prosím znovu.');
      console.error(e);
    } finally {
      this.processing.set(false);
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
        hasFit: !!res.fit,
        favorite: false,
        createdAt: Date.now(),
      },
      { photo: this.photo()!, catalog: res.catalog, ...(res.fit ? { fit: res.fit } : {}) },
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
}
