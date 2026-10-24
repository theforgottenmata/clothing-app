import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const PATHS: Record<string, string> = {
  closet: 'M8 4l4 2 4-2 4 4-3 3v9H7v-9L4 8z',
  outfits: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  avatar: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  plus: 'M12 5v14M5 12h14',
  back: 'M19 12H5M11 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  layers: 'M12 3l9 5-9 5-9-5zM3 16l9 5 9-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  reset: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0012 3M19 9A7 7 0 007 6',
  heart: 'M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z',
  check: 'M5 12l5 5 9-10',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  hanger: 'M12 7a2 2 0 112 2c-1 .5-2 1-2 2M3 18l9-6 9 6z',
  download: 'M12 4v11m-4-4 4 4 4-4M5 19h14',
  upload: 'M12 15V4m-4 4 4-4 4 4M5 19h14',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor" [attr.stroke-width]="filled() ? 0 : stroke()" stroke-linecap="round" stroke-linejoin="round">
      <path [attr.d]="d()" />
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(20);
  readonly stroke = input(1.9);
  readonly filled = input(false);
  protected readonly d = computed(() => PATHS[this.name()] ?? '');
}
