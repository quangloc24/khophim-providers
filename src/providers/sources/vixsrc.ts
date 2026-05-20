import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://vixsrc.to';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${baseUrl}/`,
  'Origin': baseUrl,
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let apiUrl = '';
  if (ctx.media.type === 'show') {
    apiUrl = `${baseUrl}/api/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  } else {
    apiUrl = `${baseUrl}/api/movie/${ctx.media.tmdbId}`;
  }

  const apiData = await ctx.proxiedFetcher<any>(apiUrl, { headers });
  if (!apiData?.src) throw new NotFoundError('No API source found');

  const embedUrl = apiData.src.startsWith('http') ? apiData.src : `${baseUrl}${apiData.src}`;
  const embedHtml = await ctx.proxiedFetcher<string>(embedUrl, { headers });
  if (!embedHtml) throw new NotFoundError('Failed to fetch embed page');

  const token = embedHtml.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
  const expires = embedHtml.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
  const playlist = embedHtml.match(/url\s*:\s*["']([^"']+)/)?.[1];
  const lang = embedHtml.match(/lang(?:uage)?["']\s*:\s*["']([a-z]{2,5})/i)?.[1] ?? 'en';

  if (!token || !expires || !playlist) throw new NotFoundError('Invalid token data');

  const sep = playlist.includes('?') ? '&' : '?';
  const masterUrl = `${playlist}${sep}token=${token}&expires=${expires}&h=1&lang=${lang}`;

  ctx.progress(90);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: masterUrl,
        flags: [],
        headers,
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const vixsrcScraper = makeSourcerer({
  id: 'vixsrc',
  name: 'VixSrc',
  rank: 160,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
