import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';

const servers = ['primenet', 'finger', 'primebox', 'king', 'facile', 'lighter', 'fed', 'eek'];

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const title = ctx.media.title;
  const tmdbId = ctx.media.tmdbId;
  const imdbId = ctx.media.imdbId || '';
  const year = String(ctx.media.releaseYear);
  const type = ctx.media.type;

  let season = '';
  let episode = '';
  if (ctx.media.type === 'show') {
    season = String(ctx.media.season.number);
    episode = String(ctx.media.episode.number);
  }

  const embeds = servers.map((server) => {
    const queryObj = {
      server,
      title,
      tmdbId,
      imdbId,
      year,
      type,
      season,
      episode,
    };

    return {
      embedId: `xprime-${server}`,
      url: JSON.stringify(queryObj),
    };
  });

  return {
    embeds,
  };
}

export const xprimeScraper = makeSourcerer({
  id: 'xprime',
  name: 'xPrime 🔥',
  rank: 1000,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
