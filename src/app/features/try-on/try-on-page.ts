import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Category, CATEGORIES, CATEGORY_LABEL, OCCASIONS, OutfitLayer } from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { OutfitStage } from './outfit-stage';

@Component({
  selector: 'app-try-on-page',
  imports: [RouterLink, NgTemplateOutlet, NgClass, Icon, OutfitStage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './try-on-page.html',
})
export class TryOnPage {
  protected readonly wardrobe = inject(WardrobeStore);
  protected readonly outfit = inject(OutfitStore);

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

  protected readonly wornItems = computed(() =>
    [...this.outfit.sortedLayers()]
      .reverse()
      .map((l) => ({ layer: l, item: this.wardrobe.byId().get(l.itemId) }))
      .filter((x) => !!x.item),
  );

  /** URL obrázku pro vrstvu – verze na postavu, nebo katalog. */
  protected readonly urlFor = computed(() => {
    this.wardrobe.items(); // přepočítat při změně šatníku
    return (l: OutfitLayer) => this.wardrobe.url(l.itemId, l.mode === 'fit' ? 'fit' : 'catalog');
  });

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
