/**
 * Denní strop placených volání OpenAI (ochrana proti nečekané útratě, dokud nejsou účty a předplatné).
 * Počítá se za celý server (všichni uživatelé dohromady), počítadlo je v server/.cache/usage.json
 * a nuluje se o půlnoci (místní čas serveru). Limity v .env: MAX_SCANS_PER_DAY, MAX_DRESS_PER_DAY (0 = bez limitu).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('./.cache/usage.json', import.meta.url);
const LIMITS = {
  scan: () => Number(process.env.MAX_SCANS_PER_DAY ?? 100),
  dress: () => Number(process.env.MAX_DRESS_PER_DAY ?? 30),
};
const LABEL = { scan: 'rozborů fotek', dress: 'kreslení kusů na avatara' };

export class LimitError extends Error {
  constructor(message) {
    super(message);
    this.status = 429;
  }
}

const today = () => new Date().toLocaleDateString('sv-SE');

function load() {
  try {
    const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
    if (data?.date === today()) return data;
  } catch {
    // poškozený soubor = nový den
  }
  return { date: today(), scan: 0, dress: 0 };
}

/** Započítá jedno placené volání, nebo vyhodí LimitError, když je denní strop vyčerpaný. */
export function spend(kind) {
  const limit = LIMITS[kind]();
  const data = load();
  if (limit > 0 && data[kind] >= limit) {
    throw new LimitError(`Dnešní limit ${LABEL[kind]} (${limit}) je vyčerpaný. Zkus to zítra, nebo limit zvyš v .env.`);
  }
  data[kind]++;
  mkdirSync(new URL('./', FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data));
  return { used: data[kind], limit };
}

export function usage() {
  const data = load();
  return { date: data.date, scan: { used: data.scan, limit: LIMITS.scan() }, dress: { used: data.dress, limit: LIMITS.dress() } };
}
