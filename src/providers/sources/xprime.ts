import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { fetchTMDBName } from '@/utils/tmdb';

const servers = ['finger', 'primebox', 'king', 'facile', 'lighter', 'fed', 'eek'];

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let title = ctx.media.title;
  try {
    title = await fetchTMDBName(ctx, 'en-US');
  } catch {
    // Fallback to localized client title if TMDB fetch fails
  }
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
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
