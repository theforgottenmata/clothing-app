import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { OutfitLayer } from '../../core/models';
import { Icon } from '../../shared/icon';
import { LayerChange, OutfitStage } from './outfit-stage';

/**
 * Editor umístění jednoho kusu na avatarovi (posun, velikost, otočení).
 * Používá se při nahrání kusu a v detailu kusu – na obrazovce Vyzkoušet se nic neposouvá.
 */
@Component({
  selector: 'app-placement-editor',
  imports: [OutfitStage, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3' },
  template: `
    <div class="glass h-[min(56dvh,520px)] rounded-[28px] p-2">
      <app-outfit-stage class="h-full" [layers]="layers()" [selectedId]="layer()?.itemId ?? null" [urlFor]="urlFor()"
        [editable]="true" label="Nastavení umístění kusu na avatarovi" (layerChange)="onChange($event)" />
    </div>
    @if (layer(); as l) {
      <div class="flex items-center gap-3">
        <label class="flex flex-1 flex-col gap-1.5 text-[13px] text-ink-2">
          <span class="flex justify-between">Velikost <strong class="text-ink">{{ (l.scale * 100).toFixed(0) }} %</strong></span>
          <input type="range" min="0.5" max="1.8" step="0.01" [value]="l.scale" (input)="setScale(+$any($event.target).value)" class="accent-ink" />
        </label>
        <button type="button" class="btn-glass !rounded-2xl" (click)="reset.emit()"><app-icon name="reset" [size]="16" />Výchozí</button>
      </div>
    }
  `,
})
export class PlacementEditor {
  /** Upravovaná vrstva (obousměrně). */
  readonly layer = model<OutfitLayer | null>(null);
  /** Ostatní oblečené kusy pro kontext (needitovatelné). */
  readonly context = input<OutfitLayer[]>([]);
  readonly urlFor = input.required<(l: OutfitLayer) => string | undefined>();
  readonly reset = output<void>();

  protected readonly layers = computed(() => {
    const l = this.layer();
    return l ? [...this.context(), l] : this.context();
  });

  protected onChange(e: LayerChange): void {
    const l = this.layer();
    if (l && e.itemId === l.itemId) this.layer.set({ ...l, ...e.patch });
  }

  /** Změna velikosti kolem středu (pro dotykové displeje). */
  protected setScale(value: number): void {
    const l = this.layer();
    if (!l) return;
    const cx = l.x + (l.w * l.scale) / 2;
    const cy = l.y + (l.h * l.scale) / 2;
    this.layer.set({ ...l, scale: value, x: cx - (l.w * value) / 2, y: cy - (l.h * value) / 2 });
  }
}
