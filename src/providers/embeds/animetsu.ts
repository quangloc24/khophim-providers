/* eslint-disable no-console */
import { flags } from '../../entrypoint/utils/targets';
import { NotFoundError } from '@/utils/errors';
import { labelToLanguageCode } from '../captions';
import { EmbedOutput, makeEmbed } from '../base';

const ANIMETSU_SERVERS = ['pahe', 'kite', 'dio', 'meg', 'kiss', 'zoro', 'zaza', 'bato'] as const;

export function makeAnimetsuEmbed(id: string, rank: number = 100) {
  return makeEmbed({
    id: `animetsu-${id}`,
    name: `Animetsu ${id.charAt(0).toUpperCase() + id.slice(1)}`,
    rank,
    flags: [flags.CORS_ALLOWED],
    async scrape(ctx): Promise<EmbedOutput> {
      const { animeId, episode, serverId, subOrDub } = JSON.parse(ctx.url);

      const res = await ctx.proxiedFetcher<any>(`/v2/api/anime/oppai/${animeId}/${episode}`, {
        baseUrl: 'https://animetsu.net',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://animetsu.net/',
          'Origin': 'https://animetsu.net',
        },
        query: {
          server: serverId,
          source_type: subOrDub || 'sub',
        },
      });

      const source = res?.sources?.[0];
      if (!source?.url) throw new NotFoundError('No source URL found');

      // Construct direct HLS playlist URL
      let videoUrl = source.url;
      if (source.need_proxy && videoUrl.startsWith('/')) {
        videoUrl = `https://swiftstream.top/proxy${videoUrl}`;
      }

      // Extract captions/subtitles
      const captions = (res.subs || [])
        .filter((sub: any) => sub.url)
        .map((sub: any) => ({
          id: sub.url,
          url: sub.url,
          type: 'vtt',
          language: labelToLanguageCode(sub.lang || 'English') || 'en',
          hasCorsRestrictions: false,
        }));

      ctx.progress(100);

      return {
        stream: [
          {
            id: 'primary',
            type: 'hls',
            playlist: videoUrl,
            headers: {
              Referer: 'https://animetsu.net/',
              Origin: 'https://animetsu.net',
            },
            flags: [flags.CORS_ALLOWED],
            captions,
          },
        ],
      };
    },
  });
}

export const AnimetsuEmbeds = ANIMETSU_SERVERS.map((server, i) => makeAnimetsuEmbed(server, 930 - i));
