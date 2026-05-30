import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';

const decApi = 'https://enc-dec.app/api/dec-videasy';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*; q=0.01',
  'Referer': 'https://player.videasy.net/',
  'Origin': 'https://player.videasy.net',
};

async function decrypt(blob: string, tmdbId: string, ctx: any): Promise<any> {
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher(decApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: blob, id: tmdbId }),
    });
    if (res?.status !== 200 || !res?.result?.sources) return null;
    return res.result;
  } catch {
    return null;
  }
}

async function scrapeVideasyEmbed(ctx: any, filterQuality?: string) {
  const url = ctx.url;
  const tmdbId = new URL(url).searchParams.get('tmdbId');
  if (!tmdbId) throw new NotFoundError('Missing TMDB ID');

  const blob = await ctx.proxiedFetcher(url, { headers });
  if (!blob || blob.length < 10) throw new NotFoundError('No stream found');

  const decrypted = await decrypt(blob, tmdbId, ctx);
  if (!decrypted || !decrypted.sources?.length) throw new NotFoundError('Failed to decrypt streams');

  let sources = decrypted.sources.filter((x: any) => x?.url);
  if (filterQuality) {
    sources = sources.filter((x: any) => x.quality === filterQuality);
  }

  if (sources.length === 0) throw new NotFoundError('No matching streams found');

  // Normalize quality labels to what the player expects:
  // "2160p" or "4K" / "4k" → "4k"
  // "1080p" → "1080", "720p" → "720", "480p" → "480", "360p" → "360"
  function normalizeQuality(raw: string | undefined): string {
    if (!raw) return 'unknown';
    const lower = raw.toLowerCase().trim();
    if (lower === '4k' || lower === '2160p' || lower === '2160' || lower === 'uhd') return '4k';
    if (lower === '1080p' || lower === '1080') return '1080';
    if (lower === '720p' || lower === '720') return '720';
    if (lower === '480p' || lower === '480') return '480';
    if (lower === '360p' || lower === '360') return '360';
    return 'unknown';
  }

  const qualities: Record<string, { type: 'mp4', url: string }> = {};
  sources.forEach((src: any) => {
    const qKey = normalizeQuality(src.quality);
    qualities[qKey] = {
      type: 'mp4' as const,
      url: src.url,
    };
  });

  return {
    stream: [
      {
        id: 'primary',
        type: 'file' as const,
        flags: [flags.CORS_ALLOWED],
        headers,
        captions: [],
        qualities,
      }
    ]
  };
}

export const videasyYoruEmbed = makeEmbed({
  id: 'videasy-yoru',
  name: 'Yoru 🔥 (Original - 4K)',
  rank: 959,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyNeonEmbed = makeEmbed({
  id: 'videasy-neon',
  name: 'Neon (Original)',
  rank: 958,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyBreachEmbed = makeEmbed({
  id: 'videasy-breach',
  name: 'Breach (Original)',
  rank: 957,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyCypherEmbed = makeEmbed({
  id: 'videasy-cypher',
  name: 'Cypher (Original)',
  rank: 956,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasySageEmbed = makeEmbed({
  id: 'videasy-sage',
  name: 'Sage (Original)',
  rank: 955,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyVyseEmbed = makeEmbed({
  id: 'videasy-vyse',
  name: 'Vyse (Original)',
  rank: 954,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx, 'English'),
});

export const videasyOmenEmbed = makeEmbed({
  id: 'videasy-omen',
  name: 'Omen (Original)',
  rank: 953,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyRazeEmbed = makeEmbed({
  id: 'videasy-raze',
  name: 'Raze (Original)',
  rank: 952,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});

export const videasyFadeEmbed = makeEmbed({
  id: 'videasy-fade',
  name: 'Fade (Hindi Audio)',
  rank: 951,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx, 'Hindi'),
});

export const videasyKilljoyEmbed = makeEmbed({
  id: 'videasy-killjoy',
  name: 'Killjoy (German Audio)',
  rank: 950,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVideasyEmbed(ctx),
});
