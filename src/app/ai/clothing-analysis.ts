import { Injectable } from '@angular/core';
import { Category, PhotoMode, Reach } from '../core/models';

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
  /** kam kus na těle sahá (starší server ho neposílá) */
  reach?: Reach | null;
  /** jaká část kusu je na fotce vidět (0–1) */
  visibleShare?: number;
  confidence: number;
}

export interface ClothingAnalysisResult {
  containsPerson: boolean;
  photoMode: PhotoMode;
  garmentCount: number;
  garments: ClothingAnalysis[];
}

/** Kus z fotky: údaje z analýzy + vyříznutý obrázek (PNG data URL) z lokální segmentace. */
export interface ScannedGarment extends ClothingAnalysis {
  image: string | null;
  warning: string | null;
}

export type ScanResult =
  | (Omit<ClothingAnalysisResult, 'garments'> & { garments: ScannedGarment[] })
  | { analysisError: { status: number; message: string }; fallbackImage: string | null };

const SCAN_TIMEOUT_MS = 90_000;

@Injectable({ providedIn: 'root' })
export class ClothingAnalysisService {
  /**
   * Jedno volání: analýza (OpenAI, placená) + výřez kusů (lokálně, zdarma).
   * Při selhání analýzy vrátí `analysisError` a případně výřez celého oblečení pro ruční vyplnění.
   */
  async scan(photo: Blob, signal?: AbortSignal): Promise<ScanResult> {
    const image = await toDataUrl(photo);
    const timeout = AbortSignal.timeout(SCAN_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch('/api/clothing/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) throw new Error('Zpracování trvá příliš dlouho. Zkus to znovu, nebo kus vyplň ručně.');
      throw new Error('Server aplikace neodpovídá. Běží `npm start`?');
    }
    const body = (await response.json().catch(() => null)) as (ScanResult & { error?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.error ?? 'Zpracování fotografie se nepodařilo.');
    if ('garments' in body && body.garments.length === 0) {
      return { analysisError: { status: 422, message: 'Na fotce se nepodařilo najít oblečení.' }, fallbackImage: null };
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
