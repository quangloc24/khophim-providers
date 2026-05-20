import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://cine.su';

const verifyHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${baseUrl}/en/watch`,
  'Origin': baseUrl,
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let url = '';
  if (ctx.media.type === 'show') {
    url = `${baseUrl}/v1/stream/master/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}.m3u8`;
  } else {
    url = `${baseUrl}/v1/stream/master/movie/${ctx.media.tmdbId}.m3u8`;
  }

  const res = await ctx.proxiedFetcher.full(url, {
    method: 'GET',
    headers: verifyHeaders,
  });

  if (res.statusCode !== 200) throw new NotFoundError('Stream not found');
  if (!res.body || !res.body.toString().trim().startsWith('#EXTM3U')) {
    throw new NotFoundError('Invalid playlist');
  }

  ctx.progress(90);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: url,
        flags: [],
        headers: {
          Referer: `${baseUrl}/en/watch`,
          Origin: baseUrl,
        },
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const cinesuScraper = makeSourcerer({
  id: 'cinesu',
  name: 'CineSu',
  rank: 980,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
