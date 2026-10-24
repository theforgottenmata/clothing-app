import { Injectable } from '@angular/core';
import { Category, PhotoMode } from '../core/models';

export interface ClothingAnalysis {
  name: string;
  category: Category;
  subtype: string | null;
  primaryColor: string | null;
  secondaryColors: string[];
  fit: string | null;
  length: string | null;
  sleeveLength: string | null;
  legShape: string | null;
  material: string | null;
  pattern: string | null;
  details: string[];
  confidence: number;
}

export interface ClothingAnalysisResult {
  containsPerson: boolean;
  photoMode: PhotoMode;
  garmentCount: number;
  garments: ClothingAnalysis[];
}

@Injectable({ providedIn: 'root' })
export class ClothingAnalysisService {
  async analyze(photo: Blob): Promise<ClothingAnalysisResult> {
    const image = await toDataUrl(photo);
    const response = await fetch('/api/clothing/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image }),
    });

    const body = (await response.json().catch(() => null)) as
      | (ClothingAnalysisResult & { error?: never })
      | { error?: string }
      | null;

    if (!response.ok) {
      throw new Error(body?.error ?? 'Analýza fotografie se nepodařila.');
    }
    if (!body || !('garments' in body) || body.garments.length === 0) {
      throw new Error('Na fotografii se nepodařilo najít oblečení.');
    }
    return body;
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Fotografii se nepodařilo načíst.'));
    reader.readAsDataURL(blob);
  });
}
