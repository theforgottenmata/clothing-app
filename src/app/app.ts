import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Icon } from './shared/icon';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div class="absolute -top-24 -left-24 size-[420px] rounded-full bg-line opacity-60 blur-[90px]"></div>
      <div class="absolute -right-24 -bottom-32 size-[460px] rounded-full bg-[#DDE1E5] opacity-80 blur-[90px]"></div>
    </div>

    <div class="flex min-h-dvh">
      <!-- Desktop: úzká skleněná navigace -->
      <nav aria-label="Hlavní navigace" class="glass sticky top-5 m-5 hidden h-[calc(100dvh-40px)] w-[84px] shrink-0 flex-col items-center gap-2 rounded-[28px] py-5 lg:flex">
        <div class="mb-4 flex size-11 items-center justify-center rounded-2xl bg-ink text-white"><app-icon name="closet" /></div>
        @for (n of nav; track n.path) {
          <a [routerLink]="n.path" routerLinkActive="!bg-white/80 !text-ink shadow-[0_4px_12px_rgb(31_35_40/0.08)]"
            class="flex w-16 flex-col items-center gap-1 rounded-2xl py-2.5 text-ink-2 no-underline">
            <app-icon [name]="n.icon" [size]="22" />
            <span class="text-[11px] font-bold">{{ n.label }}</span>
          </a>
        }
        <a routerLink="/pridat" aria-label="Přidat kus" class="mt-auto flex size-13 items-center justify-center rounded-full bg-ink text-white shadow-[0_8px_20px_rgb(31_35_40/0.25)]">
          <app-icon name="plus" [size]="22" [stroke]="2.4" />
        </a>
      </nav>

      <main class="min-w-0 flex-1">
        <router-outlet />
      </main>
    </div>

    <!-- Mobil: plovoucí skleněná navigace -->
    @if (showMobileNav()) {
      <nav aria-label="Hlavní navigace" class="glass-strong fixed inset-x-3.5 bottom-4 z-40 flex h-[68px] items-center justify-around rounded-[26px] lg:hidden">
        @for (n of mobileNav; track n.path) {
          @if (n.path === '/pridat') {
            <a routerLink="/pridat" aria-label="Přidat kus" class="flex size-13 items-center justify-center rounded-full bg-ink text-white shadow-[0_8px_20px_rgb(31_35_40/0.25)]">
              <app-icon name="plus" [size]="22" [stroke]="2.4" />
            </a>
          } @else {
            <a [routerLink]="n.path" routerLinkActive="!text-ink" class="flex min-w-14 flex-col items-center gap-0.5 text-mist no-underline">
              <app-icon [name]="n.icon" [size]="22" />
              <span class="text-[11px] font-bold">{{ n.label }}</span>
            </a>
          }
        }
      </nav>
    }
  `,
})
export class App {
  private readonly router = inject(Router);
  protected readonly nav: NavItem[] = [
    { path: '/satnik', label: 'Šatník', icon: 'closet' },
    { path: '/vyzkouset', label: 'Vyzkoušet', icon: 'hanger' },
    { path: '/outfity', label: 'Outfity', icon: 'outfits' },
  ];
  protected readonly mobileNav: NavItem[] = [
    { path: '/satnik', label: 'Šatník', icon: 'closet' },
    { path: '/vyzkouset', label: 'Vyzkoušet', icon: 'hanger' },
    { path: '/pridat', label: 'Přidat', icon: 'plus' },
    { path: '/outfity', label: 'Outfity', icon: 'outfits' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** Vyzkoušet a Přidat mají na mobilu vlastní spodní panel – navigaci schováme. */
  protected readonly showMobileNav = computed(() => !/^\/(vyzkouset|pridat)/.test(this.url()));
}
