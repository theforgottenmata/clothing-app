import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { AvatarApi } from '../../ai/avatar-api';
import { AvatarBody, AvatarHead, AvatarImages, AvatarStore, BodySize, Gender, SkinTone } from '../../core/avatar.store';
import { OutfitStore } from '../../core/outfit.store';
import { Icon } from '../../shared/icon';
import { OutfitPreview } from '../../shared/outfit-preview';

interface Option<T extends string = string> {
  value: T;
  label: string;
  swatch?: string;
}

const GENDERS: Option<Gender>[] = [
  { value: 'male', label: 'Muž' },
  { value: 'female', label: 'Žena' },
];
const SIZES: Option<BodySize>[] = [
  { value: 'S', label: 'Štíhlá' },
  { value: 'M', label: 'Střední' },
  { value: 'L', label: 'Silnější' },
  { value: 'XL', label: 'Robustní' },
];
const SKINS: Option<SkinTone>[] = [
  { value: 'light', label: 'Světlá', swatch: '#F1D3BF' },
  { value: 'medium', label: 'Střední', swatch: '#D9A57F' },
  { value: 'tan', label: 'Snědá', swatch: '#B57E55' },
  { value: 'dark', label: 'Tmavá', swatch: '#6E4630' },
];

/** Hodnoty jdou do promptu anglicky, popisky jsou české. */
const HEAD_GROUPS: { key: keyof AvatarHead; title: string; options: Option[] }[] = [
  {
    key: 'hair',
    title: 'Účes',
    options: [
      { value: 'short neat haircut', label: 'Krátký' },
      { value: 'short curly hair', label: 'Kudrnatý' },
      { value: 'buzz cut', label: 'Na ježka' },
      { value: 'messy medium-length hair', label: 'Rozcuchaný' },
      { value: 'chin-length bob', label: 'Mikádo' },
      { value: 'straight shoulder-length hair', label: 'Po ramena' },
      { value: 'hair tied in a bun on top of the head', label: 'Drdol' },
      { value: 'shaved bald head', label: 'Holá hlava' },
    ],
  },
  {
    key: 'hairColor',
    title: 'Barva vlasů',
    options: [
      { value: 'black', label: 'Černé', swatch: '#1E1B1A' },
      { value: 'dark brown', label: 'Tmavě hnědé', swatch: '#4A2F22' },
      { value: 'light brown', label: 'Světle hnědé', swatch: '#8A6342' },
      { value: 'blond', label: 'Blond', swatch: '#D9B66E' },
      { value: 'ginger red', label: 'Zrzavé', swatch: '#B4532A' },
      { value: 'grey', label: 'Šedivé', swatch: '#A7A7A7' },
    ],
  },
  {
    key: 'eyes',
    title: 'Oči',
    options: [
      { value: 'brown', label: 'Hnědé', swatch: '#6B4226' },
      { value: 'blue', label: 'Modré', swatch: '#4E86C6' },
      { value: 'green', label: 'Zelené', swatch: '#4E8A5B' },
      { value: 'grey', label: 'Šedé', swatch: '#8C959D' },
    ],
  },
  {
    key: 'beard',
    title: 'Vousy',
    options: [
      { value: 'none, clean shaven', label: 'Žádné' },
      { value: 'light stubble', label: 'Strniště' },
      { value: 'short full beard', label: 'Plnovous' },
      { value: 'moustache', label: 'Knír' },
    ],
  },
  {
    key: 'glasses',
    title: 'Brýle',
    options: [
      { value: 'none', label: 'Žádné' },
      { value: 'round thin-frame glasses', label: 'Kulaté' },
      { value: 'rectangular black-frame glasses', label: 'Hranaté' },
    ],
  },
];

type Busy = 'body' | 'head' | null;

@Component({
  selector: 'app-avatar-page',
  imports: [Icon, OutfitPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 pt-12 pb-32 lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:px-6 lg:pt-8">
      <!-- Náhled -->
      <section class="flex flex-col gap-3 lg:sticky lg:top-8 lg:self-start" aria-label="Náhled avatara">
        <header>
          <p class="text-sm text-ink-2">Tvoje virtuální verze</p>
          <h1 class="h-title">Můj avatar</h1>
        </header>
        <div class="glass relative h-[min(58dvh,520px)] overflow-hidden rounded-[28px] p-3">
          @if (draftUrl(); as src) {
            <img [src]="showOriginal() ? avatar.url() : src" alt="Nový avatar" class="mx-auto h-full object-contain" />
            <span class="absolute top-3 left-3 rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-white">
              {{ showOriginal() ? 'Současný' : 'Nový návrh' }}
            </span>
            <button type="button" class="glass-strong absolute top-3 right-3 rounded-full px-3 py-1.5 text-[11px] font-bold"
              (pointerdown)="showOriginal.set(true)" (pointerup)="showOriginal.set(false)" (pointerleave)="showOriginal.set(false)">
              Podržet = porovnat
            </button>
          } @else {
            <app-outfit-preview class="h-full" [layers]="outfit.layers()" />
          }
          @if (busy()) {
            <div class="analysis-overlay absolute inset-0" aria-hidden="true">
              <span class="analysis-grid absolute inset-0"></span>
              <span class="analysis-scan-line absolute inset-x-0 top-0"></span>
            </div>
            <span class="glass-strong absolute inset-x-3 bottom-3 rounded-full px-3 py-2.5 text-center text-xs font-bold" role="status">
              {{ busy() === 'body' ? 'Kreslím novou postavu' : 'Upravuji hlavu' }}… {{ elapsed() }} s
            </span>
          }
        </div>

        @if (draft()) {
          <div class="flex gap-2">
            <button type="button" class="btn-glass h-12 flex-1" (click)="discard()">Zahodit</button>
            <button type="button" class="btn-primary flex-[1.4]" (click)="apply()"><app-icon name="check" [size]="16" [stroke]="2.6" />Použít</button>
          </div>
        } @else if (busy()) {
          <button type="button" class="btn-glass h-12" (click)="cancel()">Zrušit</button>
        } @else if (avatar.isCustom()) {
          <button type="button" class="h-10 text-sm font-bold text-ink-2 underline underline-offset-4" (click)="resetToDefault()">Vrátit výchozího avatara</button>
        }

        @if (error(); as message) {
          <p role="alert" class="rounded-2xl bg-coral/15 px-4 py-3 text-sm font-semibold text-danger">{{ message }}</p>
        }
        @if (remaining() !== null) {
          <p class="text-center text-[11px] text-ink-2">Dnes zbývá {{ remaining() }} generování</p>
        }
      </section>

      <div class="flex flex-col gap-5">
        <!-- Tělo -->
        <section class="glass flex flex-col gap-4 rounded-[26px] p-4" aria-labelledby="body-heading">
          <div>
            <h2 id="body-heading" class="text-lg font-extrabold">Postava</h2>
            <p class="mt-0.5 text-xs leading-relaxed text-ink-2">
              Nakreslí novou postavu. Oblečení se na ni pak musí znovu vygenerovat, proto bude změna postavy později placená.
            </p>
          </div>
          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Pohlaví</legend>
            <div class="glass flex rounded-full p-1">
              @for (o of genders; track o.value) {
                <button type="button" class="h-10 flex-1 rounded-full text-sm font-bold" [class.bg-ink]="body().gender === o.value"
                  [class.text-white]="body().gender === o.value" [attr.aria-pressed]="body().gender === o.value" (click)="setBody('gender', o.value)">
                  {{ o.label }}
                </button>
              }
            </div>
          </fieldset>
          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Postava</legend>
            <div class="flex flex-wrap gap-1.5">
              @for (o of sizes; track o.value) {
                <button type="button" class="chip" [class.chip-on]="body().size === o.value" (click)="setBody('size', o.value)">{{ o.label }}</button>
              }
            </div>
          </fieldset>
          <fieldset class="flex flex-col gap-1.5">
            <legend class="label mb-1.5">Pleť</legend>
            <div class="flex flex-wrap gap-1.5">
              @for (o of skins; track o.value) {
                <button type="button" class="chip" [class.chip-on]="body().skin === o.value" (click)="setBody('skin', o.value)">
                  <span class="size-3 rounded-full ring-1 ring-ink/20" [style.background]="o.swatch"></span>{{ o.label }}
                </button>
              }
            </div>
          </fieldset>
          <button type="button" class="btn-primary" [disabled]="!!busy() || !bodyChanged()" (click)="generateBody()">
            <app-icon name="sparkle" [size]="17" />Vytvořit postavu
          </button>
        </section>

        <!-- Hlava -->
        <section class="glass flex flex-col gap-4 rounded-[26px] p-4" aria-labelledby="head-heading">
          <div>
            <h2 id="head-heading" class="text-lg font-extrabold">Vzhled</h2>
            <p class="mt-0.5 text-xs leading-relaxed text-ink-2">Mění se jen hlava, postava a oblečení zůstanou. Zdarma.</p>
          </div>
          @for (g of headGroups; track g.key) {
            <fieldset class="flex flex-col gap-1.5">
              <legend class="label mb-1.5">{{ g.title }}</legend>
              <div class="flex flex-wrap gap-1.5">
                @for (o of g.options; track o.value) {
                  <button type="button" class="chip" [class.chip-on]="head()[g.key] === o.value" (click)="toggleHead(g.key, o.value)">
                    @if (o.swatch) {
                      <span class="size-3 rounded-full ring-1 ring-ink/20" [style.background]="o.swatch"></span>
                    }
                    {{ o.label }}
                  </button>
                }
              </div>
            </fieldset>
          }
          <button type="button" class="btn-primary" [disabled]="!!busy() || !headChanged()" (click)="generateHead()">
            <app-icon name="sparkle" [size]="17" />Upravit vzhled
          </button>
          <p class="-mt-2 text-center text-[11px] text-ink-2">Nevybraná pole zůstanou, jak jsou.</p>
        </section>
      </div>
    </div>
  `,
})
export class AvatarPage implements OnDestroy {
  protected readonly avatar = inject(AvatarStore);
  protected readonly outfit = inject(OutfitStore);
  private readonly api = inject(AvatarApi);

  protected readonly genders = GENDERS;
  protected readonly sizes = SIZES;
  protected readonly skins = SKINS;
  protected readonly headGroups = HEAD_GROUPS;

  protected readonly body = signal<AvatarBody>(this.avatar.meta()?.body ?? { gender: 'male', size: 'M', skin: 'medium' });
  /** Jen změny hlavy, které se mají poslat (nevybrané = beze změny). */
  protected readonly head = signal<AvatarHead>({});
  protected readonly busy = signal<Busy>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly elapsed = signal(0);
  protected readonly remaining = signal<number | null>(null);
  protected readonly showOriginal = signal(false);

  /** Vygenerovaný návrh čekající na Použít / Zahodit. */
  protected readonly draft = signal<{ images: AvatarImages; body: AvatarBody | null; head: AvatarHead } | null>(null);
  protected readonly draftUrl = signal<string | null>(null);

  protected readonly bodyChanged = computed(() => {
    const current = this.avatar.meta()?.body;
    const b = this.body();
    return !current || current.gender !== b.gender || current.size !== b.size || current.skin !== b.skin;
  });
  protected readonly headChanged = computed(() => Object.values(this.head()).some(Boolean));

  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;

  ngOnDestroy(): void {
    this.abort?.abort();
    this.stopTimer();
    this.setDraftUrl(null);
  }

  protected setBody<K extends keyof AvatarBody>(key: K, value: AvatarBody[K]): void {
    this.body.update((b) => ({ ...b, [key]: value }));
  }

  protected toggleHead(key: keyof AvatarHead, value: string): void {
    this.head.update((h) => ({ ...h, [key]: h[key] === value ? undefined : value }));
  }

  protected generateBody(): void {
    if (this.avatar.isCustom() && !confirm('Nová postava nahradí současnou i její vzhled. Oblečení bude potřeba na ni znovu vygenerovat. Pokračovat?')) {
      return;
    }
    const body = this.body();
    this.run('body', (signal) => this.api.createBody(body, signal), body, {});
  }

  protected async generateHead(): Promise<void> {
    const head = this.head();
    // Podklad: rozpracovaný návrh postavy, jinak současný avatar.
    const draft = this.draft();
    const base = draft?.images.opaque ?? (await this.avatar.opaque());
    const body = draft ? draft.body : (this.avatar.meta()?.body ?? null);
    const prevHead = draft ? draft.head : (this.avatar.meta()?.head ?? {});
    this.run('head', (signal) => this.api.changeHead(base, head, signal), body, { ...prevHead, ...clean(head) });
  }

  protected async apply(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    await this.avatar.save({ body: d.body ?? this.body(), head: d.head, updatedAt: Date.now() }, d.images);
    this.head.set({});
    this.draft.set(null);
    this.setDraftUrl(null);
  }

  protected discard(): void {
    this.draft.set(null);
    this.setDraftUrl(null);
  }

  protected cancel(): void {
    this.abort?.abort();
  }

  protected async resetToDefault(): Promise<void> {
    if (!confirm('Vrátit výchozího avatara? Tvůj vlastní avatar se smaže.')) return;
    await this.avatar.reset();
    this.body.set({ gender: 'male', size: 'M', skin: 'medium' });
  }

  private async run(
    kind: Exclude<Busy, null>,
    call: (signal: AbortSignal) => Promise<AvatarImages & { remainingToday: number }>,
    body: AvatarBody | null,
    head: AvatarHead,
  ): Promise<void> {
    this.error.set(null);
    this.busy.set(kind);
    this.abort = new AbortController();
    this.startTimer();
    scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const result = await call(this.abort.signal);
      this.remaining.set(result.remainingToday);
      this.draft.set({ images: { opaque: result.opaque, transparent: result.transparent }, body, head });
      this.setDraftUrl(URL.createObjectURL(result.transparent));
    } catch (error) {
      if (!this.abort.signal.aborted) this.error.set(error instanceof Error ? error.message : 'Generování se nepodařilo.');
    } finally {
      this.stopTimer();
      this.busy.set(null);
    }
  }

  private setDraftUrl(url: string | null): void {
    if (this.draftUrl()) URL.revokeObjectURL(this.draftUrl()!);
    this.draftUrl.set(url);
  }

  private startTimer(): void {
    this.elapsed.set(0);
    const started = Date.now();
    this.timer = setInterval(() => this.elapsed.set(Math.round((Date.now() - started) / 1000)), 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function clean(head: AvatarHead): AvatarHead {
  return Object.fromEntries(Object.entries(head).filter(([, v]) => !!v));
}
