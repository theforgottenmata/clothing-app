import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Category, CATEGORIES, CATEGORY_LABEL, OCCASIONS, OutfitLayer } from '../../core/models';
import { FitService } from '../../core/fit.service';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { OutfitStage } from './outfit-stage';

interface CycleZone {
  id: string;
  label: string;
  /** výška zóny v % avatara */
  y: number;
  categories: Category[];
  count: Signal<number>;
}

@Component({
  selector: 'app-try-on-page',
  imports: [RouterLink, NgTemplateOutlet, NgClass, Icon, OutfitStage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './try-on-page.html',
})
export class TryOnPage {
  protected readonly wardrobe = inject(WardrobeStore);
  protected readonly outfit = inject(OutfitStore);
  protected readonly fit = inject(FitService);

  protected readonly categories = CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly occasions = OCCASIONS;
  protected readonly category = signal<Category | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveName = signal('');
  protected readonly saveOccasion = signal<string | undefined>(undefined);
  protected readonly toast = signal<string | null>(null);

  protected readonly stripItems = computed(() =>
    this.wardrobe.items().filter((i) => !this.category() || i.category === this.category()),
  );

  /** Desktop: bez filtru kusy po sekcích podle typu (v pořadí kategorií), s filtrem jedna sekce. */
  protected readonly stripGroups = computed(() => {
    const items = this.stripItems();
    return CATEGORIES.map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter(
      (g) => g.items.length,
    );
  });

  protected readonly wornItems = computed(() =>
    [...this.outfit.sortedLayers()]
      .reverse()
      .map((l) => ({ layer: l, item: this.wardrobe.byId().get(l.itemId) }))
      .filter((x) => !!x.item),
  );

  /** Kusy na avatarovi, které AI právě obléká (do té doby je vidět katalogový obrázek). */
  protected readonly dressing = computed(() => {
    const pending = this.fit.pending();
    return this.wornItems().filter((w) => pending.has(w.layer.itemId)).map((w) => w.item!.name);
  });
  /** Kusy na avatarovi, které se nepodařilo obléct – s možností zkusit znovu. */
  protected readonly failed = computed(() => {
    const errors = this.fit.errors();
    return this.wornItems()
      .filter((w) => errors.has(w.layer.itemId) && w.layer.mode !== 'fit')
      .map((w) => ({ item: w.item!, message: errors.get(w.layer.itemId)! }));
  });

  /** URL obrázku pro vrstvu – verze na postavu, nebo katalog. */
  protected readonly urlFor = computed(() => {
    this.wardrobe.items(); // přepočítat při změně šatníku
    return (l: OutfitLayer) => this.wardrobe.layerUrl(l);
  });

  /**
   * Mobil: zóny postavy se šipkami (svrchní, vršek, spodek, boty) – výška v % avatara.
   * Šipka / přejetí prstem oblékne další kus v zóně; za posledním je „nic“ (kus se sundá).
   */
  protected readonly zones: CycleZone[] = [
    { id: 'outer', label: 'Svrchní', y: 26, categories: ['outerwear'], count: computed(() => this.countOf(['outerwear'])) },
    { id: 'upper', label: 'Vršek', y: 40, categories: ['top', 'dress'], count: computed(() => this.countOf(['top', 'dress'])) },
    { id: 'lower', label: 'Spodek', y: 64, categories: ['bottom'], count: computed(() => this.countOf(['bottom'])) },
    { id: 'feet', label: 'Boty', y: 91, categories: ['shoes'], count: computed(() => this.countOf(['shoes'])) },
  ];

  private countOf(categories: Category[]): number {
    return this.wardrobe.items().filter((i) => categories.includes(i.category)).length;
  }

  protected cycle(zone: CycleZone, dir: 1 | -1): void {
    const items = this.wardrobe.items().filter((i) => zone.categories.includes(i.category));
    if (!items.length) return;
    const worn = items.findIndex((i) => this.outfit.isWorn(i.id));
    // pořadí: kus 0 … kus n-1, „nic“ (index n), dokola
    const next = (worn < 0 ? items.length : worn) + dir;
    const index = (next + items.length + 1) % (items.length + 1);
    if (worn >= 0) this.outfit.remove(items[worn].id);
    if (index < items.length) this.outfit.wear(items[index]);
    else this.showToast(`${zone.label}: nic`);
  }

  private swipe: { x: number; y: number; t: number } | null = null;

  protected swipeStart(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    this.swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  /** Vodorovné přejetí prstem přes zónu postavy = další / předchozí kus v ní. */
  protected swipeEnd(e: PointerEvent): void {
    const start = this.swipe;
    this.swipe = null;
    if (!start || Date.now() - start.t > 700) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dy) > 60) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // avatar je v kontejneru vycentrovaný v poměru 688 : 1024
    const scale = Math.min(box.width / 688, box.height / 1024);
    const top = box.top + (box.height - 1024 * scale) / 2;
    const yPct = ((start.y - top) / (1024 * scale)) * 100;
    const zone = [...this.zones].filter((z) => z.count()).sort((a, b) => Math.abs(a.y - yPct) - Math.abs(b.y - yPct))[0];
    if (zone && Math.abs(zone.y - yPct) < 16) this.cycle(zone, dx < 0 ? 1 : -1);
  }

  protected openSave(): void {
    this.saveName.set(`Outfit ${this.outfit.saved().length + 1}`);
    this.saveOccasion.set(undefined);
    this.saving.set(true);
  }

  protected async confirmSave(): Promise<void> {
    const name = this.saveName().trim() || 'Outfit';
    await this.outfit.saveCurrent(name, this.saveOccasion());
    this.saving.set(false);
    this.showToast(`Uloženo: ${name}`);
  }

  private showToast(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 2200);
  }
}
