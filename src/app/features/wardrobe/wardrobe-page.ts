import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Category, CATEGORIES, CATEGORY_LABEL, WardrobeItem } from '../../core/models';
import { OutfitStore } from '../../core/outfit.store';
import { WardrobeStore } from '../../core/wardrobe.store';
import { Icon } from '../../shared/icon';
import { OutfitPreview } from '../../shared/outfit-preview';

@Component({
  selector: 'app-wardrobe-page',
  imports: [RouterLink, Icon, OutfitPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-12 pb-32 lg:px-6 lg:pt-8">
      <header class="flex items-end justify-between gap-3">
        <div>
          <p class="text-sm text-ink-2">Ahoj</p>
          <h1 class="h-title">Co si dnes vezmeš?</h1>
        </div>
        <a routerLink="/pridat" class="btn-primary hidden !h-11 lg:inline-flex"><app-icon name="plus" [size]="16" [stroke]="2.4" />Přidat kus</a>
      </header>

      <label class="glass flex h-12 items-center gap-2.5 rounded-2xl px-3.5 text-ink-2">
        <app-icon name="search" [size]="16" />
        <span class="sr-only">Hledat v šatníku</span>
        <input type="search" placeholder="Hledat v šatníku" [value]="query()" (input)="query.set($any($event.target).value)"
          class="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-2/70" />
      </label>

      <section aria-label="Aktuální outfit" class="glass relative flex h-40 overflow-hidden rounded-[26px]">
        <div class="flex flex-1 flex-col gap-1.5 p-4">
          <span class="text-xs font-bold text-ink-2">Na avatarovi právě</span>
          <span class="text-lg leading-tight font-extrabold tracking-tight">
            @if (outfit.layers().length) { {{ outfit.layers().length }} {{ kusu(outfit.layers().length) }} } @else { Zatím nic }
          </span>
          <span class="text-xs text-ink-2">{{ wornNames() || 'Vyber kusy a poskládej outfit' }}</span>
          <a routerLink="/vyzkouset" class="btn-primary mt-auto !h-9 self-start !px-4 !text-[13px]">
            {{ outfit.layers().length ? 'Pokračovat' : 'Začít' }}
          </a>
        </div>
        <app-outfit-preview class="mt-1 h-[176px] w-[120px] shrink-0" [layers]="outfit.layers()" />
      </section>

      <div class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Kategorie">
        <button type="button" class="chip" [class.chip-on]="!category()" (click)="category.set(null)">Vše</button>
        @for (c of categories; track c) {
          <button type="button" class="chip" [class.chip-on]="category() === c" (click)="category.set(c)">{{ label[c] }}</button>
        }
        <button type="button" class="chip" [class.chip-on]="favOnly()" (click)="favOnly.set(!favOnly())">
          <app-icon name="heart" [size]="13" [filled]="true" class="text-coral" />Oblíbené
        </button>
      </div>

      @if (filtered().length) {
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          @for (item of filtered(); track item.id) {
            <li class="glass relative flex flex-col gap-1 rounded-[22px] p-2.5 pb-3">
              <button type="button" class="flex h-32 items-center justify-center rounded-2xl" (click)="tryOn(item)"
                [attr.aria-label]="'Vyzkoušet ' + item.name">
                @if (wardrobe.url(item.id, 'catalog'); as src) {
                  <img [src]="src" alt="" class="max-h-[118px] max-w-full object-contain" />
                }
              </button>
              <span class="px-1 text-sm font-bold">{{ item.name }}</span>
              <span class="px-1 text-xs text-ink-2">{{ label[item.category] }} · {{ item.catalogSource === 'ai' ? 'AI' : 'Foto' }}</span>
              <div class="absolute top-2 right-2 flex gap-1">
                <button type="button" class="flex size-8 items-center justify-center rounded-full bg-white/70"
                  [attr.aria-label]="item.favorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'" [attr.aria-pressed]="item.favorite"
                  (click)="wardrobe.update(item.id, { favorite: !item.favorite })">
                  <app-icon name="heart" [size]="14" [filled]="true" [class.text-coral]="item.favorite" [class.text-line]="!item.favorite" />
                </button>
                <button type="button" class="flex size-8 items-center justify-center rounded-full bg-white/70 text-ink-2"
                  [attr.aria-label]="'Smazat ' + item.name" (click)="remove(item)">
                  <app-icon name="trash" [size]="14" />
                </button>
              </div>
              @if (outfit.isWorn(item.id)) {
                <span class="absolute top-2 left-2 flex size-6 items-center justify-center rounded-full bg-ink text-white" title="Na avatarovi">
                  <app-icon name="check" [size]="12" [stroke]="3" />
                </span>
              }
              <button type="button" class="absolute right-2.5 bottom-2.5 flex size-8 items-center justify-center rounded-full bg-ink text-white"
                [attr.aria-label]="'Obléct ' + item.name" (click)="outfit.wear(item)">
                <app-icon name="plus" [size]="15" [stroke]="2.4" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <div class="glass rounded-[22px] p-8 text-center text-sm text-ink-2">
          Nic tu není. <a routerLink="/pridat" class="font-bold text-ink">Přidej první kus</a>.
        </div>
      }
    </div>
  `,
})
export class WardrobePage {
  protected readonly wardrobe = inject(WardrobeStore);
  protected readonly outfit = inject(OutfitStore);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly query = signal('');
  protected readonly category = signal<Category | null>(null);
  protected readonly favOnly = signal(false);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.wardrobe
      .items()
      .filter((i) => !this.category() || i.category === this.category())
      .filter((i) => !this.favOnly() || i.favorite)
      .filter((i) => !q || i.name.toLowerCase().includes(q));
  });

  protected readonly wornNames = computed(() =>
    this.outfit
      .sortedLayers()
      .map((l) => this.wardrobe.byId().get(l.itemId)?.name)
      .filter(Boolean)
      .join(' · '),
  );

  protected kusu(n: number): string {
    return n === 1 ? 'kus' : n < 5 ? 'kusy' : 'kusů';
  }

  protected tryOn(item: WardrobeItem): void {
    this.outfit.wear(item);
    this.router.navigateByUrl('/vyzkouset');
  }

  protected remove(item: WardrobeItem): void {
    if (confirm(`Smazat „${item.name}“ ze šatníku?`)) this.wardrobe.remove(item.id);
  }
}
