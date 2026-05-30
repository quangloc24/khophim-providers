import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';

const apiBase = 'https://enc-dec.app/api';
const version = '1';

const defaultHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Referer': 'https://vidfast.pro/',
  'X-Requested-With': 'XMLHttpRequest',
};

async function scrapeVidfastEmbed(ctx: any, serverName: string) {
  const url = ctx.url;

  const html = await ctx.proxiedFetcher(url, {
    headers: {
      'User-Agent': defaultHeaders['User-Agent'],
      'Referer': 'https://vidfast.pro/',
    },
  });
  if (!html || html.length < 100) throw new NotFoundError('Empty VidFast page');

  // Extract 'en'
  let enToken: string | undefined;
  const match = html.match(/\\"en\\":\\"(.*?)\\"/) || html.match(/"en":"(.*?)"/);
  if (match?.[1]) {
    enToken = match[1];
  }

  if (!enToken) throw new NotFoundError('VidFast: Cannot find "en" token');

  // 1. Get vidfast parts via enc-vidfast
  const encRes: any = await ctx.proxiedFetcher(`${apiBase}/enc-vidfast`, {
    method: 'GET',
    query: {
      text: enToken,
      version,
    },
  });

  if (encRes?.status !== 200 || !encRes?.result) {
    throw new NotFoundError(`VidFast enc-vidfast API error: ${encRes?.error || 'unknown'}`);
  }

  const { servers: serversUrl, stream: streamUrl, token } = encRes.result;

  // 2. Fetch encrypted servers
  const reqHeaders = {
    ...defaultHeaders,
    'X-CSRF-Token': token,
  };

  const serversEncrypted: string = await ctx.proxiedFetcher(serversUrl, {
    method: 'POST',
    headers: reqHeaders,
  });

  // 3. Decrypt servers
  const decServersRes: any = await ctx.proxiedFetcher(`${apiBase}/dec-vidfast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: serversEncrypted, version }),
  });

  if (decServersRes?.status !== 200 || !decServersRes?.result) {
    throw new NotFoundError(`VidFast dec-vidfast servers error: ${decServersRes?.error || 'unknown'}`);
  }

  const serversDecrypted = decServersRes.result;

  // Find matching server
  const server = serversDecrypted.find(
    (s: any) => s.name?.toLowerCase() === serverName.toLowerCase()
  ) || serversDecrypted[0];

  if (!server) throw new NotFoundError(`VidFast: Server ${serverName} not found`);

  const data = server.data;

  // 4. Fetch encrypted stream
  const streamTargetUrl = `${streamUrl}/${data}`;
  const streamEncrypted: string = await ctx.proxiedFetcher(streamTargetUrl, {
    method: 'POST',
    headers: reqHeaders,
  });

  // 5. Decrypt stream
  const decStreamRes: any = await ctx.proxiedFetcher(`${apiBase}/dec-vidfast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: streamEncrypted, version }),
  });

  if (decStreamRes?.status !== 200 || !decStreamRes?.result) {
    throw new NotFoundError(`VidFast dec-vidfast stream error: ${decStreamRes?.error || 'unknown'}`);
  }

  const streamDecrypted = decStreamRes.result;
  const playlistUrl = streamDecrypted.url;

  if (!playlistUrl) throw new NotFoundError('VidFast: Decrypted stream contains no URL');

  // Subtitles / tracks mapping
  const captions: any[] = [];
  if (Array.isArray(streamDecrypted.tracks)) {
    streamDecrypted.tracks.forEach((track: any) => {
      if (track.file && track.label) {
        captions.push({
          id: track.label.toLowerCase(),
          language: track.label.toLowerCase(),
          url: track.file,
          type: 'srt' as const,
        });
      }
    });
  }

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: playlistUrl,
        flags: [flags.CORS_ALLOWED],
        headers: {},
        captions,
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
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Alpha'),
});

export const vidfastBetaEmbed = makeEmbed({
  id: 'vidfast-beta',
  name: 'Beta (VidFast)',
  rank: 918,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Beta'),
});

export const vidfastOscarEmbed = makeEmbed({
  id: 'vidfast-oscar',
  name: 'Oscar (VidFast)',
  rank: 917,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Oscar'),
});

export const vidfastMaxEmbed = makeEmbed({
  id: 'vidfast-max',
  name: 'Max (VidFast)',
  rank: 916,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Max'),
});

export const vidfastIronEmbed = makeEmbed({
  id: 'vidfast-iron',
  name: 'Iron (VidFast)',
  rank: 915,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Iron'),
});

export const vidfastCharlieEmbed = makeEmbed({
  id: 'vidfast-charlie',
  name: 'Charlie (VidFast)',
  rank: 914,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Charlie'),
});

export const vidfastCobraEmbed = makeEmbed({
  id: 'vidfast-cobra',
  name: 'Cobra (VidFast)',
  rank: 913,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Cobra'),
});

export const vidfastViperEmbed = makeEmbed({
  id: 'vidfast-viper',
  name: 'Viper (VidFast)',
  rank: 912,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Viper'),
});

export const vidfastRangerEmbed = makeEmbed({
  id: 'vidfast-ranger',
  name: 'Ranger (VidFast)',
  rank: 911,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Ranger'),
});

export const vidfastSpecterEmbed = makeEmbed({
  id: 'vidfast-specter',
  name: 'Specter (VidFast)',
  rank: 910,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Specter'),
});

export const vidfastEchoEmbed = makeEmbed({
  id: 'vidfast-echo',
  name: 'Echo (VidFast)',
  rank: 909,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Echo'),
});

export const vidfastVodkaEmbed = makeEmbed({
  id: 'vidfast-vodka',
  name: 'Vodka (VidFast)',
  rank: 908,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Vodka'),
});

export const vidfastPabloEmbed = makeEmbed({
  id: 'vidfast-pablo',
  name: 'Pablo (VidFast)',
  rank: 907,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Pablo'),
});

export const vidfastLocoEmbed = makeEmbed({
  id: 'vidfast-loco',
  name: 'Loco (VidFast)',
  rank: 906,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Loco'),
});

export const vidfastSambaEmbed = makeEmbed({
  id: 'vidfast-samba',
  name: 'Samba (VidFast)',
  rank: 905,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Samba'),
});

export const vidfastBollywoodEmbed = makeEmbed({
  id: 'vidfast-bollywood',
  name: 'Bollywood (VidFast)',
  rank: 904,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Bollywood'),
});

export const vidfastKiritoEmbed = makeEmbed({
  id: 'vidfast-kirito',
  name: 'Kirito (VidFast)',
  rank: 903,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Kirito'),
});

export const vidfastMeliodasEmbed = makeEmbed({
  id: 'vidfast-meliodas',
  name: 'Meliodas (VidFast)',
  rank: 902,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Meliodas'),
});

// 🔥 Vfast — sometimes delivers 4K resolution
export const vidfastVefastEmbed = makeEmbed({
  id: 'vidfast-vfast',
  name: 'Vfast 🔥 (4K)',
  rank: 901,
  flags: [flags.CORS_ALLOWED],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, 'Vfast'),
});
