import { Injectable } from '@angular/core';
import { ClothingTransformer, TransformHint, TransformResult } from './clothing-transformer';
import { removeUniformBackground } from './background-removal';

/**
 * Výchozí transformer bez AI: použije původní fotku jako katalogovou verzi
 * (jen s odstraněným světlým pozadím). Verze na postavu nevzniká – kus se na
 * avatara umístí podle mapy těla a doladí se ručně.
 */
@Injectable()
export class PassthroughTransformer implements ClothingTransformer {
  readonly name = 'Bez AI (původní fotka)';
  readonly isAi = false;

  async transform(photo: Blob, _hint?: TransformHint): Promise<TransformResult> {
    const notes: string[] = [];
    let catalog = photo;
    try {
      catalog = await removeUniformBackground(photo);
      notes.push('Z fotky bylo odstraněno světlé pozadí.');
    } catch {
      notes.push('Pozadí se nepodařilo odstranit, použije se fotka beze změny.');
    }
    notes.push('AI převod zatím není připojený – kus se uloží jako fotka a na avatara se umístí podle kategorie.');
    return {
      catalog,
      catalogIsAi: false,
      steps: { detect: 'skipped', illustration: 'skipped', fit: 'skipped' },
      notes,
    };
  }
}
