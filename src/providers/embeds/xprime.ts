import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';
import SHA256 from 'crypto-js/sha256';

// base64 helper
function base64Encode(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return Buffer.from(str).toString('base64');
}

// Altcha PoW solver
async function solveAltcha(ctx: any): Promise<string> {
  const challenge = await ctx.proxiedFetcher('https://mznxiwqjdiq00239q.space/altcha/challenge');
  if (!challenge || !challenge.challenge) {
    throw new NotFoundError('Failed to get Altcha challenge');
  }

  const { algorithm, challenge: challStr, salt, maxnumber, signature } = challenge;

  const targetBig = ((1n << 256n) - 1n) / BigInt(maxnumber + 1);
  const targetHex = targetBig.toString(16).padStart(64, '0');

  const limit = maxnumber * 10;
  let foundNumber = -1;

  for (let num = 0; num <= limit; num++) {
    const dataToHash = `${algorithm}:${challStr}:${salt}:${num}`;
    const hashHex = SHA256(dataToHash).toString();
    if (hashHex <= targetHex) {
      foundNumber = num;
      break;
    }
  }

  if (foundNumber < 0) {
    throw new NotFoundError('PoW solving failed');
  }

  const payload = {
    algorithm,
    challenge: challStr,
    maxnumber,
    number: foundNumber,
    salt,
    signature,
    took: 10,
  };

  return base64Encode(JSON.stringify(payload));
}

// Master scraper
async function scrapeXPrimeEmbed(ctx: any) {
  const { server, title, tmdbId, imdbId, year, type, season, episode } = JSON.parse(ctx.url);

  // 1. Solve Altcha challenge
  const altchaPayload = await solveAltcha(ctx);

  // 2. Build exact query parameters matching the Python implementation
  const params: Record<string, string> = {
    name: title,
    id: tmdbId,
    altcha: altchaPayload,
  };
  if (imdbId) {
    params.imdb = imdbId;
  }
  if (year) {
    params.year = year;
  }
  if (type === 'show') {
    if (season) params.season = season;
    if (episode) params.episode = episode;
  }

  const query = new URLSearchParams(params).toString();
  const url = `https://mznxiwqjdiq00239q.space/${server}?${query}`;

  const encrypted = await ctx.proxiedFetcher(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Referer': 'https://mznxiwqjdiq00239q.space/',
    }
  });

  if (!encrypted) {
    throw new NotFoundError('Failed to get encrypted stream payload');
  }

  let decrypted: any = null;

  // If the response is already parsed as a JS Object
  if (typeof encrypted === 'object' && encrypted !== null) {
    if (encrypted.streams) {
      decrypted = encrypted;
    }
  }

  // Otherwise try JSON parsing if it is a string
  if (!decrypted && typeof encrypted === 'string') {
    try {
      const parsed = JSON.parse(encrypted);
      if (parsed && parsed.streams) {
        decrypted = parsed;
      }
    } catch {
      // Ignore
    }
  }

  // Fallback to decrypt API if direct parse wasn't possible and encrypted is a string
  if (!decrypted && typeof encrypted === 'string') {
    try {
      const decRes = await ctx.proxiedFetcher('https://enc-dec.app/api/dec-xprime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encrypted.trim() }),
      });

      if (decRes?.status === 200 && decRes?.result) {
        decrypted = decRes.result;
      }
    } catch {
      // Ignore
    }
  }

  if (!decrypted) {
    throw new NotFoundError('Failed to parse or decrypt streams');
  }

  const hlsUrl = decrypted.streams?.AUTO?.url;
  if (!hlsUrl) throw new NotFoundError('No HLS stream found');

  const headers = {
    Referer: 'https://pstream.net/',
    Origin: 'https://pstream.net',
  };

  return {
    stream: [
      {
        id: 'primary',
        playlist: hlsUrl,
        headers,
        type: 'hls' as const,
        flags: [flags.CORS_ALLOWED],
        captions: [],
      }
    ]
  };
}

// 7 server embeds
export const xprimeFingerEmbed = makeEmbed({
  id: 'xprime-finger',
  name: 'Finger (xPrime)',
  rank: 1007,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimePrimeboxEmbed = makeEmbed({
  id: 'xprime-primebox',
  name: 'PrimeBox (xPrime)',
  rank: 1006,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimeKingEmbed = makeEmbed({
  id: 'xprime-king',
  name: 'King (xPrime)',
  rank: 1005,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimeFacileEmbed = makeEmbed({
  id: 'xprime-facile',
  name: 'Facile (xPrime)',
  rank: 1004,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimeLighterEmbed = makeEmbed({
  id: 'xprime-lighter',
  name: 'Lighter (xPrime)',
  rank: 1003,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimeFedEmbed = makeEmbed({
  id: 'xprime-fed',
  name: 'Fed (xPrime)',
  rank: 1002,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});

export const xprimeEekEmbed = makeEmbed({
  id: 'xprime-eek',
  name: 'Eek (xPrime)',
  rank: 1001,
  flags: [flags.CORS_ALLOWED],
  scrape: scrapeXPrimeEmbed,
});
