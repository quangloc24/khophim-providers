import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://kaa.lt';

async function searchKickassAnime(ctx: ShowScrapeContext | MovieScrapeContext, title: string): Promise<string> {
  console.log('[KickAssAnime] =======================================');
  console.log(`[KickAssAnime] 🔍 Searching for anime: "${title}"`);
  console.log('[KickAssAnime] =======================================');

  // Try standard search page first
  const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(title)}`;
  console.log(`[KickAssAnime] Fetching search page: ${searchUrl}`);

  let html = '';
  try {
    html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    console.log('[KickAssAnime] Search page fetched successfully. Length:', html.length);
  } catch (error) {
    console.error('[KickAssAnime] Error fetching search page:', error);
    throw new NotFoundError('Failed to fetch KickAssAnime search page');
  }

  const $ = load(html);

  // Find anime links on the search results page
  const allAnchors: { href: string; text: string }[] = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (href && (href.includes('/anime/') || href.split('/').length >= 2)) {
      allAnchors.push({ href, text });
    }
  });

  console.log('[KickAssAnime] Found potential anime anchors:', allAnchors);

  // Look for exact title match or close match
  let showUrl = '';
  const normalizedTitle = title.trim().toLowerCase();

  for (const anchor of allAnchors) {
    const normText = anchor.text.toLowerCase();
    if (normText.includes(normalizedTitle) || normalizedTitle.includes(normText)) {
      showUrl = anchor.href.startsWith('http')
        ? anchor.href
        : `${baseUrl}${anchor.href.startsWith('/') ? '' : '/'}${anchor.href}`;
      console.log(`[KickAssAnime] 🎉 Found matching anime link: ${showUrl} (Text: "${anchor.text}")`);
      break;
    }
  }

  // If no match found, fallback to first potential anime link
  if (!showUrl && allAnchors.length > 0) {
    const firstAnchor = allAnchors[0];
    showUrl = firstAnchor.href.startsWith('http')
      ? firstAnchor.href
      : `${baseUrl}${firstAnchor.href.startsWith('/') ? '' : '/'}${firstAnchor.href}`;
    console.log(`[KickAssAnime] ⚠️ No exact match. Falling back to first result: ${showUrl}`);
  }

  if (!showUrl) {
    // Fallback: construct slug directly
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    showUrl = `${baseUrl}/${slug}`;
    console.warn(`[KickAssAnime] 🛑 Search yielded no results. Trying direct fallback slug: ${showUrl}`);
  }

  return showUrl;
}

async function getEpisodes(
  ctx: ShowScrapeContext | MovieScrapeContext,
  animeUrl: string,
): Promise<{ number: number; url: string }[]> {
  console.log(`[KickAssAnime] 📺 Fetching anime page to find episodes: ${animeUrl}`);

  let html = '';
  try {
    html = await ctx.proxiedFetcher<string>(animeUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    console.log('[KickAssAnime] Anime page fetched successfully. Length:', html.length);
  } catch (error) {
    console.error('[KickAssAnime] Error fetching anime page:', error);
    throw new NotFoundError('Failed to fetch KickAssAnime anime page');
  }

  const $ = load(html);
  const episodes: { number: number; url: string }[] = [];

  console.log('[KickAssAnime] 🔍 Parsing all links on the anime show page...');

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    const epMatch = href.match(/\/ep(?:isode)?-(\d+)/i) || text.match(/Ep(?:isode)?\s*(\d+)/i);
    if (epMatch) {
      const epNum = parseInt(epMatch[1], 10);
      const epUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

      if (!episodes.some((e) => e.number === epNum)) {
        episodes.push({ number: epNum, url: epUrl });
      }
    }
  });

  console.log(`[KickAssAnime] 📦 Extracted episodes list:`, episodes);
  return episodes;
}

async function extractStreams(ctx: ShowScrapeContext | MovieScrapeContext, episodeUrl: string): Promise<SourcererOutput> {
  console.log(`[KickAssAnime] 🎬 Fetching episode page: ${episodeUrl}`);

  let html = '';
  try {
    html = await ctx.proxiedFetcher<string>(episodeUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    console.log('[KickAssAnime] Episode page HTML length:', html.length);
  } catch (error) {
    console.error('[KickAssAnime] Error fetching episode page:', error);
    throw new NotFoundError('Failed to fetch KickAssAnime episode page');
  }

  const $ = load(html);
  console.log('[KickAssAnime] 🔍 Searching for player embed URL...');

  let playerUrl = '';

  // 1. Look for iframes
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('krussdomi.com') || src.includes('cat-player')) {
      playerUrl = src;
    }
  });

  // 2. Look for player matches in scripts
  if (!playerUrl) {
    $('script').each((_, el) => {
      const scriptContent = $(el).html() || '';
      const match = scriptContent.match(/src:\s*["'](https:\/\/krussdomi\.com\/cat-player\/player\?id=[^"']+)["']/i);
      if (match) {
        playerUrl = match[1];
      }
    });
  }

  // 3. Regex search on raw HTML as fallback
  if (!playerUrl) {
    const rawMatch = html.match(/https:\/\/krussdomi\.com\/cat-player\/player\?id=[a-f0-9]+[^\s"']*/i);
    if (rawMatch) {
      playerUrl = rawMatch[0];
    }
  }

  if (!playerUrl) {
    console.error('[KickAssAnime] ❌ Failed to locate player URL inside episode page HTML!');
    throw new NotFoundError('Failed to locate video player embed');
  }

  console.log(`[KickAssAnime] 🎯 Found player URL: ${playerUrl}`);

  const idMatch = playerUrl.match(/[?&]id=([a-f0-9]+)/i);
  if (!idMatch) {
    console.error('[KickAssAnime] ❌ Failed to extract ID parameter from player URL:', playerUrl);
    throw new NotFoundError('Failed to extract video ID');
  }

  const id = idMatch[1];
  console.log(`[KickAssAnime] 💎 Extracted Player ID: ${id}`);

  const masterPlaylistUrl = `https://hls.krussdomi.com/manifest/${id}/master.m3u8`;
  console.log(`[KickAssAnime] 🧬 Constructed Master Playlist HLS URL: ${masterPlaylistUrl}`);

  return {
    embeds: [],
    stream: [
      {
        id: 'primary',
        type: 'hls',
        playlist: masterPlaylistUrl,
        flags: [flags.CORS_ALLOWED],
        captions: [],
        preferredHeaders: {
          Origin: 'https://krussdomi.com',
          Host: 'hls.krussdomi.com',
        },
        headers: {
          Origin: 'https://krussdomi.com',
          Host: 'hls.krussdomi.com',
        },
      },
    ],
  };
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const title = ctx.media.title;
  if (!title) throw new NotFoundError('Missing media title');

  console.log(`[KickAssAnime] 🚀 Starting scraper flow for: ${title}`);

  const animeUrl = await searchKickassAnime(ctx, title);
  let episodeUrl = animeUrl;

  if (ctx.media.type === 'show') {
    const targetEpisode = ctx.media.episode?.number;
    if (targetEpisode == null) throw new NotFoundError('Missing episode number context');

    console.log(`[KickAssAnime] Target Episode Number: ${targetEpisode}`);

    const episodes = await getEpisodes(ctx, animeUrl);
    const ep = episodes.find((e) => e.number === targetEpisode);

    if (!ep) {
      console.warn(`[KickAssAnime] ⚠️ Target episode ${targetEpisode} not found in parsed links. Trying direct guess...`);
      episodeUrl = `${animeUrl}/ep-${targetEpisode}`;
    } else {
      episodeUrl = ep.url;
    }
  } else if (ctx.media.type === 'movie') {
    console.log(`[KickAssAnime] Treating media as Movie, using base anime link: ${animeUrl}`);
  }

  ctx.progress(50);

  const result = await extractStreams(ctx, episodeUrl);
  ctx.progress(100);

  console.log('[KickAssAnime] 🎉 Scrape successfully completed! Result:', result);
  return result;
}

export const kickassanimeScraper = makeSourcerer({
  id: 'kickassanime',
  name: 'KickAssAnime',
  rank: 95,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeShow: comboScraper,
  scrapeMovie: comboScraper,
});
