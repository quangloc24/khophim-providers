import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://streams.icefy.top';

const headers = {
  'Referer': `${baseUrl}/`,
  'Origin': baseUrl,
};

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let url = '';
  if (ctx.media.type === 'show') {
    url = `${baseUrl}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  } else {
    url = `${baseUrl}/movie/${ctx.media.tmdbId}`;
  }

  const data = await ctx.proxiedFetcher<any>(url, {
    headers: {
      'Referer': `${baseUrl}/`,
    },
  });

  if (!data?.stream) {
    throw new NotFoundError('No stream found');
  }

  ctx.progress(90);

  return {
    stream: [
      {
        id: 'primary',
        type: 'hls' as const,
        playlist: data.stream,
        flags: [],
        headers,
        captions: [],
      },
    ],
    embeds: [],
  };
}

export const icefyScraper = makeSourcerer({
  id: 'icefy',
  name: 'Icefy',
  rank: 965,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
