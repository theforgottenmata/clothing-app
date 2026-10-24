import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import Konva from 'konva';
import { AVATAR_H, AVATAR_URL, AVATAR_W } from '../../core/body-map';
import { OutfitLayer } from '../../core/models';

export interface LayerChange {
  itemId: string;
  patch: Partial<OutfitLayer>;
}

/**
 * Plátno s avatarem a vrstvami oblečení (Konva).
 * Vše se počítá v logickém prostoru avatara 688×1024 a plátno se jen škáluje do kontejneru.
 */
@Component({
  selector: 'app-outfit-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative' },
  template: `<div #host class="absolute inset-0 touch-none" role="img" [attr.aria-label]="label()"></div>`,
})
export class OutfitStage {
  readonly layers = input.required<OutfitLayer[]>();
  readonly selectedId = input<string | null>(null);
  /** Vrátí URL obrázku pro vrstvu (verze na postavu nebo katalog). */
  readonly urlFor = input.required<(layer: OutfitLayer) => string | undefined>();
  readonly label = input('Avatar s oblečením');

  readonly selectChange = output<string | null>();
  readonly layerChange = output<LayerChange>();

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private stage?: Konva.Stage;
  private root?: Konva.Group;
  private garmentLayer?: Konva.Layer;
  private transformer?: Konva.Transformer;
  private readonly nodes = new Map<string, Konva.Image>();
  private readonly nodeUrls = new Map<string, string>();
  private readonly images = new Map<string, HTMLImageElement>();

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.createStage();
      this.sync();
      const ro = new ResizeObserver(() => this.fit());
      ro.observe(this.hostRef().nativeElement);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        this.stage?.destroy();
      });
    });

    effect(() => {
      this.layers();
      this.selectedId();
      this.urlFor();
      if (this.stage) this.sync();
    });
  }

  private createStage(): void {
    const el = this.hostRef().nativeElement;
    this.stage = new Konva.Stage({ container: el, width: el.clientWidth || 300, height: el.clientHeight || 450 });
    const base = new Konva.Layer({ listening: true });
    this.garmentLayer = new Konva.Layer();
    this.root = new Konva.Group();
    const garmentRoot = new Konva.Group({ name: 'garment-root' });

    // Měkký stín pod nohama + avatar
    base.add(
      new Konva.Ellipse({ x: AVATAR_W / 2, y: 985, radiusX: 120, radiusY: 16, fill: 'rgba(31,35,40,0.14)', listening: false }),
    );
    const avatar = new Konva.Image({ image: undefined, width: AVATAR_W, height: AVATAR_H, name: 'avatar' });
    this.getImage(AVATAR_URL).then((img) => {
      avatar.image(img);
      base.batchDraw();
    });
    base.add(avatar);

    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      keepRatio: true,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      anchorSize: 14,
      anchorCornerRadius: 7,
      anchorFill: '#FFFFFF',
      anchorStroke: '#1F2328',
      anchorStrokeWidth: 2,
      borderStroke: '#1F2328',
      borderDash: [6, 4],
      rotateAnchorOffset: 28,
      padding: 4,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 30 || Math.abs(newBox.height) < 30 ? oldBox : newBox),
    });
    this.garmentLayer.add(garmentRoot, this.transformer);

    // Kliknutí do prázdna / na avatara zruší výběr
    this.stage.on('click tap', (e) => {
      if (e.target === this.stage || e.target.name() === 'avatar') this.selectChange.emit(null);
    });

    this.stage.add(base, this.garmentLayer);
    this.fit();
  }

  /** Přizpůsobí plátno velikosti kontejneru (avatar vždy celý a vycentrovaný). */
  private fit(): void {
    if (!this.stage) return;
    const el = this.hostRef().nativeElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    this.stage.size({ width: w, height: h });
    const scale = Math.min(w / AVATAR_W, h / AVATAR_H);
    const offX = (w - AVATAR_W * scale) / 2;
    const offY = (h - AVATAR_H * scale) / 2;
    for (const layer of this.stage.getLayers()) {
      layer.scale({ x: scale, y: scale });
      layer.position({ x: offX, y: offY });
    }
    this.stage.batchDraw();
  }

  private sync(): void {
    if (!this.garmentLayer || !this.transformer) return;
    const group = this.garmentLayer.findOne<Konva.Group>('.garment-root')!;
    const layers = [...this.layers()].sort((a, b) => a.z - b.z);
    const ids = new Set(layers.map((l) => l.itemId));
    const urlFor = this.urlFor();

    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) {
        node.destroy();
        this.nodes.delete(id);
        this.nodeUrls.delete(id);
      }
    }

    layers.forEach((l, index) => {
      let node = this.nodes.get(l.itemId);
      if (!node) {
        node = this.createNode(l.itemId);
        group.add(node);
        this.nodes.set(l.itemId, node);
      }
      node.position({ x: l.x, y: l.y });
      node.size({ width: l.w, height: l.h });
      node.scale({ x: l.scale, y: l.scale });
      node.rotation(l.rotation);
      node.zIndex(index);
      const url = urlFor(l);
      if (url && this.nodeUrls.get(l.itemId) !== url) {
        this.nodeUrls.set(l.itemId, url);
        this.getImage(url).then((img) => {
          if (this.nodeUrls.get(l.itemId) !== url) return;
          node!.image(img);
          // Zásah jen do neprůhledných pixelů (verze na postavu jsou přes celé plátno).
          node!.cache({ pixelRatio: 0.5 });
          node!.drawHitFromCache(10);
          this.garmentLayer!.batchDraw();
        });
      }
    });

    const selected = this.selectedId() ? this.nodes.get(this.selectedId()!) : undefined;
    this.transformer.nodes(selected ? [selected] : []);
    this.transformer.moveToTop();
    this.garmentLayer.batchDraw();
  }

  private createNode(itemId: string): Konva.Image {
    const node = new Konva.Image({ image: undefined, draggable: true, name: 'garment', id: itemId });
    node.on('mousedown touchstart', () => this.selectChange.emit(itemId));
    node.on('dragend', () => this.emitChange(itemId, node));
    node.on('transformend', () => this.emitChange(itemId, node));
    node.on('mouseenter', () => (this.stage!.container().style.cursor = 'grab'));
    node.on('mouseleave', () => (this.stage!.container().style.cursor = 'default'));
    return node;
  }

  private emitChange(itemId: string, node: Konva.Image): void {
    const round = (n: number) => Math.round(n * 100) / 100;
    this.layerChange.emit({
      itemId,
      patch: { x: round(node.x()), y: round(node.y()), scale: round(node.scaleX()), rotation: round(node.rotation()) },
    });
  }

  private getImage(url: string): Promise<HTMLImageElement> {
    const cached = this.images.get(url);
    if (cached?.complete) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = cached ?? new Image();
      img.addEventListener('load', () => resolve(img), { once: true });
      img.addEventListener('error', reject, { once: true });
      if (!cached) {
        this.images.set(url, img);
        img.src = url;
      }
    });
  }
}
