import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AvatarStore } from '../core/avatar.store';
import { AVATAR_H, AVATAR_W } from '../core/body-map';
import { OutfitLayer } from '../core/models';
import { WardrobeStore } from '../core/wardrobe.store';

/** Statický náhled avatara v outfitu (bez Konvy) – pro karty a seznamy. */
@Component({
  selector: 'app-outfit-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative mx-auto h-full" [style.aspect-ratio]="ratio">
      <img [src]="avatar.url()" alt="" class="absolute inset-0 size-full" [style]="avatarMask()" />
      @if (avatar.faceUrl(); as face) {
        <img [src]="face" alt="" class="absolute inset-0 size-full" />
      }
      @for (l of styled(); track l.itemId) {
        @if (l.url) {
          <img [src]="l.url" alt="" class="absolute max-w-none origin-top-left" [style]="l.style" />
        }
      }
    </div>
  `,
})
export class OutfitPreview {
  private readonly wardrobe = inject(WardrobeStore);
  readonly layers = input.required<OutfitLayer[]>();
  protected readonly avatar = inject(AvatarStore);
  protected readonly ratio = `${AVATAR_W} / ${AVATAR_H}`;

  /** Avatar „vygumovaný“ pod kusy, kde AI posunula ruce (maska mazání verze na postavu). */
  protected readonly avatarMask = computed(() => {
    const erase = this.layers()
      .map((l) => this.wardrobe.eraseUrl(l))
      .filter((u): u is string => !!u);
    if (!erase.length) return '';
    const images = [...erase.map((u) => `url(${u})`), 'linear-gradient(#000 0 0)'].join(',');
    const ops = erase.map(() => 'exclude').join(',');
    return `mask-image:${images};-webkit-mask-image:${images};mask-size:100% 100%;-webkit-mask-size:100% 100%;mask-composite:${ops};-webkit-mask-composite:${erase.map(() => 'xor').join(',')}`;
  });

  protected readonly styled = computed(() =>
    [...this.layers()]
      .sort((a, b) => a.z - b.z)
      .map((l) => ({
        itemId: l.itemId,
        url: this.wardrobe.layerUrl(l),
        style:
          `left:${(l.x / AVATAR_W) * 100}%;top:${(l.y / AVATAR_H) * 100}%;` +
          `width:${(l.w / AVATAR_W) * 100}%;height:${(l.h / AVATAR_H) * 100}%;` +
          `transform:rotate(${l.rotation}deg) scale(${l.scale})`,
      })),
  );
}
