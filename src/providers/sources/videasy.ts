import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const decApi = 'https://enc-dec.app/api/dec-videasy';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*; q=0.01',
  'Referer': 'https://player.videasy.net/',
  'Origin': 'https://player.videasy.net',
};

const servers = [
  { name: 'Yoru', url: 'https://api.videasy.net/cdn/sources-with-title' },
  { name: 'Neon', url: 'https://api.videasy.net/mb-flix/sources-with-title' },
  { name: 'Breach', url: 'https://api.videasy.net/m4uhd/sources-with-title' },
  { name: 'Cypher', url: 'https://api.videasy.net/moviebox/sources-with-title' },
  { name: 'Sage', url: 'https://api.videasy.net/1movies/sources-with-title' },
  { name: 'Vyse', url: 'https://api.videasy.net/hdmovie/sources-with-title', filterQuality: 'English' },
  { name: 'Fade', url: 'https://api.videasy.net/hdmovie/sources-with-title', filterQuality: 'Hindi' },
  { name: 'Killjoy', url: 'https://api.videasy.net/meine/sources-with-title', extraParams: { language: 'german' } },
  { name: 'Omen', url: 'https://api.videasy.net/lamovie/sources-with-title' },
  { name: 'Raze', url: 'https://api.videasy.net/superflix/sources-with-title' },
];

async function decrypt(blob: string, tmdbId: string, ctx: ShowScrapeContext | MovieScrapeContext): Promise<any> {
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher<any>(decApi, {
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

async function fetchServer(server: any, id: string, s: number, e: number, ctx: ShowScrapeContext | MovieScrapeContext): Promise<any[]> {
  try {
    const queryObj: Record<string, string> = {
      title: '',
      mediaType: ctx.media.type === 'show' ? 'tv' : 'movie',
      tmdbId: String(id),
      imdbId: '',
      episodeId: String(e),
      seasonId: String(s),
    };
    if (server.extraParams) {
      Object.assign(queryObj, server.extraParams);
    }
    const params = new URLSearchParams(queryObj);
    const url = `${server.url}?${params}`;
    const blob = await ctx.proxiedFetcher<string>(url, { headers });
    if (!blob || blob.length < 10) return [];

    const decrypted = await decrypt(blob, String(id), ctx);
    if (!decrypted || !decrypted.sources?.length) return [];

    let filtered = decrypted.sources.filter((x: any) => x?.url);
    if (server.filterQuality) {
      filtered = filtered.filter((x: any) => x.quality === server.filterQuality);
    }
    return filtered;
  } catch {
    return [];
  }
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let season = 1;
  let episode = 1;
  if (ctx.media.type === 'show') {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }
  const tmdbId = ctx.media.tmdbId;

  const embeds = servers.map((server) => {
    const queryObj: Record<string, string> = {
      title: '',
      mediaType: ctx.media.type === 'show' ? 'tv' : 'movie',
      tmdbId: String(tmdbId),
      imdbId: '',
      episodeId: String(episode),
      seasonId: String(season),
    };
    if (server.extraParams) {
      Object.assign(queryObj, server.extraParams);
    }
    const params = new URLSearchParams(queryObj);
    const url = `${server.url}?${params}`;

    return {
      embedId: `videasy-${server.name.toLowerCase()}`,
      url,
    };
  });

  ctx.progress(90);
  return {
    embeds,
  };
}

export const videasyScraper = makeSourcerer({
  id: 'videasy',
  name: 'Videasy 🔥',
  rank: 950,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
