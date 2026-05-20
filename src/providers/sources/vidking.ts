import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const decApi = 'https://enc-dec.app/api/dec-videasy';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*; q=0.01',
  'Referer': 'https://www.vidking.net/',
  'Origin': 'https://www.vidking.net',
};

const movieApi = 'https://api.videasy.net/mb-flix/sources-with-title';
const tvApi = 'https://api.videasy.net/downloader2/sources-with-title';

async function decrypt(blob: string, tmdbId: string, ctx: ShowScrapeContext | MovieScrapeContext): Promise<string[] | null> {
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher<any>(decApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: blob, id: tmdbId }),
    });
    if (res?.status !== 200 || !res?.result?.sources) return null;
    return res.result.sources.filter((s: any) => s?.url).map((s: any) => s.url);
  } catch {
    return null;
  }
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const isMovie = ctx.media.type === 'movie';
  const mediaType = isMovie ? 'movie' : 'tv';
  const apiUrl = isMovie ? movieApi : tvApi;

  let season = 1;
  let episode = 1;
  if (ctx.media.type === 'show') {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }

  const params = new URLSearchParams({
    title: ctx.media.title,
    mediaType,
    year: String(ctx.media.releaseYear),
    episodeId: String(episode),
    seasonId: String(season),
    tmdbId: ctx.media.tmdbId,
    imdbId: ctx.media.imdbId || '',
    _t: String(Date.now()),
  });

  const url = `${apiUrl}?${params}`;
  const blob = await ctx.proxiedFetcher<string>(url, { headers });
  if (!blob || blob.length < 10) throw new NotFoundError('No stream blob returned');

  const urls = await decrypt(blob, ctx.media.tmdbId, ctx);
  if (!urls || !urls.length) throw new NotFoundError('Failed to decrypt stream');

  ctx.progress(90);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: urls[0],
        flags: [],
        headers,
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const vidkingScraper = makeSourcerer({
  id: 'vidking',
  name: 'VidKing',
  rank: 145,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
