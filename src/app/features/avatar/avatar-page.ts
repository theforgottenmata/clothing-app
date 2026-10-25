import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AvatarBody, AvatarStore, BodySize, DEFAULT_BODY, Gender, SkinTone } from '../../core/avatar.store';
import { OutfitStore } from '../../core/outfit.store';
import { Icon } from '../../shared/icon';
import { OutfitPreview } from '../../shared/outfit-preview';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Muž' },
  { value: 'female', label: 'Žena' },
];
const SIZES: { value: BodySize; label: string }[] = [
  { value: 'S', label: 'Štíhlá' },
  { value: 'M', label: 'Střední' },
  { value: 'L', label: 'Silnější' },
  { value: 'XL', label: 'Robustní' },
];
const SKINS: { value: SkinTone; label: string; swatch: string }[] = [
  { value: 'light', label: 'Světlá', swatch: '#F1D3BF' },
  { value: 'medium', label: 'Střední', swatch: '#D9A57F' },
  { value: 'tan', label: 'Snědá', swatch: '#B57E55' },
  { value: 'dark', label: 'Tmavá', swatch: '#6E4630' },
];

@Component({
  selector: 'app-avatar-page',
  imports: [Icon, OutfitPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 pt-12 pb-32 lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:px-6 lg:pt-8">
      <section class="flex flex-col gap-3 lg:sticky lg:top-8 lg:self-start" aria-label="Náhled avatara">
        <header>
          <p class="text-sm text-ink-2">Tvoje virtuální verze</p>
          <h1 class="h-title">Můj avatar</h1>
        </header>
        <div class="glass relative h-[min(56dvh,520px)] overflow-hidden rounded-[28px] p-3">
          <app-outfit-preview class="h-full" [layers]="outfit.layers()" />
          @if (!avatar.ready()) {
            <p class="glass-strong absolute inset-x-3 bottom-3 rounded-2xl px-3 py-2.5 text-center text-xs font-semibold text-ink-2" role="status">
              Tahle postava v knihovně zatím chybí – zobrazuje se výchozí avatar.
            </p>
          }
        </div>
      </section>

      <div class="flex flex-col gap-5">
        <section class="glass flex flex-col gap-4 rounded-[26px] p-4" aria-labelledby="body-heading">
          <div>
            <h2 id="body-heading" class="text-lg font-extrabold">Postava</h2>
            <p class="mt-0.5 text-xs leading-relaxed text-ink-2">Podle postavy se na avatara kreslí oblečení. Přepnutí je okamžité.</p>
          </div>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Pohlaví</legend>
            <div class="glass flex rounded-full p-1">
              @for (o of genders; track o.value) {
                <button type="button" class="h-10 flex-1 rounded-full text-sm font-bold" [class.bg-ink]="body().gender === o.value"
                  [class.text-white]="body().gender === o.value" [attr.aria-pressed]="body().gender === o.value" (click)="set('gender', o.value)">
                  {{ o.label }}
                </button>
              }
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Postava</legend>
            <div class="grid grid-cols-4 gap-2">
              @for (o of sizes; track o.value) {
                <button type="button" class="flex flex-col items-center gap-1 rounded-2xl border-2 bg-white/50 pt-2 pb-1.5 text-xs font-bold"
                  [class.border-ink]="body().size === o.value" [class.border-transparent]="body().size !== o.value"
                  [attr.aria-pressed]="body().size === o.value" (click)="set('size', o.value)">
                  <span class="relative h-24 w-[64px]">
                    <img [src]="avatar.urlFor(with('size', o.value))" alt="" class="absolute inset-0 size-full object-contain" loading="lazy" />
                    @if (avatar.faceFor(with('size', o.value)); as face) {
                      <img [src]="face" alt="" class="absolute inset-0 size-full object-contain" loading="lazy" />
                    }
                  </span>
                  {{ o.label }}
                </button>
              }
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Pleť</legend>
            <div class="flex flex-wrap gap-1.5">
              @for (o of skins; track o.value) {
                <button type="button" class="chip" [class.chip-on]="body().skin === o.value" (click)="set('skin', o.value)">
                  <span class="size-3 rounded-full ring-1 ring-ink/20" [style.background]="o.swatch"></span>{{ o.label }}
                </button>
              }
            </div>
          </fieldset>

          @if (available() < 32) {
            <p class="rounded-2xl bg-white/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
              V knihovně je {{ available() }} z 32 postav. Chybějící vygeneruješ příkazem
              <code class="font-mono">node --env-file=.env tools/avatar-library.mjs --run</code>.
            </p>
          }
        </section>

        <section class="glass flex flex-col gap-2 rounded-[26px] p-4 opacity-80" aria-labelledby="face-heading">
          <div class="flex items-center justify-between">
            <h2 id="face-heading" class="text-lg font-extrabold">Obličej</h2>
            <span class="rounded-full bg-ink px-2.5 py-1 text-[10px] font-extrabold text-white">Připravujeme</span>
          </div>
          <p class="text-xs leading-relaxed text-ink-2">Účes, barva vlasů, oči, vousy a brýle – samostatná vrstva přes hlavu, na oblečení nemá vliv. Zatím se používá výchozí obličej.</p>
          <div class="flex gap-2 text-ink-2" aria-hidden="true">
            @for (i of ['Účes', 'Vlasy', 'Oči', 'Vousy', 'Brýle']; track i) {
              <span class="rounded-full border border-dashed border-line px-3 py-1.5 text-[11px] font-bold">{{ i }}</span>
            }
          </div>
        </section>

        @if (changed()) {
          <button type="button" class="h-10 self-center text-sm font-bold text-ink-2 underline underline-offset-4" (click)="reset()">
            <app-icon name="reset" [size]="14" class="mr-1 inline" />Vrátit výchozí postavu
          </button>
        }
      </div>
    </div>
  `,
})
export class AvatarPage {
  protected readonly avatar = inject(AvatarStore);
  protected readonly outfit = inject(OutfitStore);

  protected readonly genders = GENDERS;
  protected readonly sizes = SIZES;
  protected readonly skins = SKINS;

  protected readonly body = this.avatar.body;
  protected readonly available = computed(() => this.avatar.available().size);
  protected readonly changed = computed(() => {
    const b = this.body();
    return b.gender !== DEFAULT_BODY.gender || b.size !== DEFAULT_BODY.size || b.skin !== DEFAULT_BODY.skin;
  });

  protected set<K extends keyof AvatarBody>(key: K, value: AvatarBody[K]): void {
    this.avatar.setBody(this.with(key, value));
  }

  protected with<K extends keyof AvatarBody>(key: K, value: AvatarBody[K]): AvatarBody {
    return { ...this.body(), [key]: value };
  }

  protected reset(): void {
    this.avatar.setBody(DEFAULT_BODY);
  }
}
