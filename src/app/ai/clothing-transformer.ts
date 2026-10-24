import { InjectionToken } from '@angular/core';
import { BottomLength, Category } from '../core/models';

export interface TransformHint {
  category?: Category;
  bottomLength?: BottomLength;
}

export type StepStatus = 'done' | 'skipped' | 'failed';

export interface TransformResult {
  /** Katalogová verze – AI ilustrace, nebo (bez AI) upravená původní fotka. */
  catalog: Blob;
  catalogIsAi: boolean;
  /** Verze na postavu 688×1024 (průhledná, sedí na avatara na 0,0). Bez AI chybí. */
  fit?: Blob;
  /** Co AI rozpoznala z fotky. */
  detected?: { category?: Category; bottomLength?: BottomLength; color?: string; name?: string };
  steps: { detect: StepStatus; illustration: StepStatus; fit: StepStatus };
  notes: string[];
}

/**
 * Převod fotky oblečení na ilustraci ve stylu avatara.
 *
 * Doporučený postup pro skutečnou AI (ověřený v návrhu):
 *  1. katalog = image-to-image se stylovou referencí avatara
 *  2. oblečený avatar = image edit (podklad + katalog, pravidla dle kategorie;
 *     dlouhé spodky se generují na avatarovi ve standardních botách)
 *  3. verze na postavu = extractGarmentLayer(oblečený avatar, podklad) – viz garment-extract.ts
 */
export interface ClothingTransformer {
  readonly name: string;
  readonly isAi: boolean;
  transform(photo: Blob, hint?: TransformHint): Promise<TransformResult>;
}

export const CLOTHING_TRANSFORMER = new InjectionToken<ClothingTransformer>('CLOTHING_TRANSFORMER');
