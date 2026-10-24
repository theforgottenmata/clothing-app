import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OCCASIONS, Outfit } from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { Icon } from '../../shared/icon';
import { OutfitPreview } from '../../shared/outfit-preview';

@Component({
  selector: 'app-outfits-page',
  imports: [RouterLink, Icon, OutfitPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-12 pb-32 lg:px-6 lg:pt-8">
      <header class="flex items-center justify-between">
        <h1 class="h-title">Moje outfity</h1>
        <a routerLink="/vyzkouset" class="btn-primary !h-11 !px-4 !text-sm"><app-icon name="plus" [size]="15" [stroke]="2.4" />Nový</a>
      </header>

      <div class="glass flex rounded-full p-1" role="tablist" aria-label="Příležitost">
        @for (o of tabs; track o) {
          <button type="button" role="tab" [attr.aria-selected]="occasion() === o"
            class="h-9 flex-1 rounded-full text-[13px] font-bold"
            [class.bg-white]="occasion() === o" [class.shadow-sm]="occasion() === o" [class.text-ink-2]="occasion() !== o"
            (click)="occasion.set(o)">{{ o }}</button>
        }
      </div>

      @if (filtered().length) {
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          @for (o of filtered(); track o.id) {
            <li class="glass flex flex-col gap-1 rounded-3xl p-2 pb-3">
              <button type="button" class="relative h-56 overflow-hidden rounded-[18px] bg-white/35 pt-1.5" (click)="wear(o)"
                [attr.aria-label]="'Obléct outfit ' + o.name">
                <app-outfit-preview class="h-full" [layers]="o.layers" />
              </button>
              <div class="flex items-start justify-between gap-1 px-1.5 pt-1">
                <div class="min-w-0">
                  <p class="truncate text-sm font-extrabold">{{ o.name }}</p>
                  <p class="text-xs text-ink-2">{{ o.occasion ?? 'Bez příležitosti' }} · {{ o.layers.length }} ks</p>
                </div>
                <button type="button" class="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-ink-2"
                  [attr.aria-label]="'Smazat ' + o.name" (click)="remove(o)"><app-icon name="trash" [size]="14" /></button>
              </div>
            </li>
          }
        </ul>
      } @else {
        <div class="glass flex flex-col items-center gap-3 rounded-3xl p-8 text-center">
          <p class="text-sm text-ink-2">Zatím žádný uložený outfit{{ occasion() !== 'Vše' ? ' pro „' + occasion() + '“' : '' }}.</p>
          <a routerLink="/vyzkouset" class="btn-primary !h-10 !text-sm">Poskládat outfit</a>
        </div>
      }
    </div>
  `,
})
export class OutfitsPage {
  private readonly outfit = inject(OutfitStore);
  private readonly router = inject(Router);

  protected readonly tabs = ['Vše', ...OCCASIONS.slice(0, 3)];
  protected readonly occasion = signal('Vše');
  protected readonly filtered = computed(() =>
    this.outfit.saved().filter((o) => this.occasion() === 'Vše' || o.occasion === this.occasion()),
  );

  protected wear(o: Outfit): void {
    this.outfit.load(o);
    this.router.navigateByUrl('/vyzkouset');
  }

  protected remove(o: Outfit): void {
    if (confirm(`Smazat outfit „${o.name}“?`)) this.outfit.deleteSaved(o.id);
  }
}
