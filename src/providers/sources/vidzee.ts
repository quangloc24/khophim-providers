import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const playerUrl = 'https://player.vidzee.wtf';
const coreUrl = 'https://core.vidzee.wtf';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';

const headers = {
  'User-Agent': ua,
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': playerUrl,
  'Origin': playerUrl,
};

const hlsHeaders = {
  'User-Agent': ua,
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': playerUrl,
  'Origin': playerUrl,
};

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

async function deriveKey(e: string): Promise<string> {
  if (!e) return '';
  const t = base64ToBytes(e);
  if (t.length <= 28) return '';
  const n = t.slice(0, 12);
  const r = t.slice(12, 28);
  const a = t.slice(28);
  const i = new Uint8Array(a.length + r.length);
  i.set(a, 0);
  i.set(r, a.length);

  const l = await crypto.subtle.digest('SHA-256', stringToBuffer('4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c'));
  const o = await crypto.subtle.importKey('raw', l as any, { name: 'AES-GCM' }, false, ['decrypt']);
  const c = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: n as any, tagLength: 128 }, o, i as any);
  return bufferToString(c);
}

async function decrypt(encryptedData: string, decryptionKey: string): Promise<string> {
  if (!encryptedData || !decryptionKey) return '';
  const decoded = atob(encryptedData);
  const [ivBase64, cipherBase64] = decoded.split(':');
  if (!ivBase64 || !cipherBase64) return '';
  const iv = base64ToBytes(ivBase64);
  const cipherBytes = base64ToBytes(cipherBase64);
  const encoded = new TextEncoder().encode(decryptionKey);
  const keyBytes = new Uint8Array(32);
  keyBytes.set(encoded.slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes as any, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as any }, cryptoKey, cipherBytes as any);
  return bufferToString(decrypted);
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const type = ctx.media.type === 'show' ? 'tv' : 'movie';
  let season = 1;
  let episode = 1;
  if (ctx.media.type === 'show') {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }

  const apiKeyText = await ctx.proxiedFetcher<string>(`${coreUrl}/api-key`, { headers });
  if (!apiKeyText) throw new NotFoundError('Failed to fetch api key');

  const decKey = await deriveKey(apiKeyText);
  if (!decKey) throw new NotFoundError('Failed to derive decryption key');

  for (let sr = 0; sr < 14; sr++) {
    let url = `${playerUrl}/api/server?id=${ctx.media.tmdbId}&sr=${sr}`;
    if (type === 'tv') {
      url += `&ss=${season}&ep=${episode}`;
    }

    try {
      const data = await ctx.proxiedFetcher<any>(url, { headers });
      if (!data || data.error || !Array.isArray(data.url) || !data.url.length) continue;

      for (const entry of data.url) {
        if (!entry.link) continue;
        const decrypted = await decrypt(entry.link, decKey);
        if (decrypted && decrypted.startsWith('http')) {
          ctx.progress(90);
          return {
            stream: [
              {
                id: 'primary',
                type: 'hls' as const,
                playlist: decrypted,
                flags: [],
                headers: hlsHeaders,
                captions: [],
              },
            ],
            embeds: [],
          };
        }
      }
    } catch {
      continue;
    }
  }

  throw new NotFoundError('No valid stream found');
}

export const vidzeeScraper = makeSourcerer({
  id: 'vidzee',
  name: 'VidZee',
  rank: 155,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
