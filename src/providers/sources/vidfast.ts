import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';

const baseUrl = 'https://vidfast.pro';

// 18 servers from VidFast status page.
// "vefast" is a bonus 4K-capable server highlighted with 🔥.
const servers = [
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
  // vefast — sometimes delivers 4K resolution 🔥
  { name: 'Vefast',    serverParam: 'vefast'    },
];

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const { tmdbId } = ctx.media;

  const embeds = servers.map((server) => {
    let embedUrl: string;
    if (ctx.media.type === 'show') {
      embedUrl =
        `${baseUrl}/tv/${tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}` +
        `?server=${server.serverParam}&autoPlay=true`;
    } else {
      embedUrl = `${baseUrl}/movie/${tmdbId}?server=${server.serverParam}&autoPlay=true`;
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
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
