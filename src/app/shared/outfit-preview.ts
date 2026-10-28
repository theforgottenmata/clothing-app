import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AvatarStore } from '../core/avatar.store';
import { AVATAR_H, AVATAR_W, erasesBelow } from '../core/body-map';
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
  protected readonly avatarMask = computed(() =>
    maskStyle(
      this.layers()
        .map((l) => this.wardrobe.eraseUrl(l))
        .filter((u): u is string => !!u),
    ),
  );

  protected readonly styled = computed(() =>
    [...this.layers()]
      .sort((a, b) => a.z - b.z)
      .map((l, _, all) => {
        // bunda nad vrškem / šaty: její maska mazání gumuje i je (stejně jako na plátně Vyzkoušet)
        const cat = this.wardrobe.byId().get(l.itemId)?.category;
        const erasers = cat
          ? all
              .filter((o) => o.z > l.z && erasesBelow(this.wardrobe.byId().get(o.itemId)?.category ?? 'accessory', cat))
              .map((o) => this.wardrobe.eraseUrl(o))
              .filter((u): u is string => !!u)
          : [];
        // maska je v prostoru avatara – obrázek vrstvy je ale oříznutý na fitBox, proto se posune
        const mask = erasers.length
          ? maskStyle(erasers, `${pct(l.x, AVATAR_W - l.w)} ${pct(l.y, AVATAR_H - l.h)}`, `${(AVATAR_W / l.w) * 100}% ${(AVATAR_H / l.h) * 100}%`)
          : '';
        return {
          itemId: l.itemId,
          url: this.wardrobe.layerUrl(l),
          style:
            `left:${(l.x / AVATAR_W) * 100}%;top:${(l.y / AVATAR_H) * 100}%;` +
            `width:${(l.w / AVATAR_W) * 100}%;height:${(l.h / AVATAR_H) * 100}%;` +
            `transform:rotate(${l.rotation}deg) scale(${l.scale});` +
            mask,
        };
      }),
  );
}

/** CSS maska „vygumuj tyhle obrázky“ (bílá s alfou = gumovat). */
function maskStyle(erase: string[], position = '0 0', size = '100% 100%'): string {
  if (!erase.length) return '';
  const images = [...erase.map((u) => `url(${u})`), 'linear-gradient(#000 0 0)'].join(',');
  const pos = [...erase.map(() => position), '0 0'].join(',');
  const sz = [...erase.map(() => size), '100% 100%'].join(',');
  return (
    `mask-image:${images};-webkit-mask-image:${images};mask-position:${pos};-webkit-mask-position:${pos};` +
    `mask-size:${sz};-webkit-mask-size:${sz};mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;` +
    `mask-composite:${erase.map(() => 'exclude').join(',')};-webkit-mask-composite:${erase.map(() => 'xor').join(',')}`
  );
}

/** Procento pro mask-position: posun = (kontejner − maska) · p, chceme posun −offset. */
function pct(offset: number, diff: number): string {
  return diff ? `${(-offset / -diff) * 100}%` : '0%';
}
