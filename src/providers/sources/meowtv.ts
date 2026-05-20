import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const gateUrl = 'https://gate.flicky.host';
const referer = 'https://meowtv.ru';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';

const headers = {
  'User-Agent': ua,
  'Accept': 'application/json',
  'Referer': referer,
  'Origin': referer,
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const type = ctx.media.type === 'show' ? 'tv' : 'movie';
  let url = `${gateUrl}/v17/${type}/${ctx.media.tmdbId}`;
  if (ctx.media.type === 'show') {
    url += `/${ctx.media.season.number}/${ctx.media.episode.number}`;
  }

  const data = await ctx.proxiedFetcher<any>(url, { headers });
  const streamUrl = data?.stream?.url;
  if (!streamUrl || !streamUrl.startsWith('http')) {
    throw new NotFoundError('No stream url found');
  }

  ctx.progress(90);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: streamUrl,
        flags: [],
        headers: {
          'User-Agent': ua,
          'Referer': referer,
          'Origin': referer,
        },
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const meowtvScraper = makeSourcerer({
  id: 'meowtv',
  name: 'MeowTV',
  rank: 175,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
