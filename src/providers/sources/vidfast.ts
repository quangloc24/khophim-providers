import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';

const baseUrl = 'https://vidfast.pro';

// 19 servers from VidFast status page.
// Vefast 🔥 is placed FIRST — sometimes delivers 4K resolution.
// NOTE: VidFast's player is a React SPA; scraping is disabled until
// the internal API endpoint is confirmed.
const servers = [
  // 🔥 4K-capable server — stays on top
  { name: 'Vfast',    serverParam: 'vfast'    },
  { name: 'Alpha',     serverParam: 'Alpha'     },
  { name: 'Beta',      serverParam: 'Beta'      },
  { name: 'Oscar',     serverParam: 'Oscar'     },
  { name: 'Max',       serverParam: 'Max'       },
  { name: 'Iron',      serverParam: 'Iron'      },
  { name: 'Charlie',   serverParam: 'Charlie'   },
  { name: 'Cobra',     serverParam: 'Cobra'     },
  { name: 'Viper',     serverParam: 'Viper'     },
  { name: 'Ranger',    serverParam: 'Ranger'    },
  { name: 'Specter',   serverParam: 'Specter'   },
  { name: 'Echo',      serverParam: 'Echo'      },
  { name: 'Vodka',     serverParam: 'Vodka'     },
  { name: 'Pablo',     serverParam: 'Pablo'     },
  { name: 'Loco',      serverParam: 'Loco'      },
  { name: 'Samba',     serverParam: 'Samba'     },
  { name: 'Bollywood', serverParam: 'Bollywood' },
  { name: 'Kirito',    serverParam: 'Kirito'    },
  { name: 'Meliodas',  serverParam: 'Meliodas'  },
];

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const { tmdbId } = ctx.media;

  const embeds = servers.map((server) => {
    let embedUrl: string;
    if (ctx.media.type === 'show') {
      embedUrl =
        `${baseUrl}/tv/${tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}` +
        `#${server.serverParam}`;
    } else {
      embedUrl = `${baseUrl}/movie/${tmdbId}#${server.serverParam}`;
    }

    return {
      embedId: `vidfast-${server.name.toLowerCase()}`,
      url: embedUrl,
    };
  });

  ctx.progress(90);
  return { embeds };
}

export const vidfastScraper = makeSourcerer({
  id: 'vidfast',
  name: 'VidFast 🔥',
  rank: 920,
  // Enabled: VidFast player encryption flow is fully implemented and resolved 
  // via the enc-dec.app API decryption endpoints.
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
