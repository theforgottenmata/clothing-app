import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  BottomLength,
  Category,
  CATEGORIES,
  CATEGORY_LABEL,
  COLORS,
  OCCASIONS,
  OutfitLayer,
  SEASONS,
  WardrobeItem,
  WEATHER,
} from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { OutfitPreview } from '../../shared/outfit-preview';
import { PlacementEditor } from '../try-on/placement-editor';

type ListKey = 'seasons' | 'weather' | 'occasions';

@Component({
  selector: 'app-item-page',
  imports: [RouterLink, Icon, OutfitPreview, PlacementEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './item-page.html',
})
export class ItemPage implements OnDestroy {
  protected readonly wardrobe = inject(WardrobeStore);
  private readonly outfit = inject(OutfitStore);
  private readonly router = inject(Router);

  /** :id z routy */
  readonly id = input.required<string>();

  protected readonly categories = CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly colors = COLORS;
  protected readonly groups: { key: ListKey; title: string; options: string[] }[] = [
    { key: 'seasons', title: 'Sezóna', options: SEASONS },
    { key: 'weather', title: 'Počasí', options: WEATHER },
    { key: 'occasions', title: 'Příležitost', options: OCCASIONS },
  ];

  protected readonly item = computed(() => this.wardrobe.byId().get(this.id()) ?? null);
  protected readonly showPhoto = signal(false);
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly draft = signal<OutfitLayer | null>(null);

  /** Náhled „Na tobě“: ostatní oblečené kusy + tento kus. */
  protected readonly previewLayers = computed(() => {
    const item = this.item();
    return item ? [...this.outfit.contextFor(item), this.outfit.layerFor(item)] : [];
  });
  protected readonly context = computed(() => {
    const item = this.item();
    return item ? this.outfit.contextFor(item) : [];
  });
  protected readonly urlFor = computed(() => {
    this.wardrobe.items();
    return (l: OutfitLayer) => this.wardrobe.url(l.itemId, l.mode === 'fit' ? 'fit' : 'catalog');
  });

  constructor() {
    effect(async () => {
      const id = this.id();
      const url = await this.wardrobe.photoUrl(id);
      this.photoUrl.set(url ?? null);
    });
  }

  ngOnDestroy(): void {
    if (this.photoUrl()) URL.revokeObjectURL(this.photoUrl()!);
  }

  protected async patch(patch: Partial<WardrobeItem>): Promise<void> {
    const item = this.item();
    if (!item) return;
    await this.wardrobe.update(item.id, patch);
    if ('category' in patch || 'placement' in patch) this.outfit.refresh(this.item()!);
  }

  protected rename(value: string): void {
    const name = value.trim();
    if (name && name !== this.item()?.name) this.patch({ name });
  }

  protected setCategory(category: Category): void {
    // Uložené umístění patří ke kategorii – při změně typu se vrátí výchozí.
    this.patch({ category, placement: undefined, bottomLength: category === 'bottom' ? (this.item()?.bottomLength ?? 'long') : undefined });
  }

  protected setLength(bottomLength: BottomLength): void {
    this.patch({ bottomLength });
  }

  protected toggle(key: ListKey, value: string): void {
    const list = this.item()?.[key] ?? [];
    this.patch({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  }

  protected wear(): void {
    const item = this.item();
    if (!item) return;
    this.outfit.wear(item);
    this.router.navigateByUrl('/vyzkouset');
  }

  protected startEdit(): void {
    const item = this.item();
    if (!item) return;
    this.draft.set(this.outfit.layerFor(item));
    this.editing.set(true);
  }

  protected resetDraft(): void {
    const item = this.item();
    if (item) this.draft.set(this.outfit.layerFor(item, { ignorePlacement: true }));
  }

  protected async savePlacement(): Promise<void> {
    const d = this.draft();
    if (d) await this.patch({ placement: { x: d.x, y: d.y, w: d.w, h: d.h, scale: d.scale, rotation: d.rotation } });
    this.editing.set(false);
  }

  protected async remove(): Promise<void> {
    const item = this.item();
    if (!item || !confirm(`Smazat „${item.name}“ ze šatníku?`)) return;
    await this.wardrobe.remove(item.id);
    this.router.navigateByUrl('/satnik');
  }
}
