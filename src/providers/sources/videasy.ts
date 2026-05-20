import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const decApi = 'https://enc-dec.app/api/dec-videasy';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*; q=0.01',
  'Referer': 'https://player.videasy.net/',
  'Origin': 'https://player.videasy.net',
};

const servers = [
  { name: 'mb-flix', url: 'https://api.videasy.net/mb-flix/sources-with-title' },
  { name: 'cdn', url: 'https://api.videasy.net/cdn/sources-with-title' },
  { name: 'superflix', url: 'https://api.videasy.net/superflix/sources-with-title' },
  { name: 'lamovie', url: 'https://api.videasy.net/lamovie/sources-with-title' },
];

async function decrypt(blob: string, tmdbId: string, ctx: ShowScrapeContext | MovieScrapeContext): Promise<any> {
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher<any>(decApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: blob, id: tmdbId }),
    });
    if (res?.status !== 200 || !res?.result?.sources) return null;
    return res.result;
  } catch {
    return null;
  }
}

async function fetchServer(server: any, id: string, s: number, e: number, ctx: ShowScrapeContext | MovieScrapeContext): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      title: '',
      mediaType: ctx.media.type === 'show' ? 'tv' : 'movie',
      tmdbId: String(id),
      imdbId: '',
      episodeId: String(e),
      seasonId: String(s),
    });
    const url = `${server.url}?${params}`;
    const blob = await ctx.proxiedFetcher<string>(url, { headers });
    if (!blob || blob.length < 10) return [];

    const decrypted = await decrypt(blob, String(id), ctx);
    if (!decrypted || !decrypted.sources?.length) return [];

    return decrypted.sources.filter((x: any) => x?.url);
  } catch {
    return [];
  }
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  let season = 1;
  let episode = 1;
  if (ctx.media.type === 'show') {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }
  const tmdbId = ctx.media.tmdbId;

  const results = await Promise.all(servers.map(srv => fetchServer(srv, tmdbId, season, episode, ctx)));

  for (const sources of results) {
    if (sources && sources.length) {
      ctx.progress(90);
      
      const masterPlaylist = sources.map((src: any) => {
        const quality = String(src.quality || '').toLowerCase();
        let bandwidth = 500000;
        let resolution = '640x360';
        
        if (quality.includes('1080')) { bandwidth = 5000000; resolution = '1920x1080'; }
        else if (quality.includes('720')) { bandwidth = 2500000; resolution = '1280x720'; }
        else if (quality.includes('480')) { bandwidth = 1000000; resolution = '854x480'; }
        
        return `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n${src.url}`;
      }).join('\n');
      
      const masterUrl = `data:application/vnd.apple.mpegurl;base64,${btoa('#EXTM3U\n' + masterPlaylist)}`;

      return {
        stream: [
          {
            id: 'primary',
            type: 'hls' as const,
            playlist: masterUrl,
            flags: [],
            headers,
            captions: [],
          },
        ],
        embeds: [],
      };
    }
  }

  throw new NotFoundError('No stream found');
}

export const videasyScraper = makeSourcerer({
  id: 'videasy',
  name: 'Videasy',
  rank: 950,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
