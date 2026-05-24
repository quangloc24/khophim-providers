import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://animetsu.net/',
  'Origin': 'https://animetsu.net',
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const title = ctx.media.title;
  const episode = ctx.media.type === 'show' ? ctx.media.episode.number : 1;

  // 1. Search for the anime to get the internal ID
  const searchRes = await ctx.proxiedFetcher<any>('/v2/api/anime/search', {
    baseUrl: 'https://animetsu.net',
    headers,
    query: {
      query: title,
    },
  });

  const searchResults = searchRes?.results || [];
  if (searchResults.length === 0) {
    throw new NotFoundError('No search results found on Animetsu');
  }

  // Find the best match
  const cleanTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetClean = cleanTitle(title);
  
  let bestMatch = searchResults[0];
  for (const item of searchResults) {
    const romajiClean = cleanTitle(item.title?.romaji || '');
    const englishClean = cleanTitle(item.title?.english || '');
    if (romajiClean === targetClean || englishClean === targetClean) {
      bestMatch = item;
      break;
    }
  }

  const animeId = bestMatch.id;
  if (!animeId) {
    throw new NotFoundError('Failed to resolve Animetsu anime ID');
  }

  // 2. Fetch the available servers for this episode
  let serversRes: any;
  try {
    serversRes = await ctx.proxiedFetcher<any>(`/v2/api/anime/servers/${animeId}/${episode}`, {
      baseUrl: 'https://animetsu.net',
      headers,
    });
  } catch (err) {
    // ignore and fallback
  }

  const servers = Array.isArray(serversRes) && serversRes.length > 0
    ? serversRes
    : [{ id: 'pahe' }, { id: 'kite' }, { id: 'dio' }, { id: 'meg' }, { id: 'kiss' }];

  const embeds = servers.map((srv: any) => ({
    embedId: `animetsu-${srv.id}`,
    url: JSON.stringify({
      animeId,
      episode,
      serverId: srv.id,
      subOrDub: 'sub',
    }),
  }));

  return {
    embeds,
  };
}

export const animetsuScraper = makeSourcerer({
  id: 'animetsu',
  name: 'Animetsu',
  rank: 112,
  flags: [],
  scrapeShow: comboScraper,
  scrapeMovie: comboScraper,
});
