import { Injectable } from '@angular/core';
import { AvatarBody, AvatarHead, AvatarImages } from '../core/avatar.store';

/** Klient pro generování avatara přes server (OpenAI úprava obrázku). */
@Injectable({ providedIn: 'root' })
export class AvatarApi {
  createBody(body: AvatarBody, signal?: AbortSignal): Promise<AvatarImages & { remainingToday: number }> {
    return this.post('/api/avatar/body', body, signal);
  }

  async changeHead(base: Blob, head: AvatarHead, signal?: AbortSignal): Promise<AvatarImages & { remainingToday: number }> {
    return this.post('/api/avatar/head', { base: await toDataUrl(base), ...head }, signal);
  }

  private async post(url: string, payload: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('Server aplikace neodpovídá. Běží `npm start`?');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.opaque) throw new Error(body?.error ?? 'Generování avatara se nepodařilo.');
    const [opaque, transparent] = await Promise.all([
      fetch(body.opaque).then((r) => r.blob()),
      fetch(body.transparent).then((r) => r.blob()),
    ]);
    return { opaque, transparent, remainingToday: body.remainingToday as number };
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Obrázek avatara se nepodařilo načíst.'));
    reader.readAsDataURL(blob);
  });
}
