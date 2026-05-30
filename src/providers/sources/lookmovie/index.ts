import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';
import { fetchTMDBName } from '@/utils/tmdb';

import { scrape, searchAndFindMedia } from './util';

async function universalScraper(ctx: MovieScrapeContext | ShowScrapeContext): Promise<SourcererOutput> {
  let media = ctx.media;
  try {
    const englishTitle = await fetchTMDBName(ctx, 'en-US');
    media = { ...ctx.media, title: englishTitle } as any;
  } catch {
    // Fallback to localized client title if TMDB fetch fails
  }

  const lookmovieData = await searchAndFindMedia(ctx, media);
  if (!lookmovieData) throw new NotFoundError('Media not found');

  ctx.progress(30);
  const video = await scrape(ctx, media, lookmovieData);
  if (!video.playlist) throw new NotFoundError('No video found');

  ctx.progress(60);

  return {
    embeds: [],
    stream: [
      {
        id: 'primary',
        playlist: video.playlist,
        type: 'hls',
        flags: [flags.IP_LOCKED],
        captions: video.captions,
      },
    ],
  };
}

export const lookmovieScraper = makeSourcerer({
  id: 'lookmovie',
  name: 'LookMovie',
  disabled: false,
  rank: 171,
  flags: [flags.IP_LOCKED],
  scrapeShow: universalScraper,
  scrapeMovie: universalScraper,
});
