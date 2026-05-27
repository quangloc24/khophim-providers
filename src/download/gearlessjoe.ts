// Decrypted: "https://streamrip-website-production.up.railway.app"
function getApiUrl(): string {
  const rot13 = 'uggcf://fgernezvc-jrofvgr-cebqhpgvba.hc.envjynl.ncc';
  return rot13.replace(/[a-zA-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13))
  );
}

export interface GearlessJoeDownloadLink {
  title: string;
  url: string;
  size: string;
  resolution: string;
  host: string;
}

export async function scrapeGearlessJoeDownloads(options: {
  tmdbId: string;
  type: 'movie' | 'show';
  season?: number;
  episode?: number;
  fetcher?: (url: string, init?: any) => Promise<any>;
}): Promise<GearlessJoeDownloadLink[]> {
  const sType = options.type === 'show' ? 'tv' : 'movie';
  const baseUrl = getApiUrl();
  const url = `${baseUrl}/api/download/${sType}/${options.tmdbId}`;

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

  if (options.type === 'show') {
    const seasonNumber = options.season;
    const episodeNumber = options.episode;
    items = items.filter(
      (item: any) => item.season === seasonNumber && item.episode === episodeNumber
    );
  }

  if (items.length === 0) {
    throw new Error(`No direct streams found for Season ${options.season} Episode ${options.episode}.`);
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
