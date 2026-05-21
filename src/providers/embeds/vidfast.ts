import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': 'https://vidfast.pro/',
  'Origin': 'https://vidfast.pro',
};

// VidFast embeds an iframe player. We fetch the player page and extract the
// HLS playlist URL that its internal JS injects into the player.
async function scrapeVidfastEmbed(ctx: any) {
  const url = ctx.url;

  const html = await ctx.proxiedFetcher(url, { headers });
  if (!html || html.length < 100) throw new NotFoundError('Empty VidFast page');

  // Try to extract from common patterns in the page's inline scripts.
  // VidFast typically ships a JSON blob like: {"playlist":"https://...m3u8"} or
  // a direct m3u8 URL in a script variable.
  const playlistPatterns = [
    /"playlist"\s*:\s*"([^"]+\.m3u8[^"]*)"/,
    /'playlist'\s*:\s*'([^']+\.m3u8[^']*)'/,
    /playlist\s*=\s*["']([^"']+\.m3u8[^"']*)["']/,
    /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
    /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/,
    /hlsUrl\s*[=:]\s*["']([^"']+\.m3u8[^"']*)["']/,
    /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
  ];

  let playlistUrl: string | undefined;
  for (const pattern of playlistPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      playlistUrl = match[1];
      break;
    }
  }

  if (!playlistUrl) throw new NotFoundError('VidFast: Could not extract HLS playlist');

  // Ensure absolute URL
  if (!playlistUrl.startsWith('http')) {
    playlistUrl = `https://vidfast.pro${playlistUrl}`;
  }

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: playlistUrl,
        flags: [],
        headers,
        captions: [],
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// One embed per server, matching the embedIds emitted by the source scraper.
// ──────────────────────────────────────────────────────────────────────────────

export const vidfastAlphaEmbed = makeEmbed({
  id: 'vidfast-alpha',
  name: 'Alpha (VidFast)',
  rank: 919,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastBetaEmbed = makeEmbed({
  id: 'vidfast-beta',
  name: 'Beta (VidFast)',
  rank: 918,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastOscarEmbed = makeEmbed({
  id: 'vidfast-oscar',
  name: 'Oscar (VidFast)',
  rank: 917,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastMaxEmbed = makeEmbed({
  id: 'vidfast-max',
  name: 'Max (VidFast)',
  rank: 916,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastIronEmbed = makeEmbed({
  id: 'vidfast-iron',
  name: 'Iron (VidFast)',
  rank: 915,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastCharlieEmbed = makeEmbed({
  id: 'vidfast-charlie',
  name: 'Charlie (VidFast)',
  rank: 914,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastCobraEmbed = makeEmbed({
  id: 'vidfast-cobra',
  name: 'Cobra (VidFast)',
  rank: 913,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastViperEmbed = makeEmbed({
  id: 'vidfast-viper',
  name: 'Viper (VidFast)',
  rank: 912,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastRangerEmbed = makeEmbed({
  id: 'vidfast-ranger',
  name: 'Ranger (VidFast)',
  rank: 911,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastSpecterEmbed = makeEmbed({
  id: 'vidfast-specter',
  name: 'Specter (VidFast)',
  rank: 910,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastEchoEmbed = makeEmbed({
  id: 'vidfast-echo',
  name: 'Echo (VidFast)',
  rank: 909,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastVodkaEmbed = makeEmbed({
  id: 'vidfast-vodka',
  name: 'Vodka (VidFast)',
  rank: 908,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastPabloEmbed = makeEmbed({
  id: 'vidfast-pablo',
  name: 'Pablo (VidFast)',
  rank: 907,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastLocoEmbed = makeEmbed({
  id: 'vidfast-loco',
  name: 'Loco (VidFast)',
  rank: 906,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastSambaEmbed = makeEmbed({
  id: 'vidfast-samba',
  name: 'Samba (VidFast)',
  rank: 905,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastBollywoodEmbed = makeEmbed({
  id: 'vidfast-bollywood',
  name: 'Bollywood (VidFast)',
  rank: 904,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastKiritoEmbed = makeEmbed({
  id: 'vidfast-kirito',
  name: 'Kirito (VidFast)',
  rank: 903,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

export const vidfastMeliodasEmbed = makeEmbed({
  id: 'vidfast-meliodas',
  name: 'Meliodas (VidFast)',
  rank: 902,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});

// 🔥 Vefast — sometimes delivers 4K resolution
export const vidfastVefastEmbed = makeEmbed({
  id: 'vidfast-vefast',
  name: 'Vefast 🔥 (4K)',
  rank: 901,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx),
});
