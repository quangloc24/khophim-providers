const baseUrl = 'https://streamrip-website-production.up.railway.app';

export interface GearlessJoeDownloadLink {
  title: string;
  url: string;
  size: string;
  resolution: string;
  host: string;
}

export async function scrapeGearlessJoeDownloads(options: {
  tmdbId: string;
  type: 'movie' | 'show' | 'anime';
  season?: number;
  episode?: number;
  anilistId?: string;
  fetcher?: (url: string, init?: any) => Promise<any>;
}): Promise<GearlessJoeDownloadLink[]> {
  
  let url = '';
  if (options.type === 'show') {
    url = `${baseUrl}/api/download/tv/${options.tmdbId}?season=${options.season || 1}&episode=${options.episode || 1}`;
  } else if (options.type === 'anime') {
    url = `${baseUrl}/api/download/anime/${options.anilistId || options.tmdbId}/${options.episode || 1}`;
  } else {
    url = `${baseUrl}/api/download/movie/${options.tmdbId}`;
  }

  // Default to standard fetch and json parsing if custom fetcher is not provided
  const fetchFn = options.fetcher || (async (u: string) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    return res.json();
  });

  const data = await fetchFn(url);
  if (!data || !data.downloads || data.downloads.length === 0) {
    throw new Error('No streams found for this content');
  }

  let items = data.downloads;

  // TV/Anime filter fallback just in case the backend includes extra entries
  if (options.type === 'show') {
    const seasonNumber = options.season;
    const episodeNumber = options.episode;
    items = items.filter(
      (item: any) => 
        (item.season === undefined || item.season === seasonNumber) && 
        (item.episode === undefined || item.episode === episodeNumber)
    );
  } else if (options.type === 'anime') {
    const episodeNumber = options.episode;
    items = items.filter(
      (item: any) => 
        (item.episode === undefined || item.episode === episodeNumber)
    );
  }

  if (items.length === 0) {
    throw new Error('No direct streams found matching the active episode/season.');
  }

  return items.map((item: any) => {
    let hostName = item.server || item.source || 'Direct CDN';
    if (hostName.toLowerCase().includes('googleusercontent')) {
      hostName = 'Google High-Speed CDN';
    } else if (hostName.toLowerCase().includes('pixeldrain')) {
      hostName = 'PixelDrain High-Speed';
    } else if (hostName.toLowerCase().includes('10gbps')) {
      hostName = '10Gbps Premium Node';
    }

    const qualityLabel = item.quality && item.quality > 0 ? `${item.quality}p` : 'Auto';

    return {
      title: `${data.title || ''} (${qualityLabel}) - ${hostName}`,
      url: item.url,
      size: item.size || 'Unknown Size',
      resolution: qualityLabel,
      host: hostName,
    };
  });
}
