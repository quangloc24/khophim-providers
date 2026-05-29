import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const BASE_URL = 'https://vsembed.ru';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  'Referer': BASE_URL + '/',
};

const PLAYER_DOMAINS: Record<string, string> = {
  '{v1}': 'neonhorizonworkshops.com',
  '{v2}': 'wanderlynest.com',
  '{v3}': 'orchidpixelgardens.com',
  '{v4}': 'cloudnestra.com',
};

export const PROXY_HEADERS = {
  'Referer': 'https://cloudnestra.com/',
  'Origin': 'https://cloudnestra.com',
  'User-Agent': HEADERS['User-Agent'],
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const pageUrl = ctx.media.type === 'show'
    ? `${BASE_URL}/embed/tv?tmdb=${ctx.media.tmdbId}&season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`
    : `${BASE_URL}/embed/movie?tmdb=${ctx.media.tmdbId}`;

  ctx.progress(30);

  const html1 = await ctx.proxiedFetcher<string>(pageUrl, { headers: HEADERS });
  if (!html1) throw new NotFoundError('Failed to fetch embed landing page');

  let rcpUrl = html1.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1] ?? null;
  if (!rcpUrl) throw new NotFoundError('No iframe src found');
  if (rcpUrl.startsWith('//')) rcpUrl = 'https:' + rcpUrl;

  ctx.progress(60);

  const html2 = await ctx.proxiedFetcher<string>(rcpUrl, {
    headers: { ...HEADERS, Referer: BASE_URL + '/' },
  });
  if (!html2) throw new NotFoundError('Failed to fetch step 2 page');

  const prorcp = html2.match(/src:\s*['"]([^'"]*\/prorcp\/[^'"]+)['"]/i)?.[1] ?? null;
  let playerUrl: string;
  if (prorcp) {
    const base = rcpUrl.slice(0, rcpUrl.indexOf('/', rcpUrl.indexOf('//') + 2));
    playerUrl = prorcp.startsWith('http') ? prorcp : base + prorcp;
  } else {
    playerUrl = rcpUrl.replace('/rcp/', '/prorcp/');
  }

  ctx.progress(80);

  const html3 = await ctx.proxiedFetcher<string>(playerUrl, {
    headers: { ...HEADERS, Referer: rcpUrl },
  });
  if (!html3) throw new NotFoundError('Failed to fetch step 3 page');

  const fileField = html3.match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
  if (!fileField) throw new NotFoundError('No file field found in player JS');

  const urls = fileField.split(/\s+or\s+/i).map(template => {
    let url = template;
    for (const [placeholder, domain] of Object.entries(PLAYER_DOMAINS)) {
      url = url.replace(placeholder, domain);
    }
    return (url.includes('{') || url.includes('}')) ? null : url;
  }).filter((x): x is string => !!x);

  if (!urls.length) throw new NotFoundError('No valid m3u8 url found');

  ctx.progress(100);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: urls[0],
        flags: [flags.CORS_ALLOWED],
        headers: PROXY_HEADERS,
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const vidsrcScraper = makeSourcerer({
  id: 'vidsrc',
  name: 'VidSrc',
  rank: 150,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
