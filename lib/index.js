import * as cheerio from "cheerio";
import { load } from "cheerio";
import ISO6391 from "iso-639-1";
import { customAlphabet } from "nanoid";
import * as unpacker from "unpacker";
import { unpack as unpack$2 } from "unpacker";
import CryptoJS from "crypto-js";
import { parse, stringify } from "hls-parser";
import FormData from "form-data";
class NotFoundError extends Error {
  constructor(reason) {
    super(`Couldn't find a stream: ${reason ?? "not found"}`);
    this.name = "NotFoundError";
  }
}
function formatSourceMeta(v) {
  const types = [];
  if (v.scrapeMovie) types.push("movie");
  if (v.scrapeShow) types.push("show");
  return {
    type: "source",
    id: v.id,
    rank: v.rank,
    name: v.name,
    flags: v.flags,
    mediaTypes: types
  };
}
function formatEmbedMeta(v) {
  return {
    type: "embed",
    id: v.id,
    rank: v.rank,
    name: v.name,
    flags: v.flags
  };
}
function getAllSourceMetaSorted(list) {
  return list.sources.sort((a, b) => b.rank - a.rank).map(formatSourceMeta);
}
function getAllEmbedMetaSorted(list) {
  return list.embeds.sort((a, b) => b.rank - a.rank).map(formatEmbedMeta);
}
function getSpecificId(list, id) {
  const foundSource = list.sources.find((v) => v.id === id);
  if (foundSource) {
    return formatSourceMeta(foundSource);
  }
  const foundEmbed = list.embeds.find((v) => v.id === id);
  if (foundEmbed) {
    return formatEmbedMeta(foundEmbed);
  }
  return null;
}
function makeFullUrl(url, ops) {
  let leftSide = (ops == null ? void 0 : ops.baseUrl) ?? "";
  let rightSide = url;
  if (leftSide.length > 0 && !leftSide.endsWith("/")) leftSide += "/";
  if (rightSide.startsWith("/")) rightSide = rightSide.slice(1);
  const fullUrl = leftSide + rightSide;
  if (!fullUrl.startsWith("http://") && !fullUrl.startsWith("https://") && !fullUrl.startsWith("data:"))
    throw new Error(`Invald URL -- URL doesn't start with a http scheme: '${fullUrl}'`);
  const parsedUrl = new URL(fullUrl);
  Object.entries((ops == null ? void 0 : ops.query) ?? {}).forEach(([k, v]) => {
    parsedUrl.searchParams.set(k, v);
  });
  return parsedUrl.toString();
}
function makeFetcher(fetcher) {
  const newFetcher = (url, ops) => {
    return fetcher(url, {
      headers: (ops == null ? void 0 : ops.headers) ?? {},
      method: (ops == null ? void 0 : ops.method) ?? "GET",
      query: (ops == null ? void 0 : ops.query) ?? {},
      baseUrl: (ops == null ? void 0 : ops.baseUrl) ?? "",
      readHeaders: (ops == null ? void 0 : ops.readHeaders) ?? [],
      body: ops == null ? void 0 : ops.body,
      credentials: ops == null ? void 0 : ops.credentials
    });
  };
  const output = async (url, ops) => (await newFetcher(url, ops)).body;
  output.full = newFetcher;
  return output;
}
const flags = {
  // CORS are set to allow any origin
  CORS_ALLOWED: "cors-allowed",
  // the stream is locked on IP, so only works if
  // request maker is same as player (not compatible with proxies)
  IP_LOCKED: "ip-locked",
  // The source/embed is blocking cloudflare ip's
  // This flag is not compatible with a proxy hosted on cloudflare
  CF_BLOCKED: "cf-blocked",
  // Streams and sources with this flag wont be proxied
  // And will be exclusive to the extension
  PROXY_BLOCKED: "proxy-blocked",
  // The stream is MKV format and requires a player that supports it.
  // Most browsers cannot play MKV; native/desktop/mobile apps with proper players can.
  MKV_REQUIRED: "mkv-required"
};
const targets = {
  // browser with CORS restrictions
  BROWSER: "browser",
  // browser, but no CORS restrictions through a browser extension
  BROWSER_EXTENSION: "browser-extension",
  // native app, so no restrictions in what can be played
  NATIVE: "native",
  // any target, no target restrictions
  ANY: "any"
};
const targetToFeatures = {
  browser: {
    requires: [flags.CORS_ALLOWED],
    disallowed: [flags.MKV_REQUIRED]
  },
  "browser-extension": {
    requires: [],
    disallowed: [flags.MKV_REQUIRED]
  },
  native: {
    requires: [],
    disallowed: []
  },
  any: {
    requires: [],
    disallowed: [flags.MKV_REQUIRED]
  }
};
function getTargetFeatures(target, consistentIpForRequests, proxyStreams) {
  const features = targetToFeatures[target];
  if (!consistentIpForRequests) features.disallowed.push(flags.IP_LOCKED);
  if (proxyStreams) features.disallowed.push(flags.PROXY_BLOCKED);
  return features;
}
function flagsAllowedInFeatures(features, inputFlags) {
  const hasAllFlags = features.requires.every((v) => inputFlags.includes(v));
  if (!hasAllFlags) return false;
  const hasDisallowedFlag = features.disallowed.some((v) => inputFlags.includes(v));
  if (hasDisallowedFlag) return false;
  return true;
}
const DEFAULT_PROXY_URL = "https://proxy.example.com";
let CONFIGURED_M3U8_PROXY_URL = "https://proxy.example.com";
function setM3U8ProxyUrl(proxyUrl) {
  CONFIGURED_M3U8_PROXY_URL = proxyUrl;
}
function getM3U8ProxyUrl() {
  return CONFIGURED_M3U8_PROXY_URL;
}
function requiresProxy(stream) {
  if (!stream.flags.includes(flags.CORS_ALLOWED) || !!(stream.headers && Object.keys(stream.headers).length > 0))
    return true;
  return false;
}
function setupProxy(stream) {
  const headers2 = stream.headers && Object.keys(stream.headers).length > 0 ? stream.headers : void 0;
  const options = {
    ...stream.type === "hls" && { depth: stream.proxyDepth ?? 0 }
  };
  const payload = {
    headers: headers2,
    options
  };
  if (stream.type === "hls") {
    payload.type = "hls";
    payload.url = stream.playlist;
    stream.playlist = `${DEFAULT_PROXY_URL}?${new URLSearchParams({ payload: Buffer.from(JSON.stringify(payload)).toString("base64url") })}`;
  }
  if (stream.type === "file") {
    payload.type = "mp4";
    Object.entries(stream.qualities).forEach((entry) => {
      payload.url = entry[1].url;
      entry[1].url = `${DEFAULT_PROXY_URL}?${new URLSearchParams({ payload: Buffer.from(JSON.stringify(payload)).toString("base64url") })}`;
    });
  }
  stream.headers = {};
  stream.flags = [flags.CORS_ALLOWED];
  return stream;
}
function createM3U8ProxyUrl(url, features, headers2 = {}) {
  if (features && !features.requires.includes(flags.CORS_ALLOWED)) {
    return url;
  }
  const encodedUrl = encodeURIComponent(url);
  const encodedHeaders = encodeURIComponent(JSON.stringify(headers2));
  return `${CONFIGURED_M3U8_PROXY_URL}/m3u8-proxy?url=${encodedUrl}${headers2 ? `&headers=${encodedHeaders}` : ""}`;
}
function updateM3U8ProxyUrl(url) {
  if (url.includes("/m3u8-proxy?url=")) {
    return url.replace(/https:\/\/[^/]+\/m3u8-proxy/, `${CONFIGURED_M3U8_PROXY_URL}/m3u8-proxy`);
  }
  return url;
}
function makeSourcerer(state) {
  const mediaTypes = [];
  if (state.scrapeMovie) mediaTypes.push("movie");
  if (state.scrapeShow) mediaTypes.push("show");
  return {
    ...state,
    type: "source",
    disabled: state.disabled ?? false,
    externalSource: state.externalSource ?? false,
    mediaTypes
  };
}
function makeEmbed(state) {
  return {
    ...state,
    type: "embed",
    disabled: state.disabled ?? false,
    mediaTypes: void 0
  };
}
async function comboScraper$z(ctx) {
  const embedPage = await ctx.proxiedFetcher(
    `https://bombthe.irish/embed/${ctx.media.type === "movie" ? `movie/${ctx.media.tmdbId}` : `tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`}`
  );
  const $ = load(embedPage);
  const embeds = [];
  $("#dropdownMenu a").each((_, element) => {
    const url = new URL($(element).data("url")).searchParams.get("url");
    if (!url) return;
    embeds.push({ embedId: $(element).text().toLowerCase(), url: atob(url) });
  });
  return { embeds };
}
const bombtheirishScraper = makeSourcerer({
  id: "bombtheirish",
  name: "bombthe.irish",
  rank: 100,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$z,
  scrapeShow: comboScraper$z
});
const providers$3 = [
  {
    id: "streamtape",
    name: "Streamtape",
    rank: 160
  },
  {
    id: "streamtape-latino",
    name: "Streamtape (Latino)",
    rank: 159
  }
];
function embed$2(provider) {
  return makeEmbed({
    id: provider.id,
    name: provider.name,
    rank: provider.rank,
    flags: [flags.CORS_ALLOWED],
    // No longer IP locked
    async scrape(ctx) {
      var _a;
      const embedHtml = await ctx.proxiedFetcher(ctx.url);
      const match = embedHtml.match(/robotlink'\).innerHTML = (.*)'/);
      if (!match) throw new Error("No match found");
      const [fh, sh] = ((_a = match == null ? void 0 : match[1]) == null ? void 0 : _a.split("+ ('")) ?? [];
      if (!fh || !sh) throw new Error("No match found");
      const url = `https:${fh == null ? void 0 : fh.replace(/'/g, "").trim()}${sh == null ? void 0 : sh.substring(3).trim()}`;
      return {
        stream: [
          {
            id: "primary",
            type: "file",
            flags: [flags.CORS_ALLOWED],
            // No longer IP locked
            captions: [],
            qualities: {
              unknown: {
                type: "mp4",
                url
              }
            },
            preferredHeaders: {
              Referer: "https://streamtape.com"
            }
          }
        ]
      };
    }
  });
}
const [streamtapeScraper, streamtapeLatinoScraper] = providers$3.map(embed$2);
const warezcdnBase = "https://embed.warezcdn.link";
const warezcdnPlayerBase = "https://warezcdn.link/player";
const warezcdnWorkerProxy = "https://workerproxy.warezcdn.workers.dev";
function decrypt$3(input) {
  let output = atob(input);
  output = output.trim();
  output = output.split("").reverse().join("");
  let last = output.slice(-5);
  last = last.split("").reverse().join("");
  output = output.slice(0, -5);
  return `${output}${last}`;
}
async function getDecryptedId(ctx) {
  var _a;
  const page = await ctx.proxiedFetcher(`/player.php`, {
    baseUrl: warezcdnPlayerBase,
    headers: {
      Referer: `${warezcdnPlayerBase}/getEmbed.php?${new URLSearchParams({
        id: ctx.url,
        sv: "warezcdn"
      })}`
    },
    query: {
      id: ctx.url
    }
  });
  const allowanceKey = (_a = page.match(/let allowanceKey = "(.*?)";/)) == null ? void 0 : _a[1];
  if (!allowanceKey) throw new NotFoundError("Failed to get allowanceKey");
  const streamData = await ctx.proxiedFetcher("/functions.php", {
    baseUrl: warezcdnPlayerBase,
    method: "POST",
    body: new URLSearchParams({
      getVideo: ctx.url,
      key: allowanceKey
    })
  });
  const stream = JSON.parse(streamData);
  if (!stream.id) throw new NotFoundError("can't get stream id");
  const decryptedId = decrypt$3(stream.id);
  if (!decryptedId) throw new NotFoundError("can't get file id");
  return decryptedId;
}
const cdnListing = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64];
async function checkUrls(ctx, fileId) {
  for (const id of cdnListing) {
    const url = `https://cloclo${id}.cloud.mail.ru/weblink/view/${fileId}`;
    const response = await ctx.proxiedFetcher.full(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-1"
      }
    });
    if (response.statusCode === 206) return url;
  }
  return null;
}
const warezcdnembedMp4Scraper = makeEmbed({
  id: "warezcdnembedmp4",
  // WarezCDN is both a source and an embed host
  name: "WarezCDN MP4",
  // method no longer works
  rank: 982,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrape(ctx) {
    const decryptedId = await getDecryptedId(ctx);
    if (!decryptedId) throw new NotFoundError("can't get file id");
    const streamUrl = await checkUrls(ctx, decryptedId);
    if (!streamUrl) throw new NotFoundError("can't get stream id");
    return {
      stream: [
        {
          id: "primary",
          captions: [],
          qualities: {
            unknown: {
              type: "mp4",
              url: `${warezcdnWorkerProxy}/?${new URLSearchParams({
                url: streamUrl
              })}`
            }
          },
          type: "file",
          flags: [flags.CORS_ALLOWED]
        }
      ]
    };
  }
});
const SKIP_VALIDATION_CHECK_IDS = [
  warezcdnembedMp4Scraper.id,
  streamtapeScraper.id
  // deltaScraper.id,
  // alphaScraper.id,
  // novaScraper.id,
  // astraScraper.id,
  // orionScraper.id,
];
const UNPROXIED_VALIDATION_CHECK_IDS = [
  // sources here are always proxied, so we dont need to validate with a proxy
  bombtheirishScraper.id
  // this one is dead, but i'll keep it here for now
];
function isValidStream(stream) {
  if (!stream) return false;
  if (stream.type === "hls") {
    if (!stream.playlist) return false;
    return true;
  }
  if (stream.type === "file") {
    const validQualities = Object.values(stream.qualities).filter((v) => v.url.length > 0);
    if (validQualities.length === 0) return false;
    return true;
  }
  return false;
}
function isAlreadyProxyUrl(url) {
  return url.includes("/m3u8-proxy?url=") || url.includes("shegu.net");
}
function isErrorResponse(result) {
  if (result.statusCode === 403) return true;
  const bodyStr = typeof result.body === "string" ? result.body : String(result.body);
  if (result.statusCode === 200 && bodyStr.trim() === "error_wrong_ip") return true;
  if (result.statusCode === 200) {
    try {
      const parsed = JSON.parse(bodyStr);
      if (parsed.status === 403 && parsed.msg === "Access Denied") return true;
    } catch {
    }
  }
  return false;
}
async function validatePlayableStream(stream, ops, sourcererId) {
  if (SKIP_VALIDATION_CHECK_IDS.includes(sourcererId)) return stream;
  if (stream.skipValidation) return stream;
  const alwaysUseNormalFetch = UNPROXIED_VALIDATION_CHECK_IDS.includes(sourcererId);
  if (stream.type === "hls") {
    if (stream.playlist.startsWith("data:")) return stream;
    const useNormalFetch = alwaysUseNormalFetch || isAlreadyProxyUrl(stream.playlist);
    let result;
    if (useNormalFetch) {
      try {
        const response = await fetch(stream.playlist, {
          method: "GET",
          headers: {
            ...stream.preferredHeaders,
            ...stream.headers
          },
          signal: AbortSignal.timeout(2e4)
        });
        result = {
          statusCode: response.status,
          body: await response.text(),
          finalUrl: response.url
        };
      } catch (error) {
        return null;
      }
    } else {
      try {
        result = await Promise.race([
          ops.proxiedFetcher.full(stream.playlist, {
            method: "GET",
            headers: {
              ...stream.preferredHeaders,
              ...stream.headers
            }
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Timeout")), 2e4);
          })
        ]);
      } catch {
        return null;
      }
    }
    if (result.statusCode < 200 || result.statusCode >= 400 || isErrorResponse(result)) return null;
    return stream;
  }
  if (stream.type === "file") {
    const validQualitiesResults = await Promise.all(
      Object.values(stream.qualities).map(async (quality) => {
        const useNormalFetch = alwaysUseNormalFetch || isAlreadyProxyUrl(quality.url);
        if (useNormalFetch) {
          try {
            const response = await fetch(quality.url, {
              method: "GET",
              headers: {
                ...stream.preferredHeaders,
                ...stream.headers,
                Range: "bytes=0-1"
              },
              signal: AbortSignal.timeout(2e4)
            });
            return {
              statusCode: response.status,
              body: await response.text(),
              finalUrl: response.url
            };
          } catch (error) {
            return { statusCode: 500, body: "", finalUrl: quality.url };
          }
        }
        try {
          return await Promise.race([
            ops.proxiedFetcher.full(quality.url, {
              method: "GET",
              headers: {
                ...stream.preferredHeaders,
                ...stream.headers,
                Range: "bytes=0-1"
              }
            }),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Timeout")), 2e4);
            })
          ]);
        } catch {
          return { statusCode: 500, body: "", finalUrl: quality.url };
        }
      })
    );
    const validQualities = stream.qualities;
    Object.keys(stream.qualities).forEach((quality, index) => {
      if (validQualitiesResults[index].statusCode < 200 || validQualitiesResults[index].statusCode >= 400 || isErrorResponse(validQualitiesResults[index])) {
        delete validQualities[quality];
      }
    });
    if (Object.keys(validQualities).length === 0) return null;
    return { ...stream, qualities: validQualities };
  }
  return null;
}
async function validatePlayableStreams(streams, ops, sourcererId) {
  if (SKIP_VALIDATION_CHECK_IDS.includes(sourcererId)) return streams;
  return (await Promise.all(streams.map((stream) => validatePlayableStream(stream, ops, sourcererId)))).filter(
    (v) => v !== null
  );
}
async function scrapeInvidualSource(list, ops) {
  const sourceScraper = list.sources.find((v) => ops.id === v.id);
  if (!sourceScraper) throw new Error("Source with ID not found");
  if (ops.media.type === "movie" && !sourceScraper.scrapeMovie) throw new Error("Source is not compatible with movies");
  if (ops.media.type === "show" && !sourceScraper.scrapeShow) throw new Error("Source is not compatible with shows");
  const contextBase = {
    fetcher: ops.fetcher,
    proxiedFetcher: ops.proxiedFetcher,
    features: ops.features,
    progress(val) {
      var _a, _b;
      (_b = (_a = ops.events) == null ? void 0 : _a.update) == null ? void 0 : _b.call(_a, {
        id: sourceScraper.id,
        percentage: val,
        status: "pending"
      });
    }
  };
  let output = null;
  if (ops.media.type === "movie" && sourceScraper.scrapeMovie)
    output = await sourceScraper.scrapeMovie({
      ...contextBase,
      media: ops.media
    });
  else if (ops.media.type === "show" && sourceScraper.scrapeShow)
    output = await sourceScraper.scrapeShow({
      ...contextBase,
      media: ops.media
    });
  if (output == null ? void 0 : output.stream) {
    output.stream = output.stream.filter((stream) => isValidStream(stream)).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
    output.stream = output.stream.map(
      (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
    );
  }
  if (!output) throw new Error("output is null");
  output.embeds = output.embeds.filter((embed2) => {
    const e = list.embeds.find((v) => v.id === embed2.embedId);
    if (!e || e.disabled) return false;
    return true;
  });
  if ((!output.stream || output.stream.length === 0) && output.embeds.length === 0)
    throw new NotFoundError("No streams found");
  if (output.stream && output.stream.length > 0 && output.embeds.length === 0) {
    const playableStreams = await validatePlayableStreams(output.stream, ops, sourceScraper.id);
    if (playableStreams.length === 0) throw new NotFoundError("No playable streams found");
    output.stream = playableStreams;
  }
  return output;
}
async function scrapeIndividualEmbed(list, ops) {
  const embedScraper = list.embeds.find((v) => ops.id === v.id);
  if (!embedScraper) throw new Error("Embed with ID not found");
  const url = ops.url;
  const output = await embedScraper.scrape({
    fetcher: ops.fetcher,
    proxiedFetcher: ops.proxiedFetcher,
    features: ops.features,
    url,
    progress(val) {
      var _a, _b;
      (_b = (_a = ops.events) == null ? void 0 : _a.update) == null ? void 0 : _b.call(_a, {
        id: embedScraper.id,
        percentage: val,
        status: "pending"
      });
    }
  });
  output.stream = output.stream.filter((stream) => isValidStream(stream)).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
  if (output.stream.length === 0) throw new NotFoundError("No streams found");
  output.stream = output.stream.map(
    (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
  );
  const playableStreams = await validatePlayableStreams(output.stream, ops, embedScraper.id);
  if (playableStreams.length === 0) throw new NotFoundError("No playable streams found");
  output.stream = playableStreams;
  return output;
}
function reorderOnIdList(order, list) {
  const copy = [...list];
  copy.sort((a, b) => {
    const aIndex = order.indexOf(a.id);
    const bIndex = order.indexOf(b.id);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (bIndex >= 0) return 1;
    if (aIndex >= 0) return -1;
    return b.rank - a.rank;
  });
  return copy;
}
async function runAllProviders(list, ops) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
  const sources = reorderOnIdList(ops.sourceOrder ?? [], list.sources).filter((source) => {
    if (ops.media.type === "movie") return !!source.scrapeMovie;
    if (ops.media.type === "show") return !!source.scrapeShow;
    return false;
  });
  const embeds = reorderOnIdList(ops.embedOrder ?? [], list.embeds);
  const embedIds = embeds.map((embed2) => embed2.id);
  let lastId = "";
  const contextBase = {
    fetcher: ops.fetcher,
    proxiedFetcher: ops.proxiedFetcher,
    features: ops.features,
    progress(val) {
      var _a2, _b2;
      (_b2 = (_a2 = ops.events) == null ? void 0 : _a2.update) == null ? void 0 : _b2.call(_a2, {
        id: lastId,
        percentage: val,
        status: "pending"
      });
    }
  };
  (_b = (_a = ops.events) == null ? void 0 : _a.init) == null ? void 0 : _b.call(_a, {
    sourceIds: sources.map((v) => v.id)
  });
  for (const source of sources) {
    (_d = (_c = ops.events) == null ? void 0 : _c.start) == null ? void 0 : _d.call(_c, source.id);
    lastId = source.id;
    let output = null;
    try {
      if (ops.media.type === "movie" && source.scrapeMovie)
        output = await source.scrapeMovie({
          ...contextBase,
          media: ops.media
        });
      else if (ops.media.type === "show" && source.scrapeShow)
        output = await source.scrapeShow({
          ...contextBase,
          media: ops.media
        });
      if (output) {
        output.stream = (output.stream ?? []).filter(isValidStream).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
        output.stream = output.stream.map(
          (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
        );
      }
      if (!output || !((_e = output.stream) == null ? void 0 : _e.length) && !output.embeds.length) {
        throw new NotFoundError("No streams found");
      }
    } catch (error) {
      const updateParams = {
        id: source.id,
        percentage: 100,
        status: error instanceof NotFoundError ? "notfound" : "failure",
        reason: error instanceof NotFoundError ? error.message : void 0,
        error: error instanceof NotFoundError ? void 0 : error
      };
      (_g = (_f = ops.events) == null ? void 0 : _f.update) == null ? void 0 : _g.call(_f, updateParams);
      continue;
    }
    if (!output) throw new Error("Invalid media type");
    if ((_h = output.stream) == null ? void 0 : _h[0]) {
      try {
        const playableStream = await validatePlayableStream(output.stream[0], ops, source.id);
        if (!playableStream) throw new NotFoundError("No streams found");
        return {
          sourceId: source.id,
          stream: playableStream
        };
      } catch (error) {
        const updateParams = {
          id: source.id,
          percentage: 100,
          status: error instanceof NotFoundError ? "notfound" : "failure",
          reason: error instanceof NotFoundError ? error.message : "Stream validation failed",
          error: error instanceof NotFoundError ? void 0 : error
        };
        (_j = (_i = ops.events) == null ? void 0 : _i.update) == null ? void 0 : _j.call(_i, updateParams);
      }
    }
    const sortedEmbeds = output.embeds.filter((embed2) => {
      const e = list.embeds.find((v) => v.id === embed2.embedId);
      return e && !e.disabled;
    }).sort((a, b) => embedIds.indexOf(a.embedId) - embedIds.indexOf(b.embedId));
    if (sortedEmbeds.length > 0) {
      (_l = (_k = ops.events) == null ? void 0 : _k.discoverEmbeds) == null ? void 0 : _l.call(_k, {
        embeds: sortedEmbeds.map((embed2, i) => ({
          id: [source.id, i].join("-"),
          embedScraperId: embed2.embedId
        })),
        sourceId: source.id
      });
    }
    for (const [ind, embed2] of sortedEmbeds.entries()) {
      const scraper = embeds.find((v) => v.id === embed2.embedId);
      if (!scraper) throw new Error("Invalid embed returned");
      const id = [source.id, ind].join("-");
      (_n = (_m = ops.events) == null ? void 0 : _m.start) == null ? void 0 : _n.call(_m, id);
      lastId = id;
      let embedOutput;
      try {
        embedOutput = await scraper.scrape({
          ...contextBase,
          url: embed2.url
        });
        embedOutput.stream = embedOutput.stream.filter(isValidStream).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
        embedOutput.stream = embedOutput.stream.map(
          (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
        );
        if (embedOutput.stream.length === 0) {
          throw new NotFoundError("No streams found");
        }
        const playableStream = await validatePlayableStream(embedOutput.stream[0], ops, embed2.embedId);
        if (!playableStream) throw new NotFoundError("No streams found");
        embedOutput.stream = [playableStream];
      } catch (error) {
        const updateParams = {
          id,
          percentage: 100,
          status: error instanceof NotFoundError ? "notfound" : "failure",
          reason: error instanceof NotFoundError ? error.message : void 0,
          error: error instanceof NotFoundError ? void 0 : error
        };
        (_p = (_o = ops.events) == null ? void 0 : _o.update) == null ? void 0 : _p.call(_o, updateParams);
        continue;
      }
      return {
        sourceId: source.id,
        embedId: scraper.id,
        stream: embedOutput.stream[0]
      };
    }
  }
  return null;
}
function makeControls(ops) {
  const list = {
    embeds: ops.embeds,
    sources: ops.sources
  };
  const providerRunnerOps = {
    features: ops.features,
    fetcher: makeFetcher(ops.fetcher),
    proxiedFetcher: makeFetcher(ops.proxiedFetcher ?? ops.fetcher),
    proxyStreams: ops.proxyStreams
  };
  return {
    runAll(runnerOps) {
      return runAllProviders(list, {
        ...providerRunnerOps,
        ...runnerOps
      });
    },
    runSourceScraper(runnerOps) {
      return scrapeInvidualSource(list, {
        ...providerRunnerOps,
        ...runnerOps
      });
    },
    runEmbedScraper(runnerOps) {
      return scrapeIndividualEmbed(list, {
        ...providerRunnerOps,
        ...runnerOps
      });
    },
    getMetadata(id) {
      return getSpecificId(list, id);
    },
    listSources() {
      return getAllSourceMetaSorted(list);
    },
    listEmbeds() {
      return getAllEmbedMetaSorted(list);
    }
  };
}
const captionTypes = {
  srt: "srt",
  vtt: "vtt"
};
function getCaptionTypeFromUrl(url) {
  const extensions = Object.keys(captionTypes);
  const type = extensions.find((v) => url.endsWith(`.${v}`));
  if (!type) return null;
  return type;
}
function labelToLanguageCode(label) {
  const languageMap = {
    "chinese - hong kong": "zh",
    "chinese - traditional": "zh",
    czech: "cs",
    danish: "da",
    dutch: "nl",
    english: "en",
    "english - sdh": "en",
    finnish: "fi",
    french: "fr",
    german: "de",
    greek: "el",
    hungarian: "hu",
    italian: "it",
    korean: "ko",
    norwegian: "no",
    polish: "pl",
    portuguese: "pt",
    "portuguese - brazilian": "pt",
    romanian: "ro",
    "spanish - european": "es",
    "spanish - latin american": "es",
    spanish: "es",
    swedish: "sv",
    turkish: "tr",
    اَلْعَرَبِيَّةُ: "ar",
    বাংলা: "bn",
    filipino: "tl",
    indonesia: "id",
    اردو: "ur",
    English: "en",
    Arabic: "ar",
    Bosnian: "bs",
    Bulgarian: "bg",
    Croatian: "hr",
    Czech: "cs",
    Danish: "da",
    Dutch: "nl",
    Estonian: "et",
    Finnish: "fi",
    French: "fr",
    German: "de",
    Greek: "el",
    Hebrew: "he",
    Hungarian: "hu",
    Indonesian: "id",
    Italian: "it",
    Norwegian: "no",
    Persian: "fa",
    "farsi/persian": "fa",
    Polish: "pl",
    Portuguese: "pt",
    "Protuguese (BR)": "pt-br",
    Romanian: "ro",
    Russian: "ru",
    russian: "ru",
    Serbian: "sr",
    Slovenian: "sl",
    Spanish: "es",
    Swedish: "sv",
    Thai: "th",
    Turkish: "tr",
    // Simple language codes
    ng: "en",
    re: "fr",
    pa: "es"
  };
  const mappedCode = languageMap[label.toLowerCase()];
  if (mappedCode) return mappedCode;
  const code = ISO6391.getCode(label);
  if (code.length === 0) return null;
  return code;
}
function removeDuplicatedLanguages(list) {
  const beenSeen = {};
  return list.filter((sub) => {
    if (beenSeen[sub.language]) return false;
    beenSeen[sub.language] = true;
    return true;
  });
}
const AnimekaiScraper = makeEmbed({
  id: "animekai-embed",
  name: "AnimeKai",
  rank: 415,
  flags: [],
  async scrape(ctx) {
    var _a;
    const { episodeId } = JSON.parse(ctx.url);
    const data = await ctx.fetcher(
      `https://api.1anime.app/anime/animekai/watch/${encodeURIComponent(episodeId)}`
    );
    if (!((_a = data == null ? void 0 : data.sources) == null ? void 0 : _a.length)) throw new NotFoundError("No stream found");
    ctx.progress(50);
    const captions = (data.subtitles ?? []).filter((sub) => sub.lang && sub.kind !== "thumbnails").map((sub) => ({
      type: "vtt",
      id: sub.url,
      url: sub.url,
      language: labelToLanguageCode(sub.lang.replace(/_\[.*?\]$/, "").trim()) || "unknown",
      hasCorsRestrictions: true
    }));
    const hlsSource = data.sources.find((s) => s.isM3U8);
    if (!hlsSource) throw new NotFoundError("No HLS stream found");
    ctx.progress(90);
    const headers2 = {};
    if (data.headers.Referer) {
      headers2.Referer = data.headers.Referer;
      try {
        headers2.Origin = new URL(data.headers.Referer).origin;
      } catch {
      }
    }
    if (data.headers.Origin) headers2.Origin = data.headers.Origin;
    return {
      stream: [
        {
          id: "primary",
          captions,
          playlist: hlsSource.url,
          headers: headers2,
          type: "hls",
          flags: []
        }
      ]
    };
  }
});
const consumetBase = "https://api.1anime.app/anime/animekai";
function normalizeTitle$6(s) {
  return s.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase();
}
async function searchAnime(ctx, title) {
  var _a;
  const data = await ctx.fetcher(`${consumetBase}/${encodeURIComponent(title)}`);
  if (!((_a = data == null ? void 0 : data.results) == null ? void 0 : _a.length)) throw new NotFoundError("Anime not found on AnimeKai");
  const normalizedTitle = normalizeTitle$6(title);
  const exact = data.results.find((r) => normalizeTitle$6(r.title) === normalizedTitle);
  return (exact ?? data.results[0]).id;
}
async function scrapeAnimekai(ctx) {
  var _a;
  const title = ctx.media.title;
  const episodeNumber = ctx.media.episode.number;
  const animeId = await searchAnime(ctx, title);
  const info = await ctx.fetcher(`${consumetBase}/info?id=${animeId}`);
  if (!((_a = info == null ? void 0 : info.episodes) == null ? void 0 : _a.length)) throw new NotFoundError("No episodes found on AnimeKai");
  const ep = info.episodes.find((e) => e.number === episodeNumber);
  if (!ep) throw new NotFoundError("Episode not found on AnimeKai");
  return {
    embeds: [{ embedId: "animekai-embed", url: JSON.stringify({ episodeId: ep.id }) }]
  };
}
const animekaiScraper = makeSourcerer({
  id: "animekai",
  name: "AnimeKai 🔥",
  rank: 180,
  flags: [],
  scrapeShow: scrapeAnimekai
});
function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    if (document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
      const checkLoaded = () => {
        if (window.turnstile) {
          resolve();
        } else {
          setTimeout(checkLoaded, 100);
        }
      };
      checkLoaded();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
}
async function getTurnstileToken(sitekey, timeout = 3e4) {
  if (typeof window === "undefined") {
    throw new Error("Turnstile verification requires browser environment");
  }
  try {
    await loadTurnstileScript();
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
    return new Promise((resolve, reject) => {
      let widgetId;
      let timeoutId;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (widgetId && window.turnstile) {
          try {
            window.turnstile.remove(widgetId);
          } catch (e) {
          }
        }
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      };
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Turnstile verification timed out"));
      }, timeout);
      try {
        widgetId = window.turnstile.render(container, {
          sitekey,
          callback: (token) => {
            cleanup();
            resolve(token);
          },
          "error-callback": (error) => {
            cleanup();
            reject(new Error(`Turnstile error: ${error}`));
          },
          "expired-callback": () => {
            cleanup();
            reject(new Error("Turnstile token expired"));
          },
          "timeout-callback": () => {
            cleanup();
            reject(new Error("Turnstile verification timed out"));
          }
        });
      } catch (error) {
        cleanup();
        reject(new Error(`Failed to render Turnstile widget: ${error}`));
      }
    });
  } catch (error) {
    throw new Error(`Turnstile verification failed: ${error}`);
  }
}
const getUserToken$2 = () => {
  var _a;
  try {
    if (typeof window === "undefined") return null;
    const prefData = window.localStorage.getItem("__MW::preferences");
    if (!prefData) return null;
    const parsedAuth = JSON.parse(prefData);
    return ((_a = parsedAuth == null ? void 0 : parsedAuth.state) == null ? void 0 : _a.febboxKey) || null;
  } catch (e) {
    console.warn("Unable to access localStorage or parse auth data:", e);
    return null;
  }
};
const BASE_URL$2 = "https://mznxiwqjdiq00239q.space";
async function comboScraper$y(ctx) {
  var _a;
  const userToken = getUserToken$2();
  if (!userToken) throw new NotFoundError("Requires a user token!");
  let turnstileToken;
  try {
    turnstileToken = await getTurnstileToken("0x4AAAAAABgPwhrOT6x6sTjI");
  } catch (error) {
    alert("FED API Turnstile verification failed. Please refresh the page and try again.");
    throw new NotFoundError(`Turnstile verification failed: ${error}`);
  }
  ctx.progress(50);
  const name = ctx.media.title;
  let apiUrl = `${BASE_URL$2}/fedapi?name=${encodeURIComponent(name)}&year=${ctx.media.releaseYear}&ui=${encodeURIComponent(userToken)}`;
  if (ctx.media.type === "show") {
    apiUrl += `&season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`;
  }
  const res = await fetch(apiUrl, { credentials: "omit" });
  if (!res.ok) throw new NotFoundError("API request failed");
  const data = await res.json();
  if ((data == null ? void 0 : data.error) && data.error.endsWith("not found in database")) {
    throw new NotFoundError("No stream found");
  }
  if (!data) throw new NotFoundError("No response from API");
  ctx.progress(90);
  const streams = Object.entries(data.streams).reduce((acc, [quality, entry]) => {
    const url = typeof entry === "string" ? entry : entry.url;
    const type = typeof entry === "string" ? "mp4" : entry.type;
    let qualityKey;
    if (quality === "ORG") {
      const urlPath = url.split("?")[0];
      if (urlPath.toLowerCase().includes(".mp4") || type === "hls") {
        acc.unknown = { url, type };
      }
      return acc;
    }
    if (quality === "4K") {
      qualityKey = 2160;
    } else {
      qualityKey = parseInt(quality.replace("P", ""), 10);
    }
    if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
    acc[qualityKey] = { url, type };
    return acc;
  }, {});
  const captions = [];
  if (data.subtitles) {
    for (const [langKey, subtitleData] of Object.entries(data.subtitles)) {
      const languageKeyPart = langKey.split("_")[0];
      const languageName = languageKeyPart.charAt(0).toUpperCase() + languageKeyPart.slice(1);
      const languageCode = ((_a = labelToLanguageCode(languageName)) == null ? void 0 : _a.toLowerCase()) ?? "unknown";
      if (subtitleData.subtitle_link) {
        const url = subtitleData.subtitle_link;
        const isVtt = url.toLowerCase().endsWith(".vtt");
        captions.push({
          type: isVtt ? "vtt" : "srt",
          id: url,
          url,
          language: languageCode,
          hasCorsRestrictions: false
        });
      }
    }
  }
  ctx.progress(90);
  const hlsStream = streams[2160] ?? streams[1080] ?? streams[720] ?? streams[480] ?? streams[360] ?? streams.unknown;
  if ((hlsStream == null ? void 0 : hlsStream.type) === "hls") {
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          captions,
          playlist: hlsStream.url,
          type: "hls",
          flags: [flags.CORS_ALLOWED]
        }
      ]
    };
  }
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        captions,
        qualities: {
          ...streams[2160] && { "4k": { type: "mp4", url: streams[2160].url } },
          ...streams[1080] && { 1080: { type: "mp4", url: streams[1080].url } },
          ...streams[720] && { 720: { type: "mp4", url: streams[720].url } },
          ...streams[480] && { 480: { type: "mp4", url: streams[480].url } },
          ...streams[360] && { 360: { type: "mp4", url: streams[360].url } },
          ...streams.unknown && { unknown: { type: "mp4", url: streams.unknown.url } }
        },
        type: "file",
        flags: [flags.CORS_ALLOWED]
      }
    ]
  };
}
const FedAPIScraper = makeSourcerer({
  id: "fedapi",
  name: "FED API (4K) 🔥",
  rank: 300,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$y,
  scrapeShow: comboScraper$y
});
const getUserToken$1 = () => {
  var _a;
  try {
    if (typeof window === "undefined") return null;
    const prefData = window.localStorage.getItem("__MW::preferences");
    if (!prefData) return null;
    const parsedAuth = JSON.parse(prefData);
    return ((_a = parsedAuth == null ? void 0 : parsedAuth.state) == null ? void 0 : _a.febboxKey) || null;
  } catch (e) {
    console.warn("Unable to access localStorage or parse auth data:", e);
    return null;
  }
};
const getRegion = () => {
  var _a;
  try {
    if (typeof window === "undefined") return null;
    const regionData = window.localStorage.getItem("__MW::region");
    if (!regionData) return null;
    const parsed = JSON.parse(regionData);
    return ((_a = parsed == null ? void 0 : parsed.state) == null ? void 0 : _a.region) ?? null;
  } catch (e) {
    console.warn("Unable to access localStorage or parse auth data:", e);
    return null;
  }
};
const BASE_URL$1 = "https://fed-api-db.pstream.mov";
function selectSubdomainByRegion(input) {
  const region = (input || "").toLowerCase();
  if (/(^|\b)(usa5|usa6|usa7|uk1|de2|hk1|ca1|au1|sg1|in1)(\b|$)/.test(region)) {
    const match = region.match(/(usa5|usa6|usa7|uk1|de2|hk1|ca1|au1|sg1|in1)/);
    if (match) return match[1];
  }
  if (region.includes("dallas")) return "usa5";
  if (region.includes("portland")) return "usa6";
  if (region.includes("new-york")) return "usa7";
  if (region.includes("paris")) return Math.random() < 0.5 ? "uk1" : "de2";
  if (region.includes("hong-kong")) return "hk1";
  if (region.includes("kansas")) return Math.random() < 0.5 ? "usa7" : "usa6";
  if (region.includes("sydney")) return "au1";
  if (region.includes("singapore")) return "sg1";
  if (region.includes("mumbai")) return "in1";
  if (region === "east") return "usa7";
  if (region === "west") return "usa6";
  if (region === "south") return "usa5";
  if (region === "europe") return Math.random() < 0.5 ? "uk1" : "de2";
  if (region === "asia") return "sg1";
  return null;
}
function rewriteSheguSubdomain(originalUrl, subdomain) {
  try {
    const parsed = new URL(originalUrl);
    if (parsed.hostname.endsWith(".shegu.net")) {
      parsed.hostname = `${subdomain}.shegu.net`;
      return parsed.toString();
    }
    return originalUrl;
  } catch {
    return originalUrl;
  }
}
async function comboScraper$x(ctx) {
  var _a;
  const userToken = getUserToken$1();
  if (!userToken) throw new NotFoundError("Requires a user token!");
  const region = getRegion();
  let turnstileToken;
  try {
    turnstileToken = await getTurnstileToken("0x4AAAAAABgPwhrOT6x6sTjI");
  } catch (error) {
    alert("FED DB Turnstile verification failed. Please refresh the page and try again.");
    throw new NotFoundError(`Turnstile verification failed: ${error}`);
  }
  ctx.progress(50);
  const apiUrl = ctx.media.type === "movie" ? `${BASE_URL$1}/movie/${ctx.media.tmdbId}` : `${BASE_URL$1}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  const data = await ctx.fetcher(apiUrl);
  if ((data == null ? void 0 : data.error) && data.error.endsWith("not found in database")) {
    throw new NotFoundError("No stream found");
  }
  if (!data) throw new NotFoundError("No response from API");
  ctx.progress(90);
  const streams = Object.entries(data.streams).reduce((acc, [quality, url]) => {
    let qualityKey;
    if (quality === "ORG") {
      const urlPath = url.split("?")[0];
      if (urlPath.toLowerCase().includes(".mp4")) {
        acc.unknown = url;
      }
      return acc;
    }
    if (quality === "4K") {
      qualityKey = 2160;
    } else {
      qualityKey = parseInt(quality.replace("P", ""), 10);
    }
    if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
    acc[qualityKey] = url;
    return acc;
  }, {});
  const filteredStreams = Object.entries(streams).reduce((acc, [quality, url]) => {
    acc[quality] = url;
    return acc;
  }, {});
  const selectedSubdomain = selectSubdomainByRegion(region);
  if (selectedSubdomain) {
    Object.keys(filteredStreams).forEach((q) => {
      filteredStreams[q] = rewriteSheguSubdomain(filteredStreams[q], selectedSubdomain);
    });
  }
  const captions = [];
  if (data.subtitles) {
    for (const [langKey, subtitleData] of Object.entries(data.subtitles)) {
      const languageKeyPart = langKey.split("_")[0];
      const languageName = languageKeyPart.charAt(0).toUpperCase() + languageKeyPart.slice(1);
      const languageCode = ((_a = labelToLanguageCode(languageName)) == null ? void 0 : _a.toLowerCase()) ?? "unknown";
      if (subtitleData.subtitle_link) {
        const url = subtitleData.subtitle_link;
        const isVtt = url.toLowerCase().endsWith(".vtt");
        captions.push({
          type: isVtt ? "vtt" : "srt",
          id: url,
          url,
          language: languageCode,
          hasCorsRestrictions: false
        });
      }
    }
  }
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        captions,
        qualities: {
          ...filteredStreams[2160] && {
            "4k": {
              type: "mp4",
              url: filteredStreams[2160]
            }
          },
          ...filteredStreams[1080] && {
            1080: {
              type: "mp4",
              url: filteredStreams[1080]
            }
          },
          ...filteredStreams[720] && {
            720: {
              type: "mp4",
              url: filteredStreams[720]
            }
          },
          ...filteredStreams[480] && {
            480: {
              type: "mp4",
              url: filteredStreams[480]
            }
          },
          ...filteredStreams[360] && {
            360: {
              type: "mp4",
              url: filteredStreams[360]
            }
          },
          ...filteredStreams.unknown && {
            unknown: {
              type: "mp4",
              url: filteredStreams.unknown
            }
          }
        },
        type: "file",
        flags: [flags.CORS_ALLOWED]
      }
    ]
  };
}
const FedAPIDBScraper = makeSourcerer({
  id: "fedapidb",
  name: "FED DB 🔥",
  rank: 299,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$x,
  scrapeShow: comboScraper$x
});
const nanoid = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 10);
const PASS_MD5_PATTERNS = [
  /\$\.get\(['"](\/pass_md5\/[^'"]+)['"]/,
  /\$\.get\(["`](\/pass_md5\/[^"']+)["`]/,
  /\$\.get\s*\(['"](\/pass_md5\/[^'"]+)['"]/,
  /\$\.get\s*\(["`](\/pass_md5\/[^"']+)["`]/
];
const TOKEN_PATTERNS = [/token["']?\s*[:=]\s*["']([^"']+)["']/, /makePlay.*?token=([^"&']+)/];
function extractFirst(html, patterns) {
  for (const pat of patterns) {
    const m = pat.exec(html);
    if (m && m[1]) {
      return m[1];
    }
  }
  return null;
}
function resolveAbsoluteUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}
async function extractVideoUrl(ctx, streamingLink) {
  try {
    const headers2 = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Mode": "navigate",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      Connection: "keep-alive"
    };
    const response = await ctx.proxiedFetcher.full(streamingLink, {
      headers: headers2,
      allowRedirects: true
    });
    const passMd5Match = extractFirst(response.body, PASS_MD5_PATTERNS);
    if (!passMd5Match) {
      return null;
    }
    const baseUrl2 = `${response.finalUrl.split("://")[0]}://${response.finalUrl.split("://")[1].split("/")[0]}`;
    const passMd5Url = resolveAbsoluteUrl(baseUrl2, passMd5Match);
    const passMd5Response = await ctx.proxiedFetcher(passMd5Url, {
      headers: headers2,
      cookies: response.cookies
    });
    const videoUrl = passMd5Response.trim();
    const tokenMatch = extractFirst(response.body, TOKEN_PATTERNS);
    if (tokenMatch) {
      const randomString = nanoid();
      const expiry = Date.now();
      return `${videoUrl}${randomString}?token=${tokenMatch}&expiry=${expiry}`;
    }
    return videoUrl;
  } catch (e) {
    return null;
  }
}
const doodScraper = makeEmbed({
  id: "dood",
  name: "dood",
  disabled: false,
  rank: 173,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let pageUrl = ctx.url;
    try {
      const url = new URL(pageUrl);
      if (url.hostname === "dood.watch") {
        pageUrl = `https://myvidplay.com${url.pathname}${url.search}`;
      }
    } catch {
    }
    const redirectReq = await ctx.proxiedFetcher.full(pageUrl);
    pageUrl = redirectReq.finalUrl;
    const videoUrl = await extractVideoUrl(ctx, pageUrl);
    if (!videoUrl) {
      throw new Error("dood: could not extract video URL");
    }
    const pageResp = await ctx.proxiedFetcher.full(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const thumbnailMatch = pageResp.body.match(/thumbnails:\s*\{\s*vtt:\s*['"]([^'"]+)['"]/);
    const thumbUrl = thumbnailMatch ? resolveAbsoluteUrl(pageUrl, thumbnailMatch[1]) : null;
    const pageOrigin = new URL(pageUrl).origin;
    return {
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [flags.CORS_ALLOWED],
          captions: [],
          qualities: {
            unknown: {
              type: "mp4",
              url: videoUrl
            }
          },
          preferredHeaders: {
            Referer: pageOrigin
          },
          ...thumbUrl ? {
            thumbnailTrack: {
              type: "vtt",
              url: thumbUrl
            }
          } : {}
        }
      ]
    };
  }
});
const userAgent$2 = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36";
const filemoonScraper = makeEmbed({
  id: "filemoon",
  name: "Filemoon",
  rank: 405,
  flags: [],
  async scrape(ctx) {
    const headers2 = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      Referer: `${new URL(ctx.url).origin}/`,
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": userAgent$2
    };
    const response = await ctx.proxiedFetcher(ctx.url, { headers: headers2 });
    const soup = load(response);
    const iframe = soup("iframe").first();
    if (!iframe.length) throw new NotFoundError("No iframe found");
    const iframeUrl = iframe.attr("src");
    if (!iframeUrl) throw new NotFoundError("No iframe src found");
    const iframeResponse = await ctx.proxiedFetcher(iframeUrl, { headers: headers2 });
    const iframeSoup = load(iframeResponse);
    const jsCode = iframeSoup("script").filter((_, el) => {
      const text = iframeSoup(el).html() || "";
      return text.includes("eval(function(p,a,c,k,e,d)");
    }).first().html();
    if (!jsCode) throw new NotFoundError("No packed JS code found");
    const unpacked = unpack$2(jsCode);
    if (!unpacked) throw new NotFoundError("Failed to unpack JS code");
    const videoMatch = unpacked.match(/file:"([^"]+)"/);
    if (!videoMatch) throw new NotFoundError("No video URL found");
    const videoUrl = videoMatch[1];
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: videoUrl,
          headers: {
            Referer: `${new URL(ctx.url).origin}/`,
            "User-Agent": userAgent$2
          },
          flags: [],
          captions: []
        }
      ]
    };
  }
});
const mixdropBase = "https://mixdrop.ag";
const packedRegex$1 = /(eval\(function\(p,a,c,k,e,d\){.*{}\)\))/;
const linkRegex$1 = /MDCore\.wurl="(.*?)";/;
const mixdropScraper = makeEmbed({
  id: "mixdrop",
  name: "MixDrop",
  rank: 198,
  flags: [flags.IP_LOCKED],
  async scrape(ctx) {
    let embedUrl = ctx.url;
    if (ctx.url.includes("primewire")) embedUrl = (await ctx.fetcher.full(ctx.url)).finalUrl;
    const embedId = new URL(embedUrl).pathname.split("/")[2];
    const streamRes = await ctx.proxiedFetcher(`/e/${embedId}`, {
      baseUrl: mixdropBase
    });
    const packed = streamRes.match(packedRegex$1);
    if (!packed) {
      throw new Error("failed to find packed mixdrop JavaScript");
    }
    const unpacked = unpacker.unpack(packed[1]);
    const link = unpacked.match(linkRegex$1);
    if (!link) {
      throw new Error("failed to find packed mixdrop source link");
    }
    const url = link[1];
    return {
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [flags.IP_LOCKED],
          captions: [],
          qualities: {
            unknown: {
              type: "mp4",
              url: url.startsWith("http") ? url : `https:${url}`,
              // URLs don't always start with the protocol
              headers: {
                // MixDrop requires this header on all streams
                Referer: mixdropBase
              }
            }
          }
        }
      ]
    };
  }
});
const serverMirrorEmbed = makeEmbed({
  id: "mirror",
  name: "Mirror",
  rank: 1,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const context = JSON.parse(ctx.url);
    if (context.type === "hls") {
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: context.stream,
            headers: context.headers,
            flags: context.flags,
            captions: context.captions,
            skipValidation: context.skipvalid
          }
        ]
      };
    }
    return {
      stream: [
        {
          id: "primary",
          type: "file",
          qualities: context.qualities,
          flags: context.flags,
          captions: context.captions,
          headers: context.headers,
          skipValidation: context.skipvalid
        }
      ]
    };
  }
});
const origin = "https://rabbitstream.net";
const referer$3 = "https://rabbitstream.net/";
const { AES, enc } = CryptoJS;
function isJSON(json) {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}
function extractKey(script) {
  const startOfSwitch = script.lastIndexOf("switch");
  const endOfCases = script.indexOf("partKeyStartPosition");
  const switchBody = script.slice(startOfSwitch, endOfCases);
  const nums = [];
  const matches = switchBody.matchAll(/:[a-zA-Z0-9]+=([a-zA-Z0-9]+),[a-zA-Z0-9]+=([a-zA-Z0-9]+);/g);
  for (const match of matches) {
    const innerNumbers = [];
    for (const varMatch of [match[1], match[2]]) {
      const regex = new RegExp(`${varMatch}=0x([a-zA-Z0-9]+)`, "g");
      const varMatches = [...script.matchAll(regex)];
      const lastMatch = varMatches[varMatches.length - 1];
      if (!lastMatch) return null;
      const number = parseInt(lastMatch[1], 16);
      innerNumbers.push(number);
    }
    nums.push([innerNumbers[0], innerNumbers[1]]);
  }
  return nums;
}
const upcloudScraper = makeEmbed({
  id: "upcloud",
  name: "UpCloud",
  rank: 200,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const parsedUrl = new URL(ctx.url.replace("embed-5", "embed-4"));
    const dataPath = parsedUrl.pathname.split("/");
    const dataId = dataPath[dataPath.length - 1];
    const streamRes = await ctx.proxiedFetcher(`${parsedUrl.origin}/ajax/embed-4/getSources?id=${dataId}`, {
      headers: {
        Referer: parsedUrl.origin,
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    let sources = null;
    if (!isJSON(streamRes.sources)) {
      const scriptJs = await ctx.proxiedFetcher(`https://rabbitstream.net/js/player/prod/e4-player.min.js`, {
        query: {
          // browser side caching on this endpoint is quite extreme. Add version query paramter to circumvent any caching
          v: Date.now().toString()
        }
      });
      const decryptionKey = extractKey(scriptJs);
      if (!decryptionKey) throw new Error("Key extraction failed");
      let extractedKey = "";
      let strippedSources = streamRes.sources;
      let totalledOffset = 0;
      decryptionKey.forEach(([a, b]) => {
        const start = a + totalledOffset;
        const end = start + b;
        extractedKey += streamRes.sources.slice(start, end);
        strippedSources = strippedSources.replace(streamRes.sources.substring(start, end), "");
        totalledOffset += b;
      });
      const decryptedStream = AES.decrypt(strippedSources, extractedKey).toString(enc.Utf8);
      const parsedStream = JSON.parse(decryptedStream)[0];
      if (!parsedStream) throw new Error("No stream found");
      sources = parsedStream;
    }
    if (!sources) throw new Error("upcloud source not found");
    const captions = [];
    streamRes.tracks.forEach((track) => {
      if (track.kind !== "captions") return;
      const type = getCaptionTypeFromUrl(track.file);
      if (!type) return;
      const language = labelToLanguageCode(track.label.split(" ")[0]);
      if (!language) return;
      captions.push({
        id: track.file,
        language,
        hasCorsRestrictions: false,
        type,
        url: track.file
      });
    });
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: sources.file,
          flags: [flags.CORS_ALLOWED],
          captions,
          preferredHeaders: {
            Referer: referer$3,
            Origin: origin
          }
        }
      ]
    };
  }
});
const apiBaseUrl = "https://borg.rips.cc";
const username = "_ps_";
const password = "defonotscraping";
async function fetchMovie(ctx, ee3Auth) {
  const authResp = await ctx.proxiedFetcher.full(
    `${apiBaseUrl}/api/collections/users/auth-with-password?expand=lists_liked`,
    {
      method: "POST",
      headers: {
        Origin: "https://ee3.me",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identity: username,
        password: ee3Auth
      })
    }
  );
  if (authResp.statusCode !== 200) {
    throw new Error(`Auth failed with status: ${authResp.statusCode}: ${JSON.stringify(authResp.body)}`);
  }
  const jsonResponse = authResp.body;
  if (!(jsonResponse == null ? void 0 : jsonResponse.token)) {
    throw new Error(`No token in auth response: ${JSON.stringify(jsonResponse)}`);
  }
  const token = jsonResponse.token;
  ctx.progress(20);
  const movieUrl = `${apiBaseUrl}/api/collections/movies/records?page=1&perPage=48&filter=tmdb_data.id%20~%20${ctx.media.tmdbId}`;
  const movieResp = await ctx.proxiedFetcher.full(movieUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://ee3.me"
    }
  });
  if (movieResp.statusCode !== 200) {
    throw new Error(`Movie lookup failed with status: ${movieResp.statusCode}: ${JSON.stringify(movieResp.body)}`);
  }
  const movieJsonResponse = movieResp.body;
  if (!(movieJsonResponse == null ? void 0 : movieJsonResponse.items) || movieJsonResponse.items.length === 0) {
    throw new NotFoundError(`No items found for TMDB ID ${ctx.media.tmdbId}: ${JSON.stringify(movieJsonResponse)}`);
  }
  if (!movieJsonResponse.items[0].video) {
    throw new NotFoundError(`No video field in first item: ${JSON.stringify(movieJsonResponse.items[0])}`);
  }
  const movieId = movieJsonResponse.items[0].video;
  ctx.progress(40);
  const keyResp = await ctx.proxiedFetcher.full(`${apiBaseUrl}/video/${movieId}/key`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://ee3.me"
    }
  });
  if (keyResp.statusCode !== 200) {
    throw new Error(`Key fetch failed with status: ${keyResp.statusCode}: ${JSON.stringify(keyResp.body)}`);
  }
  const keyJsonResponse = keyResp.body;
  if (!(keyJsonResponse == null ? void 0 : keyJsonResponse.key)) {
    throw new Error(`No key in response: ${JSON.stringify(keyJsonResponse)}`);
  }
  ctx.progress(60);
  return `${movieId}?k=${keyJsonResponse.key}`;
}
async function comboScraper$w(ctx) {
  const movData = await fetchMovie(ctx, password);
  if (!movData) {
    throw new NotFoundError("No watchable item found");
  }
  ctx.progress(80);
  const videoUrl = `${apiBaseUrl}/video/${movData}`;
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "file",
        qualities: {
          unknown: {
            type: "mp4",
            url: videoUrl
          }
        },
        headers: {
          Origin: "https://ee3.me"
        },
        flags: [],
        captions: []
      }
    ]
  };
}
const ee3Scraper = makeSourcerer({
  id: "ee3",
  name: "EE3",
  rank: 188,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$w
});
function normalizeTitle$5(title) {
  let titleTrimmed = title.trim().toLowerCase();
  if (titleTrimmed !== "the movie" && titleTrimmed.endsWith("the movie")) {
    titleTrimmed = titleTrimmed.replace("the movie", "");
  }
  if (titleTrimmed !== "the series" && titleTrimmed.endsWith("the series")) {
    titleTrimmed = titleTrimmed.replace("the series", "");
  }
  return titleTrimmed.replace(/['":]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
}
function compareTitle(a, b) {
  return normalizeTitle$5(a) === normalizeTitle$5(b);
}
function compareMedia(media, title, releaseYear) {
  const isSameYear = releaseYear === void 0 ? true : media.releaseYear === releaseYear;
  return compareTitle(media.title, title) && isSameYear;
}
function getValidQualityFromString(quality) {
  switch (quality.toLowerCase().replace("p", "")) {
    case "360":
      return "360";
    case "480":
      return "480";
    case "720":
      return "720";
    case "1080":
      return "1080";
    case "2160":
      return "4k";
    case "4k":
      return "4k";
    default:
      return "unknown";
  }
}
const baseUrl$o = "https://fsharetv.co";
async function comboScraper$v(ctx) {
  var _a, _b;
  const searchPage = await ctx.proxiedFetcher("/search", {
    baseUrl: baseUrl$o,
    query: {
      q: ctx.media.title
    }
  });
  const search$ = load(searchPage);
  const searchResults = [];
  search$(".movie-item").each((_, element) => {
    var _a2;
    const [, title, year] = ((_a2 = search$(element).find("b").text()) == null ? void 0 : _a2.match(/^(.*?)\s*(?:\(?\s*(\d{4})(?:\s*-\s*\d{0,4})?\s*\)?)?\s*$/)) || [];
    const url = search$(element).find("a").attr("href");
    if (!title || !url) return;
    searchResults.push({ title, year: Number(year) ?? void 0, url });
  });
  const watchPageUrl = (_a = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))) == null ? void 0 : _a.url;
  if (!watchPageUrl) throw new NotFoundError("No watchable item found");
  ctx.progress(50);
  const watchPage = await ctx.proxiedFetcher(watchPageUrl.replace("/movie", "/w"), { baseUrl: baseUrl$o });
  const fileId = (_b = watchPage.match(/Movie\.setSource\('([^']*)'/)) == null ? void 0 : _b[1];
  if (!fileId) throw new Error("File ID not found");
  const apiRes = await ctx.proxiedFetcher(
    `/api/file/${fileId}/source`,
    {
      baseUrl: baseUrl$o,
      query: {
        type: "watch"
      }
    }
  );
  if (!apiRes.data.file.sources.length) throw new Error("No sources found");
  const mediaBase = new URL((await ctx.proxiedFetcher.full(apiRes.data.file.sources[0].src, { baseUrl: baseUrl$o })).finalUrl).origin;
  const qualities = apiRes.data.file.sources.reduce(
    (acc, source) => {
      const quality = typeof source.quality === "number" ? source.quality.toString() : source.quality;
      const validQuality = getValidQualityFromString(quality);
      acc[validQuality] = {
        type: "mp4",
        url: `${mediaBase}${source.src.replace("/api", "")}`
      };
      return acc;
    },
    {}
  );
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "file",
        flags: [],
        headers: {
          referer: "https://fsharetv.co"
        },
        qualities,
        captions: []
      }
    ]
  };
}
const fsharetvScraper = makeSourcerer({
  id: "fsharetv",
  name: "FshareTV",
  rank: 201,
  flags: [],
  scrapeMovie: comboScraper$v
});
const TMDB_API_KEY = "a500049f3e06109fe3e8289b06cf5685";
async function fetchTMDBName(ctx, lang = "en-US") {
  const type = ctx.media.type === "movie" ? "movie" : "tv";
  const url = `https://api.themoviedb.org/3/${type}/${ctx.media.tmdbId}?api_key=${TMDB_API_KEY}&language=${lang}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error fetching TMDB data: ${response.statusText}`);
  }
  const data = await response.json();
  return ctx.media.type === "movie" ? data.title : data.name;
}
const ORIGIN_HOST = "https://www3.fsonline.app";
const MOVIE_PAGE_URL = "https://www3.fsonline.app/film/";
const SHOW_PAGE_URL = "https://www3.fsonline.app/episoade/{{MOVIE}}-sezonul-{{SEASON}}-episodul-{{EPISODE}}/";
const EMBED_URL = "https://www3.fsonline.app/wp-admin/admin-ajax.php";
function throwOnResponse(response) {
  if (response.statusCode >= 400) {
    throw new Error(`Response does not indicate success: ${response.statusCode}`);
  }
}
function getMoviePageURL(name, season, episode) {
  const n = name.trim().normalize("NFD").toLowerCase().replace(/[^a-zA-Z0-9. ]+/g, "").replace(".", " ").split(" ").join("-");
  if (season && episode) {
    return SHOW_PAGE_URL.replace("{{MOVIE}}", n).replace("{{SEASON}}", `${season}`).replace("{{EPISODE}}", `${episode}`);
  }
  return `${MOVIE_PAGE_URL}${n}/`;
}
async function fetchIFrame(ctx, url) {
  const response = await ctx.proxiedFetcher.full(url, {
    headers: {
      Referer: ORIGIN_HOST,
      Origin: ORIGIN_HOST,
      "sec-fetch-dest": "iframe",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "cross-site"
    }
  });
  throwOnResponse(response);
  return response;
}
const LOG_PREFIX$1 = `[Doodstream]`;
const STREAM_REQ_PATERN = /\$\.get\('(\/pass_md5\/.+?)'/;
const TOKEN_PARAMS_PATERN = /\+ "\?(token=.+?)"/;
function generateStreamKey() {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let o = 0; o < 10; o++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}
function extractStreamInfo($) {
  let streamReq;
  let tokenParams;
  $("script").each((_, script) => {
    var _a, _b;
    if (streamReq && tokenParams) {
      return;
    }
    const text = $(script).text().trim();
    if (!streamReq) {
      streamReq = (_a = text.match(STREAM_REQ_PATERN)) == null ? void 0 : _a[1];
    }
    if (!tokenParams) {
      tokenParams = (_b = text.match(TOKEN_PARAMS_PATERN)) == null ? void 0 : _b[1];
    }
  });
  tokenParams = `${generateStreamKey()}?${tokenParams}${Date.now()}`;
  return [streamReq, tokenParams];
}
async function getStream$3(ctx, url) {
  let $;
  let streamHost;
  let reqReferer;
  try {
    const response = await fetchIFrame(ctx, url);
    if (!response) {
      return void 0;
    }
    $ = cheerio.load(response.body);
    streamHost = new URL(response.finalUrl).hostname;
    reqReferer = response.finalUrl;
  } catch (error) {
    console.error(LOG_PREFIX$1, "Failed to fetch iframe", error);
    return void 0;
  }
  const [streamReq, tokenParams] = extractStreamInfo($);
  if (!streamReq || !tokenParams) {
    console.error(LOG_PREFIX$1, "Couldn't find stream info", streamReq, tokenParams);
    return void 0;
  }
  let streamURL;
  try {
    const response = await ctx.proxiedFetcher.full(`https://${streamHost}${streamReq}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: reqReferer,
        Origin: ORIGIN_HOST
      }
    });
    throwOnResponse(response);
    streamURL = await response.body + tokenParams;
  } catch (error) {
    console.error(LOG_PREFIX$1, "Failed to request stream URL", error);
    return void 0;
  }
  return [streamURL, new URL(streamURL).hostname];
}
async function scrapeDoodstreamEmbed(ctx) {
  let streamURL;
  let streamHost;
  try {
    const stream = await getStream$3(ctx, ctx.url);
    if (!stream || !stream[0]) {
      return {
        stream: []
      };
    }
    [streamURL, streamHost] = stream;
  } catch (error) {
    console.warn(LOG_PREFIX$1, "Failed to get stream", error);
    throw error;
  }
  return {
    stream: [
      {
        type: "file",
        id: "primary",
        flags: [flags.CORS_ALLOWED],
        captions: [],
        qualities: {
          unknown: {
            type: "mp4",
            url: streamURL
          }
        },
        headers: {
          Referer: `https://${streamHost}/`,
          Origin: ORIGIN_HOST
        }
      }
    ]
  };
}
const LOG_PREFIX = "[FSOnline]";
async function getMovieID(ctx, url) {
  let $;
  try {
    const response = await ctx.proxiedFetcher.full(url, {
      headers: {
        Origin: ORIGIN_HOST,
        Referer: ORIGIN_HOST
      }
    });
    throwOnResponse(response);
    $ = cheerio.load(await response.body);
  } catch (error) {
    console.error(LOG_PREFIX, "Failed to fetch movie page", url, error);
    return void 0;
  }
  const movieID = $("#show_player_lazy").attr("movie-id");
  if (!movieID) {
    console.error(LOG_PREFIX, "Could not find movie ID", url);
    return void 0;
  }
  return movieID;
}
async function getMovieSources(ctx, id, refererHeader) {
  const sources = /* @__PURE__ */ new Map();
  let $;
  try {
    const response = await ctx.proxiedFetcher.full(EMBED_URL, {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: refererHeader,
        Origin: ORIGIN_HOST
      },
      body: `action=lazy_player&movieID=${id}`
    });
    throwOnResponse(response);
    $ = cheerio.load(await response.body);
  } catch (error) {
    console.error(LOG_PREFIX, "Could not fetch source index", error);
    return sources;
  }
  $("li.dooplay_player_option").each((_, element) => {
    const name = $(element).find("span").text().trim();
    const url = $(element).attr("data-vs");
    if (!url) {
      console.warn(LOG_PREFIX, "Skipping invalid source", name);
      return;
    }
    sources.set(name, url);
  });
  return sources;
}
function addEmbedFromSources(name, sources, embeds) {
  const url = sources.get(name);
  if (!url) {
    return;
  }
  embeds.push({
    embedId: `fsonline-${name.toLowerCase()}`,
    url
  });
}
async function comboScraper$u(ctx) {
  const movieName = await fetchTMDBName(ctx);
  const moviePageURL = getMoviePageURL(
    ctx.media.type === "movie" ? `${movieName} ${ctx.media.releaseYear}` : movieName,
    ctx.media.type === "show" ? ctx.media.season.number : void 0,
    ctx.media.type === "show" ? ctx.media.episode.number : void 0
  );
  const movieID = await getMovieID(ctx, moviePageURL);
  if (!movieID) {
    return {
      embeds: [],
      stream: []
    };
  }
  const embeds = [];
  const sources = await getMovieSources(ctx, movieID, moviePageURL);
  addEmbedFromSources("Filemoon", sources, embeds);
  addEmbedFromSources("Doodstream", sources, embeds);
  if (embeds.length < 1) {
    throw new Error("No valid sources were found");
  }
  return {
    embeds
  };
}
const fsOnlineScraper = makeSourcerer({
  id: "fsonline",
  name: "FSOnline",
  rank: 140,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$u,
  scrapeShow: comboScraper$u
});
const fsOnlineEmbeds = [
  makeEmbed({
    id: "fsonline-doodstream",
    name: "Doodstream",
    rank: 140,
    scrape: scrapeDoodstreamEmbed,
    flags: [flags.CORS_ALLOWED]
  })
  // makeEmbed({
  //   id: 'fsonline-filemoon',
  //   name: 'Filemoon',
  //   rank: 140,
  //   scrape: scrapeFilemoonEmbed,
  //   flags: [flags.CORS_ALLOWED],
  // }),
];
const BASE_URL = "https://isut.streamflix.one";
async function comboScraper$t(ctx) {
  const embedPage = await ctx.fetcher(
    `${BASE_URL}/api/source/${ctx.media.type === "movie" ? `${ctx.media.tmdbId}` : `${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`}`
  );
  const sources = embedPage.sources;
  if (!sources || sources.length === 0) throw new NotFoundError("No sources found");
  const file = sources[0].file;
  if (!file) throw new NotFoundError("No file URL found");
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        playlist: file,
        type: "hls",
        flags: [flags.CORS_ALLOWED],
        captions: []
      }
    ]
  };
}
const insertunitScraper = makeSourcerer({
  id: "insertunit",
  name: "Insertunit",
  rank: 12,
  disabled: false,
  flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
  scrapeMovie: comboScraper$t,
  scrapeShow: comboScraper$t
});
const baseUrl$n = "https://tugaflix.site/";
function parseSearch(page) {
  const results = [];
  const $ = load(page);
  $(".items .poster").each((_, element) => {
    var _a;
    const $link = $(element).find("a");
    const url = $link.attr("href");
    const [, title, year] = ((_a = $link.attr("title")) == null ? void 0 : _a.match(/^(.*?)\s*(?:\((\d{4})\))?\s*$/)) || [];
    if (!title || !url) return;
    results.push({ title, year: year ? parseInt(year, 10) : void 0, url });
  });
  return results;
}
const tugaflixScraper = makeSourcerer({
  id: "tugaflix",
  name: "Tugaflix",
  rank: 169,
  flags: [flags.CORS_ALLOWED],
  // No longer IP locked
  scrapeMovie: async (ctx) => {
    var _a;
    const searchResults = parseSearch(
      await ctx.proxiedFetcher("/filmes/", {
        baseUrl: baseUrl$n,
        query: {
          s: ctx.media.title
        }
      })
    );
    if (searchResults.length === 0) throw new NotFoundError("No watchable item found");
    const url = (_a = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))) == null ? void 0 : _a.url;
    if (!url) throw new NotFoundError("No watchable item found");
    ctx.progress(50);
    const videoPage = await ctx.proxiedFetcher(url, {
      method: "POST",
      body: new URLSearchParams({ play: "" })
    });
    const $ = load(videoPage);
    const embeds = [];
    for (const element of $(".play a")) {
      const embedUrl = $(element).attr("href");
      if (!embedUrl) continue;
      const embedPage = await ctx.proxiedFetcher.full(
        embedUrl.startsWith("https://") ? embedUrl : `https://${embedUrl}`
      );
      const finalUrl = load(embedPage.body)('a:contains("Download Filme")').attr("href");
      if (!finalUrl) continue;
      if (finalUrl.includes("streamtape")) {
        embeds.push({
          embedId: "streamtape",
          url: finalUrl
        });
      } else if (finalUrl.includes("dood")) {
        embeds.push({
          embedId: "dood",
          url: finalUrl
        });
      }
    }
    ctx.progress(90);
    return {
      embeds
    };
  },
  scrapeShow: async (ctx) => {
    var _a;
    const searchResults = parseSearch(
      await ctx.proxiedFetcher("/series/", {
        baseUrl: baseUrl$n,
        query: {
          s: ctx.media.title
        }
      })
    );
    if (searchResults.length === 0) throw new NotFoundError("No watchable item found");
    const url = (_a = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))) == null ? void 0 : _a.url;
    if (!url) throw new NotFoundError("No watchable item found");
    ctx.progress(50);
    const s = ctx.media.season.number < 10 ? `0${ctx.media.season.number}` : ctx.media.season.number.toString();
    const e = ctx.media.episode.number < 10 ? `0${ctx.media.episode.number}` : ctx.media.episode.number.toString();
    const videoPage = await ctx.proxiedFetcher(url, {
      method: "POST",
      body: new URLSearchParams({ [`S${s}E${e}`]: "" })
    });
    const embedUrl = load(videoPage)('iframe[name="player"]').attr("src");
    if (!embedUrl) throw new Error("Failed to find iframe");
    const playerPage = await ctx.proxiedFetcher(embedUrl.startsWith("https:") ? embedUrl : `https:${embedUrl}`, {
      method: "POST",
      body: new URLSearchParams({ submit: "" })
    });
    const embeds = [];
    const finalUrl = load(playerPage)('a:contains("Download Episodio")').attr("href");
    if (finalUrl == null ? void 0 : finalUrl.includes("streamtape")) {
      embeds.push({
        embedId: "streamtape",
        url: finalUrl
      });
    } else if (finalUrl == null ? void 0 : finalUrl.includes("dood")) {
      embeds.push({
        embedId: "dood",
        url: finalUrl
      });
    }
    ctx.progress(90);
    return {
      embeds
    };
  }
});
const baseUrl$m = "https://vsembed.ru";
function digitToLetterMap(digit) {
  const map = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  return map[parseInt(digit, 10)];
}
function encodeTmdbId(tmdb, type, season, episode) {
  let raw;
  if (type === "show" && season && episode) {
    raw = `${tmdb}-${season}-${episode}`;
  } else {
    raw = tmdb.split("").map(digitToLetterMap).join("");
  }
  const reversed = raw.split("").reverse().join("");
  return btoa(btoa(reversed));
}
async function comboScraper$s(ctx) {
  const apiType = ctx.media.type === "show" ? "tv" : "movie";
  const encodedId = encodeTmdbId(
    ctx.media.tmdbId,
    ctx.media.type,
    ctx.media.type === "show" ? ctx.media.season.number : void 0,
    ctx.media.type === "show" ? ctx.media.episode.number : void 0
  );
  const url = `${baseUrl$m}/${apiType}/${encodedId}`;
  const data = await ctx.proxiedFetcher(url);
  if (!data || !data.source1) throw new NotFoundError("No sources found");
  const embeds = [];
  const embedIds = ["vidsrc-comet", "vidsrc-pulsar", "vidsrc-nova"];
  let sourceIndex = 0;
  for (let i = 1; data[`source${i}`]; i++) {
    const source = data[`source${i}`];
    if (source == null ? void 0 : source.url) {
      embeds.push({
        embedId: embedIds[sourceIndex % embedIds.length],
        url: source.url
      });
      sourceIndex++;
    }
  }
  if (embeds.length === 0) throw new NotFoundError("No embeds found");
  return {
    embeds
  };
}
const vidsrcvipScraper = makeSourcerer({
  id: "vidsrcvip",
  name: "VidSrc.vip",
  rank: 150,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$s,
  scrapeShow: comboScraper$s
});
const streambucketScraper = makeEmbed({
  id: "streambucket",
  name: "Streambucket",
  rank: 220,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let baseUrl2 = ctx.url;
    if (baseUrl2.includes("multiembed") || baseUrl2.includes("ghostplayer")) {
      const redirectResp = await ctx.proxiedFetcher.full(baseUrl2);
      baseUrl2 = redirectResp.finalUrl;
    }
    const userAgent2 = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
    ctx.progress(20);
    const data = {
      "button-click": "ZEhKMVpTLVF0LVBTLVF0LVAtMGs1TFMtUXpPREF0TC0wLVYzTi0wVS1RTi0wQTFORGN6TmprLTU=",
      "button-referer": ""
    };
    const postResp = await ctx.proxiedFetcher(baseUrl2, {
      method: "POST",
      body: new URLSearchParams(data),
      headers: {
        Referer: "https://multiembed.mov",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": userAgent2,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    ctx.progress(40);
    const tokenMatch = postResp.match(/load_sources\("([^"]+)"\)/);
    if (!tokenMatch) throw new NotFoundError("Session token not found");
    const token = tokenMatch[1];
    const sourcesResp = await ctx.proxiedFetcher("https://streamingnow.mov/response.php", {
      method: "POST",
      body: new URLSearchParams({ token }),
      headers: {
        Referer: baseUrl2,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": userAgent2,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    ctx.progress(60);
    const $ = load(sourcesResp);
    let selectedSource = $("li").filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes("vipstream-s");
    }).first();
    if (!selectedSource.length) {
      selectedSource = $("li").filter((_, el) => {
        const text = $(el).text().toLowerCase();
        return text.includes("vidsrc");
      }).first();
      if (!selectedSource.length) {
        selectedSource = $("li").first();
      }
    }
    if (!selectedSource.length) {
      throw new NotFoundError("No streams available");
    }
    const serverId = selectedSource.attr("data-server");
    const videoId = selectedSource.attr("data-id");
    if (!serverId || !videoId) {
      throw new NotFoundError("Server or video ID not found");
    }
    ctx.progress(70);
    const vipUrl = `https://streamingnow.mov/playvideo.php?video_id=${videoId}&server_id=${serverId}&token=${token}&init=1`;
    const vipResp = await ctx.proxiedFetcher(vipUrl, {
      headers: {
        Referer: baseUrl2,
        "User-Agent": userAgent2
      }
    });
    ctx.progress(80);
    const hasCaptcha = vipResp.includes("captcha") || vipResp.includes("Verification") || vipResp.includes("Select all images");
    if (hasCaptcha) {
      throw new NotFoundError("Stream protected by CAPTCHA");
    }
    const directVideoMatch = vipResp.match(/file:"(https?:\/\/[^"]+)"/) || vipResp.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || vipResp.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
    if (directVideoMatch) {
      const videoUrl2 = directVideoMatch[1];
      const urlObj2 = new URL(baseUrl2);
      const defaultDomain2 = `${urlObj2.protocol}//${urlObj2.host}`;
      const headers22 = {
        Referer: defaultDomain2,
        "User-Agent": userAgent2
      };
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(videoUrl2, { requires: [flags.CORS_ALLOWED] }, headers22),
            headers: headers22,
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
    const vip$ = load(vipResp);
    const iframe = vip$("iframe.source-frame.show");
    if (!iframe.length) throw new NotFoundError("Video iframe not found");
    const iframeUrl = iframe.attr("src");
    if (!iframeUrl) throw new NotFoundError("Iframe URL not found");
    const videoResp = await ctx.proxiedFetcher(iframeUrl, {
      headers: {
        Referer: vipUrl,
        "User-Agent": userAgent2
      }
    });
    ctx.progress(90);
    const videoMatch = videoResp.match(/file:"(https?:\/\/[^"]+)"/);
    if (!videoMatch) throw new NotFoundError("Video URL not found");
    const videoUrl = videoMatch[1];
    const urlObj = new URL(baseUrl2);
    const defaultDomain = `${urlObj.protocol}//${urlObj.host}`;
    const headers2 = {
      Referer: defaultDomain,
      "User-Agent": userAgent2
    };
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: createM3U8ProxyUrl(videoUrl, { requires: [flags.CORS_ALLOWED] }, headers2),
          headers: headers2,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
});
const ANIMETSU_SERVERS = ["pahe", "zoro", "zaza", "meg", "bato"];
const baseUrl$l = "https://backend.animetsu.net";
const headers$b = {
  referer: "https://animetsu.net/",
  origin: "https://backend.animetsu.net",
  accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};
function makeAnimetsuEmbed(id, rank = 100) {
  return makeEmbed({
    id: `animetsu-${id}`,
    name: `Animetsu ${id.charAt(0).toUpperCase() + id.slice(1)}`,
    rank,
    flags: [],
    async scrape(ctx) {
      var _a;
      const serverName = id;
      const query = JSON.parse(ctx.url);
      const { type, anilistId, episode } = query;
      if (type !== "movie" && type !== "show") {
        throw new NotFoundError("Unsupported media type");
      }
      const res = await ctx.proxiedFetcher(`/api/anime/tiddies`, {
        baseUrl: baseUrl$l,
        headers: headers$b,
        query: {
          server: serverName,
          id: String(anilistId),
          num: String(episode ?? 1),
          subType: "dub"
        }
      });
      console.log("Animetsu API Response:", JSON.stringify(res, null, 2));
      const source = (_a = res == null ? void 0 : res.sources) == null ? void 0 : _a[0];
      if (!(source == null ? void 0 : source.url)) throw new NotFoundError("No source URL found");
      const streamUrl = source.url;
      const sourceType = source.type;
      const sourceQuality = source.quality;
      ctx.progress(100);
      if (sourceType === "mp4") {
        let qualityKey = "unknown";
        if (sourceQuality) {
          const qualityMatch = sourceQuality.match(/(\d+)p?/);
          if (qualityMatch) {
            qualityKey = parseInt(qualityMatch[1], 10);
          }
        }
        return {
          stream: [
            {
              id: "primary",
              captions: [],
              qualities: {
                [qualityKey]: {
                  type: "mp4",
                  url: streamUrl
                }
              },
              type: "file",
              headers: headers$b,
              flags: []
            }
          ]
        };
      }
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: streamUrl,
            headers: headers$b,
            flags: [],
            captions: []
          }
        ]
      };
    }
  });
}
const AnimetsuEmbeds = ANIMETSU_SERVERS.map((server, i) => makeAnimetsuEmbed(server, 930 - i));
const CINEMAOS_API = atob("aHR0cHM6Ly9jaW5lbWFvcy12My52ZXJjZWwuYXBwL2FwaS9uZW8vYmFja2VuZGZldGNo");
function makeCinemaOSEmbed(server, rank) {
  return makeEmbed({
    id: `cinemaos-${server}`,
    name: `${server.charAt(0).toUpperCase() + server.slice(1)}`,
    rank,
    flags: [flags.CORS_ALLOWED],
    disabled: false,
    async scrape(ctx) {
      var _a;
      const query = JSON.parse(ctx.url);
      const { tmdbId, type, season, episode } = query;
      let url = `${CINEMAOS_API}?requestID=${type === "show" ? "tvVideoProvider" : "movieVideoProvider"}&id=${tmdbId}&service=${server}`;
      if (type === "show") {
        url += `&season=${season}&episode=${episode}`;
      }
      const res = await ctx.proxiedFetcher(url);
      const data = typeof res === "string" ? JSON.parse(res) : res;
      const sources = (_a = data == null ? void 0 : data.data) == null ? void 0 : _a.sources;
      if (!sources || !Array.isArray(sources) || sources.length === 0) {
        throw new NotFoundError("No sources found");
      }
      ctx.progress(80);
      if (sources.length === 1) {
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: sources[0].url,
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ]
        };
      }
      const qualityMap = {};
      for (const src of sources) {
        const quality = (src.quality || src.source || "unknown").toString();
        let qualityKey;
        if (quality === "4K") {
          qualityKey = 2160;
        } else {
          qualityKey = parseInt(quality.replace("P", ""), 10);
        }
        if (Number.isNaN(qualityKey) || qualityMap[qualityKey]) continue;
        qualityMap[qualityKey] = {
          type: "mp4",
          url: src.url
        };
      }
      return {
        stream: [
          {
            id: "primary",
            type: "file",
            flags: [flags.CORS_ALLOWED],
            qualities: qualityMap,
            captions: []
          }
        ]
      };
    }
  });
}
const CINEMAOS_SERVERS = [
  //   'flowcast',
  "shadow",
  "asiacloud",
  //   'hindicast',
  //   'anime',
  //   'animez',
  //   'guard',
  //   'hq',
  //   'ninja',
  //   'alpha',
  //   'kaze',
  //   'zenith',
  //   'cast',
  //   'ghost',
  //   'halo',
  //   'kinoecho',
  //   'ee3',
  //   'volt',
  //   'putafilme',
  "ophim"
  //   'kage',
];
const cinemaosEmbeds = CINEMAOS_SERVERS.map((server, i) => makeCinemaOSEmbed(server, 300 - i));
function makeCinemaOSHexaEmbed(id, rank = 100) {
  return makeEmbed({
    id: `cinemaos-hexa-${id}`,
    name: `Hexa ${id.charAt(0).toUpperCase() + id.slice(1)}`,
    disabled: false,
    rank,
    flags: [flags.CORS_ALLOWED],
    async scrape(ctx) {
      const query = JSON.parse(ctx.url);
      const directUrl = query.directUrl;
      if (!directUrl) {
        throw new NotFoundError("No directUrl provided for Hexa embed");
      }
      const headers2 = {
        referer: "https://megacloud.store/",
        origin: "https://megacloud.store"
      };
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(directUrl, ctx.features, headers2),
            headers: headers2,
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
}
const HEXA_SERVERS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
HEXA_SERVERS.map((server, i) => makeCinemaOSHexaEmbed(server, 315 - i));
function customAtob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const str = input.replace(/=+$/, "");
  let output = "";
  if (str.length % 4 === 1) {
    throw new Error("The string to be decoded is not correctly encoded.");
  }
  for (let bc = 0, bs = 0, i = 0; i < str.length; i++) {
    const buffer = str.charAt(i);
    const charIndex = chars.indexOf(buffer);
    if (charIndex === -1) continue;
    bs = bc % 4 ? bs * 64 + charIndex : charIndex;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
    }
  }
  return output;
}
function decodeCloseload(valueParts) {
  const value = valueParts.join("");
  let result = value;
  result = atob(result);
  result = result.replace(/[a-zA-Z]/g, function rot13Transform(c) {
    const charCode = c.charCodeAt(0);
    const newCharCode = charCode + 13;
    const maxCode = c <= "Z" ? 90 : 122;
    return String.fromCharCode(newCharCode <= maxCode ? newCharCode : newCharCode - 26);
  });
  result = result.split("").reverse().join("");
  let unmix = "";
  for (let i = 0; i < result.length; i++) {
    let charCode = result.charCodeAt(i);
    charCode = (charCode - 399756995 % (i + 5) + 256) % 256;
    unmix += String.fromCharCode(charCode);
  }
  return unmix;
}
const referer$2 = "https://ridomovies.tv/";
const closeLoadScraper = makeEmbed({
  id: "closeload",
  name: "CloseLoad",
  rank: 106,
  flags: [flags.IP_LOCKED],
  disabled: false,
  async scrape(ctx) {
    const baseUrl2 = new URL(ctx.url).origin;
    const iframeRes = await ctx.proxiedFetcher(ctx.url, {
      headers: { referer: referer$2 }
    });
    const iframeRes$ = load(iframeRes);
    const captions = iframeRes$("track").map((_, el) => {
      const track = iframeRes$(el);
      const url2 = `${baseUrl2}${track.attr("src")}`;
      const label = track.attr("label") ?? "";
      const language = labelToLanguageCode(label);
      const captionType = getCaptionTypeFromUrl(url2);
      if (!language || !captionType) return null;
      return {
        id: url2,
        language,
        hasCorsRestrictions: true,
        type: captionType,
        url: url2
      };
    }).get().filter((x) => x !== null);
    const evalCode = iframeRes$("script").filter((_, el) => {
      var _a;
      const script = iframeRes$(el);
      return (script.attr("type") === "text/javascript" && ((_a = script.html()) == null ? void 0 : _a.includes("p,a,c,k,e,d"))) ?? false;
    }).html();
    if (!evalCode) throw new Error("Couldn't find eval code");
    const decoded = unpack$2(evalCode);
    let base64EncodedUrl;
    const functionCallMatch = decoded.match(/dc_\w+\(\[([^\]]+)\]\)/);
    if (functionCallMatch) {
      const arrayContent = functionCallMatch[1];
      const stringMatches = arrayContent.match(/"([^"]+)"/g);
      if (stringMatches) {
        const valueParts = stringMatches.map((s) => s.slice(1, -1));
        try {
          const decodedUrl = decodeCloseload(valueParts);
          if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
            base64EncodedUrl = decodedUrl;
          }
        } catch (error) {
        }
      }
    }
    if (!base64EncodedUrl) {
      const patterns = [/var\s+(\w+)\s*=\s*"([^"]+)";/g, /(\w+)\s*=\s*"([^"]+)"/g, /"([A-Za-z0-9+/=]+)"/g];
      for (const pattern of patterns) {
        const match = pattern.exec(decoded);
        if (match) {
          const potentialUrl = match[2] || match[1];
          if (/^[A-Za-z0-9+/]*={0,2}$/.test(potentialUrl) && potentialUrl.length > 10) {
            base64EncodedUrl = potentialUrl;
            break;
          }
        }
      }
    }
    if (!base64EncodedUrl) throw new NotFoundError("Unable to find source url");
    let url;
    if (base64EncodedUrl.startsWith("http://") || base64EncodedUrl.startsWith("https://")) {
      url = base64EncodedUrl;
    } else {
      const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(base64EncodedUrl);
      if (!isValidBase64) {
        throw new NotFoundError("Invalid base64 encoding found in source url");
      }
      let decodedString;
      try {
        decodedString = atob(base64EncodedUrl);
      } catch (error) {
        try {
          decodedString = customAtob(base64EncodedUrl);
        } catch (customError) {
          throw new NotFoundError(`Failed to decode base64 source url: ${base64EncodedUrl.substring(0, 50)}...`);
        }
      }
      const urlMatch = decodedString.match(/(https?:\/\/[^\s"']+)/);
      if (urlMatch) {
        url = urlMatch[1];
      } else if (decodedString.startsWith("http://") || decodedString.startsWith("https://")) {
        url = decodedString;
      } else {
        throw new NotFoundError(`Decoded string is not a valid URL: ${decodedString.substring(0, 100)}...`);
      }
    }
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: url,
          captions,
          flags: [flags.IP_LOCKED],
          headers: {
            Referer: "https://closeload.top/",
            Origin: "https://closeload.top"
          }
        }
      ]
    };
  }
});
const tracksRegex = /\{file:"([^"]+)",kind:"thumbnails"\}/g;
function extractUrlFromPacked$1(html, patterns) {
  const $ = load(html);
  const packedScript = $("script").filter((_, el) => {
    const htmlContent = $(el).html();
    return htmlContent != null && htmlContent.includes("eval(function(p,a,c,k,e,d)");
  }).first().html();
  if (!packedScript) throw new NotFoundError("Packed script not found");
  try {
    const unpacked = unpack$2(packedScript);
    for (const pattern of patterns) {
      const match = unpacked.match(pattern);
      if (match == null ? void 0 : match[1]) {
        return match[1];
      }
    }
  } catch (error) {
    console.warn("Unpacking failed, trying fallback patterns");
  }
  throw new NotFoundError("Failed to find file URL in packed code");
}
function extractThumbnailTrack(html) {
  const $ = load(html);
  const packedScript = $("script").filter((_, el) => {
    const htmlContent = $(el).html();
    return htmlContent != null && htmlContent.includes("eval(function(p,a,c,k,e,d)");
  }).first().html();
  if (!packedScript) return null;
  try {
    const unpacked = unpack$2(packedScript);
    const thumbnailMatch = tracksRegex.exec(unpacked);
    return (thumbnailMatch == null ? void 0 : thumbnailMatch[1]) || null;
  } catch (error) {
    return null;
  }
}
const droploadScraper = makeEmbed({
  id: "dropload",
  name: "Dropload",
  rank: 120,
  flags: [flags.CORS_ALLOWED],
  scrape: async (ctx) => {
    const headers2 = {
      referer: ctx.url
    };
    const html = await ctx.proxiedFetcher(ctx.url, {
      headers: headers2
    });
    if (html.includes("File Not Found") || html.includes("Pending in queue")) {
      throw new NotFoundError();
    }
    const playlistUrl = extractUrlFromPacked$1(html, [/sources:\[{file:"(.*?)"/]);
    const mainPageUrl = new URL(ctx.url);
    const thumbnailTrack = extractThumbnailTrack(html);
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: playlistUrl,
          flags: [flags.CORS_ALLOWED],
          captions: [],
          ...thumbnailTrack && {
            thumbnailTrack: {
              type: "vtt",
              url: mainPageUrl.origin + thumbnailTrack
            }
          }
        }
      ]
    };
  }
});
const filelionsScraper = makeEmbed({
  id: "filelions",
  name: "Filelions",
  rank: 115,
  flags: [],
  async scrape(ctx) {
    const html = await ctx.proxiedFetcher(ctx.url, {
      headers: {
        Referer: "https://primesrc.me/"
      }
    });
    const $ = load(html);
    const packedScript = $("script").filter((_, el) => {
      const htmlContent = $(el).html();
      return htmlContent != null && htmlContent.includes("eval(function(p,a,c,k,e,d)");
    }).first().html();
    if (!packedScript) throw new NotFoundError("Packed script not found");
    const evalMatch = packedScript.match(/eval\((.*)\)/);
    if (!evalMatch) throw new NotFoundError("Eval code not found");
    const unpacked = unpack$2(evalMatch[1]);
    const linksMatch = unpacked.match(/var links=(\{.*?\})/);
    if (!linksMatch) throw new NotFoundError("Links object not found");
    const links = JSON.parse(linksMatch[1]);
    Object.keys(links).forEach((key2) => {
      if (links[key2].startsWith("/stream/")) {
        links[key2] = `https://dinisglows.com${links[key2]}`;
      }
    });
    const streamUrl = links.hls4 || Object.values(links)[0];
    if (!streamUrl) throw new NotFoundError("No stream URL found");
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: streamUrl,
          headers: {
            Referer: "https://primesrc.me/"
          },
          flags: [],
          captions: []
        }
      ]
    };
  }
});
const myanimedubScraper = makeEmbed({
  id: "myanimedub",
  name: "MyAnime (Dub)",
  rank: 205,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    var _a, _b, _c;
    const streamData = await ctx.proxiedFetcher(
      `https://anime.aether.mom/api/stream?id=${ctx.url}&server=HD-2&type=dub`
    );
    if (!((_b = (_a = streamData.results.streamingLink) == null ? void 0 : _a.link) == null ? void 0 : _b.file)) {
      throw new NotFoundError("No watchable sources found");
    }
    const getValidTimestamp = (timestamp) => {
      if (!timestamp || typeof timestamp !== "object") return null;
      const start = parseInt(timestamp.start, 10);
      const end = parseInt(timestamp.end, 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end <= 0 || start >= end) return null;
      return { start, end };
    };
    const intro = getValidTimestamp(streamData.results.streamingLink.intro);
    const outro = getValidTimestamp(streamData.results.streamingLink.outro);
    return {
      stream: [
        {
          id: "dub",
          type: "hls",
          playlist: createM3U8ProxyUrl(streamData.results.streamingLink.link.file, ctx.features, {
            Referer: "https://rapid-cloud.co/"
          }),
          headers: {
            Referer: "https://rapid-cloud.co/"
          },
          flags: [flags.CORS_ALLOWED],
          captions: ((_c = streamData.results.streamingLink.tracks) == null ? void 0 : _c.map((track) => {
            const lang = labelToLanguageCode(track.label);
            const type = getCaptionTypeFromUrl(track.file);
            if (!lang || !type) return null;
            return {
              id: track.file,
              url: track.file,
              language: lang,
              type,
              hasCorsRestrictions: true
            };
          }).filter((x) => x)) ?? [],
          intro,
          outro
        }
      ]
    };
  }
});
const myanimesubScraper = makeEmbed({
  id: "myanimesub",
  name: "MyAnime (Sub)",
  rank: 204,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    var _a, _b, _c;
    const streamData = await ctx.proxiedFetcher(
      `https://anime.aether.mom/api/stream?id=${ctx.url}&server=HD-2&type=sub`
    );
    if (!((_b = (_a = streamData.results.streamingLink) == null ? void 0 : _a.link) == null ? void 0 : _b.file)) {
      throw new NotFoundError("No watchable sources found");
    }
    const getValidTimestamp = (timestamp) => {
      if (!timestamp || typeof timestamp !== "object") return null;
      const start = parseInt(timestamp.start, 10);
      const end = parseInt(timestamp.end, 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end <= 0 || start >= end) return null;
      return { start, end };
    };
    const intro = getValidTimestamp(streamData.results.streamingLink.intro);
    const outro = getValidTimestamp(streamData.results.streamingLink.outro);
    return {
      stream: [
        {
          id: "sub",
          type: "hls",
          playlist: createM3U8ProxyUrl(streamData.results.streamingLink.link.file, ctx.features, {
            Referer: "https://rapid-cloud.co/"
          }),
          headers: {
            Referer: "https://rapid-cloud.co/"
          },
          flags: [flags.CORS_ALLOWED],
          captions: ((_c = streamData.results.streamingLink.tracks) == null ? void 0 : _c.map((track) => {
            const lang = labelToLanguageCode(track.label);
            const type = getCaptionTypeFromUrl(track.file);
            if (!lang || !type) return null;
            return {
              id: track.file,
              url: track.file,
              language: lang,
              type,
              hasCorsRestrictions: true
            };
          }).filter((x) => x)) ?? [],
          intro,
          outro
        }
      ]
    };
  }
});
const referer$1 = "https://ridomovies.tv/";
const playlistHeaders = {
  referer: "https://ridoo.net/",
  origin: "https://ridoo.net"
};
const ridooScraper = makeEmbed({
  id: "ridoo",
  name: "Ridoo",
  rank: 121,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    var _a;
    const res = await ctx.proxiedFetcher(ctx.url, {
      headers: {
        referer: referer$1
      }
    });
    const regexPattern = /file:"([^"]+)"/g;
    const url = (_a = regexPattern.exec(res)) == null ? void 0 : _a[1];
    if (!url) throw new NotFoundError("Unable to find source url");
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: url,
          headers: playlistHeaders,
          captions: [],
          flags: [flags.CORS_ALLOWED]
        }
      ]
    };
  }
});
const packedRegex = /(eval\(function\(p,a,c,k,e,d\).*\)\)\))/;
const linkRegex = /src:"(https:\/\/[^"]+)"/;
const streamvidScraper = makeEmbed({
  id: "streamvid",
  name: "Streamvid",
  rank: 215,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const streamRes = await ctx.proxiedFetcher(ctx.url);
    const packed = streamRes.match(packedRegex);
    if (!packed) throw new Error("streamvid packed not found");
    const unpacked = unpacker.unpack(packed[1]);
    const link = unpacked.match(linkRegex);
    if (!link) throw new Error("streamvid link not found");
    return {
      stream: [
        {
          type: "hls",
          id: "primary",
          playlist: link[1],
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
});
let Unbaser$1 = class Unbaser {
  constructor(base) {
    this.ALPHABET = {
      62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
    };
    this.dictionary = {};
    this.base = base;
    if (base > 36 && base < 62) {
      this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substring(0, base);
    }
    if (base >= 2 && base <= 36) {
      this.unbase = (value) => parseInt(value, base);
    } else {
      try {
        [...this.ALPHABET[base]].forEach((cipher, index) => {
          this.dictionary[cipher] = index;
        });
      } catch {
        throw new Error("Unsupported base encoding.");
      }
      this.unbase = this._dictunbaser.bind(this);
    }
  }
  _dictunbaser(value) {
    let ret = 0;
    [...value].reverse().forEach((cipher, index) => {
      ret += this.base ** index * this.dictionary[cipher];
    });
    return ret;
  }
};
function _filterargs$1(code) {
  const juicers = [
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
  ];
  for (const juicer of juicers) {
    const args = juicer.exec(code);
    if (args) {
      try {
        return {
          payload: args[1],
          symtab: args[4].split("|"),
          radix: parseInt(args[2], 10),
          count: parseInt(args[3], 10)
        };
      } catch {
        throw new Error("Corrupted p.a.c.k.e.r. data.");
      }
    }
  }
  throw new Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
}
function _replacestrings(str) {
  return str;
}
function unpack$1(packedCode) {
  const { payload, symtab, radix, count } = _filterargs$1(packedCode);
  if (count !== symtab.length) {
    throw new Error("Malformed p.a.c.k.e.r. symtab.");
  }
  let unbase;
  try {
    unbase = new Unbaser$1(radix);
  } catch {
    throw new Error("Unknown p.a.c.k.e.r. encoding.");
  }
  const lookup = (match) => {
    const word = match;
    const word2 = radix === 1 ? symtab[parseInt(word, 10)] : symtab[unbase.unbase(word)];
    return word2 || word;
  };
  const replaced = payload.replace(/\b\w+\b/g, lookup);
  return _replacestrings(replaced);
}
const providers$2 = [
  {
    id: "streamwish-japanese",
    name: "StreamWish (Japanese Sub Español)",
    rank: 171
  },
  {
    id: "streamwish-latino",
    name: "streamwish (latino)",
    rank: 170
  },
  {
    id: "streamwish-spanish",
    name: "streamwish (castellano)",
    rank: 169
  },
  {
    id: "streamwish-english",
    name: "streamwish (english)",
    rank: 168
  }
];
function embed$1(provider) {
  return makeEmbed({
    id: provider.id,
    name: provider.name,
    rank: provider.rank,
    flags: [flags.CORS_ALLOWED],
    disabled: provider.disabled,
    async scrape(ctx) {
      const headers2 = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Encoding": "*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
      };
      const domains = [
        "hgplaycdn.com",
        "habetar.com",
        "yuguaab.com",
        "guxhag.com",
        "auvexiug.com",
        "xenolyzb.com",
        "tryzendm.com"
      ];
      ctx.url = `https://${domains[Math.floor(Math.random() * domains.length)]}${ctx.url.replace("https://streamwish.to", "")}`;
      let html;
      try {
        html = await ctx.proxiedFetcher(ctx.url, { headers: headers2 });
      } catch (error) {
        console.error(`Error:`, {
          message: error instanceof Error ? error.message : "Unknown error",
          cause: error.cause || void 0,
          url: ctx.url
        });
        throw error;
      }
      const obfuscatedScript = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
      if (!obfuscatedScript) {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      let unpackedScript;
      try {
        unpackedScript = unpack$1(obfuscatedScript[1]);
      } catch {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      const hls2Match = unpackedScript.match(/"hls2"\s*:\s*"([^"]+)"/);
      if (!hls2Match) {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      let videoUrl = hls2Match[1];
      if (!/^https?:\/\//.test(videoUrl)) {
        videoUrl = `https://swiftplayers.com/${videoUrl.replace(/^\/+/, "")}`;
      }
      const videoHeaders = {
        Referer: ctx.url,
        Origin: ctx.url
      };
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(videoUrl, ctx.features, videoHeaders),
            headers: videoHeaders,
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ],
        embeds: []
      };
    }
  });
}
const [streamwishLatinoScraper, streamwishSpanishScraper, streamwishEnglishScraper, streamwishJapaneseScraper] = providers$2.map(embed$1);
function extractUrlFromPacked(html, patterns) {
  const $ = load(html);
  const packedScript = $("script").filter((_, el) => {
    const htmlContent = $(el).html();
    return htmlContent != null && htmlContent.includes("eval(function(p,a,c,k,e,d)");
  }).first().html();
  if (!packedScript) throw new NotFoundError("Packed script not found");
  try {
    const unpacked = unpack$2(packedScript);
    for (const pattern of patterns) {
      const match = unpacked.match(pattern);
      if (match == null ? void 0 : match[1]) {
        return match[1];
      }
    }
  } catch (error) {
    console.warn("Unpacking failed, trying fallback patterns");
  }
  throw new NotFoundError("Failed to find file URL in packed code");
}
const supervideoScraper = makeEmbed({
  id: "supervideo",
  name: "SuperVideo",
  rank: 130,
  flags: [flags.CORS_ALLOWED],
  scrape: async (ctx) => {
    let url = ctx.url;
    url = url.replace("/e/", "/").replace("/k/", "/").replace("/embed-", "/");
    const headers2 = {
      referer: ctx.url
    };
    let html = await ctx.proxiedFetcher(url, {
      headers: headers2
    });
    if (html.includes("This video can be watched as embed only")) {
      const embedUrl = url.replace(/\/([^/]*)$/, "/e$1");
      html = await ctx.proxiedFetcher(embedUrl, {
        headers: { ...headers2, referer: embedUrl }
      });
    }
    if (/The file was deleted|The file expired|Video is processing/.test(html)) {
      throw new NotFoundError();
    }
    const m3u8Url = extractUrlFromPacked(html, [/sources:\[{file:"(.*?)"/]);
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: m3u8Url,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
});
const vidCloudScraper = makeEmbed({
  id: "vidcloud",
  name: "VidCloud",
  rank: 201,
  disabled: false,
  flags: [],
  async scrape(ctx) {
    const result = await upcloudScraper.scrape(ctx);
    return {
      stream: result.stream.map((s) => ({
        ...s,
        flags: []
      }))
    };
  }
});
class Unbaser2 {
  constructor(base) {
    this.ALPHABET = {
      62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      95: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
    };
    this.dictionary = {};
    this.base = base;
    if (base > 36 && base < 62) {
      this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substring(0, base);
    }
    if (base >= 2 && base <= 36) {
      this.unbase = (value) => parseInt(value, base);
    } else {
      try {
        [...this.ALPHABET[base]].forEach((cipher, index) => {
          this.dictionary[cipher] = index;
        });
      } catch {
        throw new Error("Unsupported base encoding.");
      }
      this.unbase = this._dictunbaser.bind(this);
    }
  }
  _dictunbaser(value) {
    let ret = 0;
    [...value].reverse().forEach((cipher, index) => {
      ret += this.base ** index * this.dictionary[cipher];
    });
    return ret;
  }
}
function _filterargs(code) {
  const juicers = [/}\s*\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\)/];
  for (const juicer of juicers) {
    const args = juicer.exec(code);
    if (args) {
      try {
        return {
          payload: args[1],
          radix: parseInt(args[2], 10),
          count: parseInt(args[3], 10),
          symtab: args[4].split("|")
        };
      } catch {
        throw new Error("Corrupted p.a.c.k.e.r. data.");
      }
    }
  }
  throw new Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
}
function unpack(packedCode) {
  const { payload, symtab, radix, count } = _filterargs(packedCode);
  if (count !== symtab.length) throw new Error("Malformed p.a.c.k.e.r. symtab.");
  let unbase;
  try {
    unbase = new Unbaser2(radix);
  } catch {
    throw new Error("Unknown p.a.c.k.e.r. encoding.");
  }
  const lookup = (match) => {
    const word = match;
    const word2 = radix === 1 ? symtab[parseInt(word, 10)] : symtab[unbase.unbase(word)];
    return word2 || word;
  };
  return payload.replace(/\b\w+\b/g, lookup);
}
const VIDHIDE_DOMAINS = ["https://vidhidepro.com", "https://vidhidefast.com", "https://dinisglows.com"];
function buildOfficialUrl(originalUrl, officialDomain) {
  try {
    const u = new URL(originalUrl);
    return `${officialDomain}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return originalUrl;
  }
}
async function fetchWithOfficialDomains(ctx, headers2) {
  for (const domain of VIDHIDE_DOMAINS) {
    const testUrl = buildOfficialUrl(ctx.url, domain);
    try {
      const html = await ctx.proxiedFetcher(testUrl, { headers: headers2 });
      if (html && html.includes("eval(function(p,a,c,k,e,d")) {
        return { html, usedUrl: testUrl };
      }
      if (html) {
        return { html, usedUrl: testUrl };
      }
    } catch (err) {
    }
  }
  throw new Error("Could not get valid HTML from any official domain");
}
const providers$1 = [
  {
    id: "vidhide-latino",
    name: "VidHide (Latino)",
    rank: 13
  },
  {
    id: "vidhide-spanish",
    name: "VidHide (Castellano)",
    rank: 14
  },
  {
    id: "vidhide-english",
    name: "VidHide (English)",
    rank: 15
  }
];
function extractSubtitles(unpackedScript) {
  const subtitleRegex = /{file:"([^"]+)",label:"([^"]+)"}/g;
  const results = [];
  const matches = unpackedScript.matchAll(subtitleRegex);
  for (const match of matches) {
    results.push({ file: match[1], label: match[2] });
  }
  return results;
}
function makeVidhideScraper(provider) {
  return makeEmbed({
    id: provider.id,
    name: provider.name,
    rank: provider.rank,
    flags: [flags.IP_LOCKED],
    async scrape(ctx) {
      const headers2 = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Encoding": "*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0"
      };
      const { html, usedUrl } = await fetchWithOfficialDomains(ctx, headers2);
      const obfuscatedScript = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
      if (!obfuscatedScript) {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      let unpackedScript;
      try {
        unpackedScript = unpack(obfuscatedScript[1]);
      } catch (e) {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      const m3u8Links = Array.from(unpackedScript.matchAll(/"(http[^"]*?\.m3u8[^"]*?)"/g)).map((m) => m[1]);
      const masterUrl = m3u8Links.find((url) => url.includes("master.m3u8"));
      if (!masterUrl) {
        return { stream: [], embeds: [{ embedId: provider.id, url: ctx.url }] };
      }
      let videoUrl = masterUrl;
      const subtitles = extractSubtitles(unpackedScript);
      try {
        const m3u8Content = await ctx.proxiedFetcher(videoUrl, {
          headers: { Referer: ctx.url }
        });
        const variants = Array.from(
          m3u8Content.matchAll(/#EXT-X-STREAM-INF:[^\n]+\n(?!iframe)([^\n]*master\.m3u8[^\n]*)/gi)
        );
        if (variants.length > 0) {
          const best = variants[0];
          const base = videoUrl.substring(0, videoUrl.lastIndexOf("/") + 1);
          videoUrl = base + best[1];
        }
      } catch (e) {
      }
      const directHeaders = {
        Referer: usedUrl,
        Origin: new URL(usedUrl).origin
      };
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: videoUrl,
            headers: directHeaders,
            flags: [flags.IP_LOCKED],
            captions: subtitles.map((s, idx) => {
              var _a;
              const ext = (_a = s.file.split(".").pop()) == null ? void 0 : _a.toLowerCase();
              const type = ext === "srt" ? "srt" : "vtt";
              return {
                type,
                id: `caption-${idx}`,
                url: s.file,
                hasCorsRestrictions: false,
                language: s.label || "unknown"
              };
            })
          }
        ]
      };
    }
  });
}
const [vidhideLatinoScraper, vidhideSpanishScraper, vidhideEnglishScraper] = providers$1.map(makeVidhideScraper);
const VIDIFY_SERVERS$1 = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett"];
const baseUrl$k = "api.vidify.top";
const playerUrl$1 = "https://player.vidify.top/";
let cachedAuthHeader = null;
let lastFetched = 0;
async function getAuthHeader(ctx) {
  const now = Date.now();
  if (cachedAuthHeader && now - lastFetched < 1e3 * 60 * 60) {
    return cachedAuthHeader;
  }
  const playerPage = await ctx.proxiedFetcher(playerUrl$1, {
    headers: {
      Referer: playerUrl$1
    }
  });
  const jsFileRegex = /\/assets\/index-([a-zA-Z0-9-]+)\.js/;
  const jsFileMatch = playerPage.match(jsFileRegex);
  if (!jsFileMatch) {
    throw new Error("Could not find the JS file URL in the player page");
  }
  const jsFileUrl = new URL(jsFileMatch[0], playerUrl$1).href;
  const jsContent = await ctx.proxiedFetcher(jsFileUrl, {
    headers: {
      Referer: playerUrl$1
    }
  });
  const authRegex = /Authorization:"Bearer\s*([^"]+)"/;
  const authMatch = jsContent.match(authRegex);
  if (!authMatch || !authMatch[1]) {
    throw new Error("Could not extract the authorization header from the JS file");
  }
  cachedAuthHeader = `Bearer ${authMatch[1]}`;
  lastFetched = now;
  return cachedAuthHeader;
}
function makeVidifyEmbed(id, rank = 100) {
  const serverIndex = VIDIFY_SERVERS$1.indexOf(id) + 1;
  return makeEmbed({
    id: `vidify-${id}`,
    name: `${id.charAt(0).toUpperCase() + id.slice(1)}`,
    rank,
    disabled: false,
    flags: [],
    async scrape(ctx) {
      const query = JSON.parse(ctx.url);
      const { type, tmdbId, season, episode } = query;
      let url = `https://${baseUrl$k}/`;
      if (type === "movie") {
        url += `/movie/${tmdbId}?sr=${serverIndex}`;
      } else if (type === "show") {
        url += `/tv/${tmdbId}/season/${season}/episode/${episode}?sr=${serverIndex}`;
      } else {
        throw new NotFoundError("Unsupported media type");
      }
      const authHeader = await getAuthHeader(ctx);
      const headers2 = {
        referer: "https://player.vidify.top/",
        origin: "https://player.vidify.top",
        Authorization: authHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      };
      const res = await ctx.proxiedFetcher(url, { headers: headers2 });
      console.log(res);
      const playlistUrl = res.m3u8 ?? res.url;
      if (Array.isArray(res.result) && res.result.length > 0) {
        const qualities = {};
        res.result.forEach((r) => {
          if (r.url.includes(".mp4")) {
            qualities[`${r.resolution}p`] = { type: "mp4", url: decodeURIComponent(r.url) };
          }
        });
        if (Object.keys(qualities).length === 0) {
          throw new NotFoundError("No MP4 streams found");
        }
        console.log(`Found MP4 streams: `, qualities);
        return {
          stream: [
            {
              id: "primary",
              type: "file",
              qualities,
              flags: [],
              captions: [],
              headers: {
                Host: "proxy-worker.himanshu464121.workers.dev"
                // seems to be their only mp4 proxy
              }
            }
          ]
        };
      }
      if (!playlistUrl) throw new NotFoundError("No playlist URL found");
      const streamHeaders = { ...headers2 };
      let playlist;
      if (playlistUrl.includes("proxyv1.vidify.top")) {
        console.log(`Found stream (proxyv1): `, playlistUrl, streamHeaders);
        streamHeaders.Host = "proxyv1.vidify.top";
        playlist = decodeURIComponent(playlistUrl);
      } else if (playlistUrl.includes("proxyv2.vidify.top")) {
        console.log(`Found stream (proxyv2): `, playlistUrl, streamHeaders);
        streamHeaders.Host = "proxyv2.vidify.top";
        playlist = decodeURIComponent(playlistUrl);
      } else {
        console.log(`Found normal stream: `, playlistUrl);
        playlist = createM3U8ProxyUrl(decodeURIComponent(playlistUrl), ctx.features, streamHeaders);
      }
      ctx.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist,
            headers: streamHeaders,
            flags: [],
            captions: []
          }
        ]
      };
    }
  });
}
const vidifyEmbeds = VIDIFY_SERVERS$1.map((server, i) => makeVidifyEmbed(server, 230 - i));
const VIDNEST_SERVERS = ["hollymoviehd", "allmovies"];
const baseUrl$j = "https://second.vidnest.fun";
const PASSPHRASE = "A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6pOKFaE3vTnPZsRuYdVmLq2";
const serverConfigs = {
  hollymoviehd: {
    streamDomains: ["pkaystream.cc", "flashstream.cc"],
    origin: "https://flashstream.cc",
    referer: "https://flashstream.cc/"
  },
  allmovies: {
    streamDomains: null,
    origin: "",
    referer: ""
  }
};
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
async function decryptVidnestData(encryptedBase64) {
  const encryptedBytes = base64ToUint8Array(encryptedBase64);
  const iv2 = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12, -16);
  const tag = encryptedBytes.slice(-16);
  const keyData = base64ToUint8Array(PASSPHRASE).slice(0, 32);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv2 }, cryptoKey, combined);
  return JSON.parse(new TextDecoder("utf-8").decode(decrypted));
}
function makeVidnestEmbed(id, rank = 100) {
  const config = serverConfigs[id];
  return makeEmbed({
    id: `vidnest-${id}`,
    name: `Vidnest ${id}`,
    rank,
    disabled: false,
    flags: [],
    async scrape(ctx) {
      const query = JSON.parse(ctx.url);
      const { type, tmdbId, season, episode } = query;
      const endpoint = type === "movie" ? `/${id}/movie/${tmdbId}` : `/${id}/tv/${tmdbId}/${season}/${episode}`;
      const res = await ctx.proxiedFetcher(endpoint, {
        baseUrl: baseUrl$j,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      if (!(res == null ? void 0 : res.data)) throw new NotFoundError("No data");
      const decrypted = await decryptVidnestData(res.data);
      const sources = decrypted.sources || decrypted.streams || [];
      const streams = [];
      for (const source of sources) {
        const url = source.file || source.url;
        if (!url) continue;
        if ((config == null ? void 0 : config.streamDomains) && !config.streamDomains.some((d) => url.includes(d))) continue;
        streams.push(url);
      }
      if (!streams.length) throw new NotFoundError("No streams");
      ctx.progress(100);
      return {
        stream: [
          {
            id,
            type: "hls",
            playlist: streams[0],
            headers: {
              Origin: config == null ? void 0 : config.origin,
              Referer: config == null ? void 0 : config.referer
            },
            flags: [],
            captions: []
          }
        ]
      };
    }
  });
}
const VidnestEmbeds = VIDNEST_SERVERS.map((server, i) => makeVidnestEmbed(server, 104 - i));
const providers = [
  {
    id: "server-13",
    rank: 112
  },
  {
    id: "server-18",
    rank: 111,
    flags: []
  },
  {
    id: "server-11",
    rank: 102
  },
  {
    id: "server-7",
    rank: 92
  },
  {
    id: "server-10",
    rank: 82
  },
  {
    id: "server-1",
    rank: 72
  },
  {
    id: "server-16",
    rank: 64
  },
  {
    id: "server-3",
    rank: 62
  },
  {
    id: "server-17",
    rank: 52
  },
  {
    id: "server-2",
    rank: 42
  },
  {
    id: "server-4",
    rank: 32
  },
  {
    id: "server-5",
    rank: 24
  },
  {
    id: "server-14",
    // catflix? uwu.m3u8
    rank: 22
  },
  {
    id: "server-6",
    rank: 21
  },
  {
    id: "server-15",
    rank: 20
  },
  {
    id: "server-8",
    rank: 19
  },
  {
    id: "server-9",
    rank: 18
  },
  {
    id: "server-19",
    rank: 17
  },
  {
    id: "server-12",
    rank: 16
  }
  // { // Looks like this was removed
  //   id: 'server-20',
  //   rank: 1,
  //   name: 'Cineby',
  // },
];
function embed(provider) {
  return makeEmbed({
    id: provider.id,
    name: provider.name || provider.id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "),
    // disabled: provider.disabled,
    disabled: false,
    rank: provider.rank,
    flags: [flags.CORS_ALLOWED],
    async scrape(ctx) {
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: ctx.url,
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
}
const [
  VidsrcsuServer1Scraper,
  VidsrcsuServer2Scraper,
  VidsrcsuServer3Scraper,
  VidsrcsuServer4Scraper,
  VidsrcsuServer5Scraper,
  VidsrcsuServer6Scraper,
  VidsrcsuServer7Scraper,
  VidsrcsuServer8Scraper,
  VidsrcsuServer9Scraper,
  VidsrcsuServer10Scraper,
  VidsrcsuServer11Scraper,
  VidsrcsuServer12Scraper,
  VidsrcsuServer20Scraper
] = providers.map(embed);
const viperScraper = makeEmbed({
  id: "viper",
  name: "Viper",
  rank: 182,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const apiResponse = await ctx.proxiedFetcher.full(ctx.url, {
      headers: {
        Accept: "application/json",
        Referer: "https://embed.su/"
      }
    });
    if (!apiResponse.body.source) {
      throw new NotFoundError("No source found");
    }
    const playlistUrl = apiResponse.body.source.replace(/^.*\/viper\//, "https://");
    const headers2 = {
      referer: "https://megacloud.store/",
      origin: "https://megacloud.store"
    };
    return {
      stream: [
        {
          type: "hls",
          id: "primary",
          playlist: createM3U8ProxyUrl(playlistUrl, ctx.features, headers2),
          headers: headers2,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
});
const userAgent$1 = "Mozilla/5.0 (Linux; Android 11; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
function cleanSymbols(s) {
  let result = s;
  for (const p of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) {
    result = result.replaceAll(p, "_");
  }
  return result;
}
function cleanUnderscores(s) {
  return s.replace(/_/g, "");
}
function shiftBack(s, n) {
  return Array.from(s).map((c) => String.fromCharCode(c.charCodeAt(0) - n)).join("");
}
function rot13(str) {
  return str.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
}
const voeScraper = makeEmbed({
  id: "voe",
  name: "Voe",
  rank: 180,
  flags: [flags.IP_LOCKED],
  async scrape(ctx) {
    const url = ctx.url;
    const defaultDomain = (() => {
      try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}/`;
      } catch {
        return void 0;
      }
    })();
    const headers2 = {
      "User-Agent": userAgent$1
    };
    if (defaultDomain) {
      headers2.Referer = defaultDomain;
    }
    let html = await ctx.proxiedFetcher(url, { headers: headers2 });
    if (html.includes("Redirecting...")) {
      const match = html.match(/href\s*=\s*'(.*?)';/);
      if (!match) throw new NotFoundError("Redirect target not found");
      const redirectUrl = match[1];
      html = await ctx.proxiedFetcher(redirectUrl, { headers: headers2 });
    }
    const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonScriptMatch) throw new NotFoundError("Obfuscated script not found");
    const obfuscatedScript = jsonScriptMatch[1];
    const encodedMatch = obfuscatedScript.match(/\["(.*?)"\]/);
    if (!encodedMatch) throw new NotFoundError("Encoded data not found");
    const encodedData = encodedMatch[1];
    let decoded = rot13(encodedData);
    decoded = cleanSymbols(decoded);
    decoded = cleanUnderscores(decoded);
    decoded = Buffer.from(decoded, "base64").toString("utf-8");
    decoded = shiftBack(decoded, 3);
    decoded = decoded.split("").reverse().join("");
    decoded = Buffer.from(decoded, "base64").toString("utf-8");
    const json = JSON.parse(decoded);
    const videoUrl = json == null ? void 0 : json.source;
    if (!videoUrl) throw new NotFoundError("No video URL found");
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: videoUrl,
          flags: [flags.IP_LOCKED],
          captions: [],
          headers: {
            Referer: defaultDomain || url,
            Origin: (defaultDomain == null ? void 0 : defaultDomain.replace(/\/$/, "")) || new URL(url).origin,
            "User-Agent": userAgent$1
          }
        }
      ]
    };
  }
});
async function getVideowlUrlStream(ctx, decryptedId) {
  var _a;
  const sharePage = await ctx.proxiedFetcher("https://cloud.mail.ru/public/uaRH/2PYWcJRpH");
  const regex = /"videowl_view":\{"count":"(\d+)","url":"([^"]+)"\}/g;
  const videowlUrl = (_a = regex.exec(sharePage)) == null ? void 0 : _a[2];
  if (!videowlUrl) throw new NotFoundError("Failed to get videoOwlUrl");
  return `${videowlUrl}/0p/${btoa(decryptedId)}.m3u8?${new URLSearchParams({
    double_encode: "1"
  })}`;
}
const warezcdnembedHlsScraper = makeEmbed({
  id: "warezcdnembedhls",
  // WarezCDN is both a source and an embed host
  name: "WarezCDN HLS",
  // method no longer works
  disabled: false,
  rank: 83,
  flags: [flags.IP_LOCKED],
  async scrape(ctx) {
    const decryptedId = await getDecryptedId(ctx);
    if (!decryptedId) throw new NotFoundError("can't get file id");
    const streamUrl = await getVideowlUrlStream(ctx, decryptedId);
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          flags: [flags.IP_LOCKED],
          captions: [],
          playlist: streamUrl
        }
      ]
    };
  }
});
const warezPlayerScraper = makeEmbed({
  id: "warezplayer",
  name: "warezPLAYER",
  disabled: false,
  rank: 85,
  flags: [],
  async scrape(ctx) {
    const playerPageUrl = new URL(ctx.url);
    const hash = playerPageUrl.pathname.split("/")[2];
    const playerApiRes = await ctx.proxiedFetcher("/player/index.php", {
      baseUrl: playerPageUrl.origin,
      query: {
        data: hash,
        do: "getVideo"
      },
      method: "POST",
      body: new URLSearchParams({
        hash
      }),
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const sources = JSON.parse(playerApiRes);
    if (!sources.videoSource) throw new Error("Playlist not found");
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          flags: [],
          captions: [],
          playlist: sources.videoSource,
          headers: {
            // without this it returns "security error"
            Accept: "*/*"
          }
        }
      ]
    };
  }
});
const ZUNIME_SERVERS = ["hd-2", "miko", "shiro", "zaza"];
const baseUrl$i = "https://backend.xaiby.sbs";
const headers$a = {
  referer: "https://vidnest.fun/",
  origin: "https://vidnest.fun",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};
function makeZunimeEmbed(id, rank = 100) {
  return makeEmbed({
    id: `zunime-${id}`,
    name: `Zunime ${id.charAt(0).toUpperCase() + id.slice(1)}`,
    rank,
    flags: [flags.CORS_ALLOWED],
    async scrape(ctx) {
      var _a, _b;
      const serverName = id;
      const query = JSON.parse(ctx.url);
      const { anilistId, episode } = query;
      const res = await ctx.proxiedFetcher(`${"/sources"}`, {
        baseUrl: baseUrl$i,
        headers: headers$a,
        query: {
          id: String(anilistId),
          ep: String(episode ?? 1),
          host: serverName,
          type: "dub"
        }
      });
      console.log(res);
      const resAny = res;
      if (!(resAny == null ? void 0 : resAny.success) || !((_a = resAny == null ? void 0 : resAny.sources) == null ? void 0 : _a.url)) {
        throw new NotFoundError("No stream URL found in response");
      }
      const streamUrl = resAny.sources.url;
      const upstreamHeaders = ((_b = resAny == null ? void 0 : resAny.sources) == null ? void 0 : _b.headers) && Object.keys(resAny.sources.headers).length > 0 ? resAny.sources.headers : headers$a;
      ctx.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: `https://proxy-2.madaraverse.online/proxy?url=${encodeURIComponent(streamUrl)}`,
            headers: upstreamHeaders,
            flags: [],
            captions: []
          }
        ]
      };
    }
  });
}
const zunimeEmbeds = ZUNIME_SERVERS.map((server, i) => makeZunimeEmbed(server, 260 - i));
const decApi$1 = "https://enc-dec.app/api/dec-videasy";
const headers$9 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, */*; q=0.01",
  "Referer": "https://player.videasy.net/",
  "Origin": "https://player.videasy.net"
};
async function decrypt$2(blob, tmdbId, ctx) {
  var _a;
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher(decApi$1, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: blob, id: tmdbId })
    });
    if ((res == null ? void 0 : res.status) !== 200 || !((_a = res == null ? void 0 : res.result) == null ? void 0 : _a.sources)) return null;
    return res.result;
  } catch {
    return null;
  }
}
async function scrapeVideasyEmbed(ctx, filterQuality) {
  var _a;
  const url = ctx.url;
  const tmdbId = new URL(url).searchParams.get("tmdbId");
  if (!tmdbId) throw new NotFoundError("Missing TMDB ID");
  const blob = await ctx.proxiedFetcher(url, { headers: headers$9 });
  if (!blob || blob.length < 10) throw new NotFoundError("No stream found");
  const decrypted = await decrypt$2(blob, tmdbId, ctx);
  if (!decrypted || !((_a = decrypted.sources) == null ? void 0 : _a.length)) throw new NotFoundError("Failed to decrypt streams");
  let sources = decrypted.sources.filter((x) => x == null ? void 0 : x.url);
  if (filterQuality) {
    sources = sources.filter((x) => x.quality === filterQuality);
  }
  if (sources.length === 0) throw new NotFoundError("No matching streams found");
  function normalizeQuality2(raw) {
    if (!raw) return "unknown";
    const lower = raw.toLowerCase().trim();
    if (lower === "4k" || lower === "2160p" || lower === "2160" || lower === "uhd") return "4k";
    if (lower === "1080p" || lower === "1080") return "1080";
    if (lower === "720p" || lower === "720") return "720";
    if (lower === "480p" || lower === "480") return "480";
    if (lower === "360p" || lower === "360") return "360";
    const stripped = raw.replace(/p$/i, "");
    return stripped || "unknown";
  }
  const qualities = {};
  sources.forEach((src) => {
    const qKey = normalizeQuality2(src.quality);
    qualities[qKey] = {
      type: "mp4",
      url: src.url
    };
  });
  return {
    stream: [
      {
        id: "primary",
        type: "file",
        flags: [],
        headers: headers$9,
        captions: [],
        qualities
      }
    ]
  };
}
const videasyYoruEmbed = makeEmbed({
  id: "videasy-yoru",
  name: "Yoru 🔥 (Original - 4K)",
  rank: 959,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyNeonEmbed = makeEmbed({
  id: "videasy-neon",
  name: "Neon (Original)",
  rank: 958,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyBreachEmbed = makeEmbed({
  id: "videasy-breach",
  name: "Breach (Original)",
  rank: 957,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyCypherEmbed = makeEmbed({
  id: "videasy-cypher",
  name: "Cypher (Original)",
  rank: 956,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasySageEmbed = makeEmbed({
  id: "videasy-sage",
  name: "Sage (Original)",
  rank: 955,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyVyseEmbed = makeEmbed({
  id: "videasy-vyse",
  name: "Vyse (Original)",
  rank: 954,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx, "English")
});
const videasyOmenEmbed = makeEmbed({
  id: "videasy-omen",
  name: "Omen (Original)",
  rank: 953,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyRazeEmbed = makeEmbed({
  id: "videasy-raze",
  name: "Raze (Original)",
  rank: 952,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const videasyFadeEmbed = makeEmbed({
  id: "videasy-fade",
  name: "Fade (Hindi Audio)",
  rank: 951,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx, "Hindi")
});
const videasyKilljoyEmbed = makeEmbed({
  id: "videasy-killjoy",
  name: "Killjoy (German Audio)",
  rank: 950,
  flags: [],
  scrape: (ctx) => scrapeVideasyEmbed(ctx)
});
const apiBase = "https://enc-dec.app/api";
const version = "1";
const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Referer": "https://vidfast.pro/",
  "X-Requested-With": "XMLHttpRequest"
};
async function scrapeVidfastEmbed(ctx, serverName) {
  const url = ctx.url;
  const html = await ctx.proxiedFetcher(url, {
    headers: {
      "User-Agent": defaultHeaders["User-Agent"],
      "Referer": "https://vidfast.pro/"
    }
  });
  if (!html || html.length < 100) throw new NotFoundError("Empty VidFast page");
  let enToken;
  const match = html.match(/\\"en\\":\\"(.*?)\\"/) || html.match(/"en":"(.*?)"/);
  if (match == null ? void 0 : match[1]) {
    enToken = match[1];
  }
  if (!enToken) throw new NotFoundError('VidFast: Cannot find "en" token');
  const encRes = await ctx.proxiedFetcher(`${apiBase}/enc-vidfast`, {
    method: "GET",
    query: {
      text: enToken,
      version
    }
  });
  if ((encRes == null ? void 0 : encRes.status) !== 200 || !(encRes == null ? void 0 : encRes.result)) {
    throw new NotFoundError(`VidFast enc-vidfast API error: ${(encRes == null ? void 0 : encRes.error) || "unknown"}`);
  }
  const { servers: serversUrl, stream: streamUrl, token } = encRes.result;
  const reqHeaders = {
    ...defaultHeaders,
    "X-CSRF-Token": token
  };
  const serversEncrypted = await ctx.proxiedFetcher(serversUrl, {
    method: "POST",
    headers: reqHeaders
  });
  const decServersRes = await ctx.proxiedFetcher(`${apiBase}/dec-vidfast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: serversEncrypted, version })
  });
  if ((decServersRes == null ? void 0 : decServersRes.status) !== 200 || !(decServersRes == null ? void 0 : decServersRes.result)) {
    throw new NotFoundError(`VidFast dec-vidfast servers error: ${(decServersRes == null ? void 0 : decServersRes.error) || "unknown"}`);
  }
  const serversDecrypted = decServersRes.result;
  const server = serversDecrypted.find(
    (s) => {
      var _a;
      return ((_a = s.name) == null ? void 0 : _a.toLowerCase()) === serverName.toLowerCase();
    }
  ) || serversDecrypted[0];
  if (!server) throw new NotFoundError(`VidFast: Server ${serverName} not found`);
  const data = server.data;
  const streamTargetUrl = `${streamUrl}/${data}`;
  const streamEncrypted = await ctx.proxiedFetcher(streamTargetUrl, {
    method: "POST",
    headers: reqHeaders
  });
  const decStreamRes = await ctx.proxiedFetcher(`${apiBase}/dec-vidfast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: streamEncrypted, version })
  });
  if ((decStreamRes == null ? void 0 : decStreamRes.status) !== 200 || !(decStreamRes == null ? void 0 : decStreamRes.result)) {
    throw new NotFoundError(`VidFast dec-vidfast stream error: ${(decStreamRes == null ? void 0 : decStreamRes.error) || "unknown"}`);
  }
  const streamDecrypted = decStreamRes.result;
  const playlistUrl = streamDecrypted.url;
  if (!playlistUrl) throw new NotFoundError("VidFast: Decrypted stream contains no URL");
  const captions = [];
  if (Array.isArray(streamDecrypted.tracks)) {
    streamDecrypted.tracks.forEach((track) => {
      if (track.file && track.label) {
        captions.push({
          id: track.label.toLowerCase(),
          language: track.label.toLowerCase(),
          url: track.file,
          type: "srt"
        });
      }
    });
  }
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: playlistUrl,
        flags: [],
        headers: {
          "User-Agent": defaultHeaders["User-Agent"],
          "Referer": "https://vidfast.pro/"
        },
        captions
      }
    ]
  };
}
const vidfastAlphaEmbed = makeEmbed({
  id: "vidfast-alpha",
  name: "Alpha (VidFast)",
  rank: 919,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Alpha")
});
const vidfastBetaEmbed = makeEmbed({
  id: "vidfast-beta",
  name: "Beta (VidFast)",
  rank: 918,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Beta")
});
const vidfastOscarEmbed = makeEmbed({
  id: "vidfast-oscar",
  name: "Oscar (VidFast)",
  rank: 917,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Oscar")
});
const vidfastMaxEmbed = makeEmbed({
  id: "vidfast-max",
  name: "Max (VidFast)",
  rank: 916,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Max")
});
const vidfastIronEmbed = makeEmbed({
  id: "vidfast-iron",
  name: "Iron (VidFast)",
  rank: 915,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Iron")
});
const vidfastCharlieEmbed = makeEmbed({
  id: "vidfast-charlie",
  name: "Charlie (VidFast)",
  rank: 914,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Charlie")
});
const vidfastCobraEmbed = makeEmbed({
  id: "vidfast-cobra",
  name: "Cobra (VidFast)",
  rank: 913,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Cobra")
});
const vidfastViperEmbed = makeEmbed({
  id: "vidfast-viper",
  name: "Viper (VidFast)",
  rank: 912,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Viper")
});
const vidfastRangerEmbed = makeEmbed({
  id: "vidfast-ranger",
  name: "Ranger (VidFast)",
  rank: 911,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Ranger")
});
const vidfastSpecterEmbed = makeEmbed({
  id: "vidfast-specter",
  name: "Specter (VidFast)",
  rank: 910,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Specter")
});
const vidfastEchoEmbed = makeEmbed({
  id: "vidfast-echo",
  name: "Echo (VidFast)",
  rank: 909,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Echo")
});
const vidfastVodkaEmbed = makeEmbed({
  id: "vidfast-vodka",
  name: "Vodka (VidFast)",
  rank: 908,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Vodka")
});
const vidfastPabloEmbed = makeEmbed({
  id: "vidfast-pablo",
  name: "Pablo (VidFast)",
  rank: 907,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Pablo")
});
const vidfastLocoEmbed = makeEmbed({
  id: "vidfast-loco",
  name: "Loco (VidFast)",
  rank: 906,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Loco")
});
const vidfastSambaEmbed = makeEmbed({
  id: "vidfast-samba",
  name: "Samba (VidFast)",
  rank: 905,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Samba")
});
const vidfastBollywoodEmbed = makeEmbed({
  id: "vidfast-bollywood",
  name: "Bollywood (VidFast)",
  rank: 904,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Bollywood")
});
const vidfastKiritoEmbed = makeEmbed({
  id: "vidfast-kirito",
  name: "Kirito (VidFast)",
  rank: 903,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Kirito")
});
const vidfastMeliodasEmbed = makeEmbed({
  id: "vidfast-meliodas",
  name: "Meliodas (VidFast)",
  rank: 902,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Meliodas")
});
const vidfastVefastEmbed = makeEmbed({
  id: "vidfast-vfast",
  name: "Vfast 🔥 (4K)",
  rank: 901,
  flags: [],
  scrape: (ctx) => scrapeVidfastEmbed(ctx, "Vfast")
});
async function getStream$2(ctx, id) {
  var _a, _b;
  try {
    const baseUrl2 = "https://ftmoh345xme.com";
    const headers2 = {
      Origin: "https://friness-cherlormur-i-275.site",
      Referer: "https://google.com/",
      Dnt: "1"
    };
    const url = `${baseUrl2}/play/${id}`;
    const result = await ctx.proxiedFetcher(url, {
      headers: {
        ...headers2
      },
      method: "GET"
    });
    const $ = cheerio.load(result);
    const script = $("script").last().html();
    if (!script) {
      throw new NotFoundError("Failed to extract script data");
    }
    const content = ((_a = script.match(/(\{[^;]+});/)) == null ? void 0 : _a[1]) || ((_b = script.match(/\((\{.*\})\)/)) == null ? void 0 : _b[1]);
    if (!content) {
      throw new NotFoundError("Media not found");
    }
    const data = JSON.parse(content);
    let file = data.file;
    if (!file) {
      throw new NotFoundError("File not found");
    }
    if (file.startsWith("/")) {
      file = baseUrl2 + file;
    }
    const key2 = data.key;
    const headers22 = {
      Origin: "https://friness-cherlormur-i-275.site",
      Referer: "https://google.com/",
      Dnt: "1",
      "X-Csrf-Token": key2
    };
    const PlayListRes = await ctx.proxiedFetcher(file, {
      headers: {
        ...headers22
      },
      method: "GET"
    });
    const playlist = PlayListRes;
    return {
      success: true,
      data: {
        playlist,
        key: key2
      }
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new NotFoundError("Failed to fetch media info");
  }
}
async function getStream$1(ctx, file, key2) {
  const f = file;
  const path = `${f.slice(1)}.txt`;
  try {
    const baseUrl2 = "https://ftmoh345xme.com";
    const headers2 = {
      Origin: "https://friness-cherlormur-i-275.site",
      Referer: "https://google.com/",
      Dnt: "1",
      "X-Csrf-Token": key2
    };
    const url = `${baseUrl2}/playlist/${path}`;
    const result = await ctx.proxiedFetcher(url, {
      headers: {
        ...headers2
      },
      method: "GET"
    });
    return {
      success: true,
      data: {
        link: result
      }
    };
  } catch (error) {
    throw new NotFoundError("Failed to fetch stream data");
  }
}
async function getMovie(ctx, id, lang = "English") {
  var _a, _b;
  try {
    const mediaInfo = await getStream$2(ctx, id);
    if (mediaInfo == null ? void 0 : mediaInfo.success) {
      const playlist = (_a = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _a.playlist;
      if (!playlist || !Array.isArray(playlist)) {
        throw new NotFoundError("Playlist not found or invalid");
      }
      let file = playlist.find((item) => (item == null ? void 0 : item.title) === lang);
      if (!file) {
        file = playlist == null ? void 0 : playlist[0];
      }
      if (!file) {
        throw new NotFoundError("No file found");
      }
      const availableLang = playlist.map((item) => item == null ? void 0 : item.title);
      const key2 = (_b = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _b.key;
      ctx.progress(70);
      const streamUrl = await getStream$1(ctx, file == null ? void 0 : file.file, key2);
      if (streamUrl == null ? void 0 : streamUrl.success) {
        return { success: true, data: streamUrl == null ? void 0 : streamUrl.data, availableLang };
      }
      throw new NotFoundError("No stream url found");
    }
    throw new NotFoundError("No media info found");
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new NotFoundError("Failed to fetch movie data");
  }
}
async function getTV(ctx, id, season, episode, lang) {
  var _a, _b, _c;
  try {
    const mediaInfo = await getStream$2(ctx, id);
    if (!(mediaInfo == null ? void 0 : mediaInfo.success)) {
      throw new NotFoundError("No media info found");
    }
    const playlist = (_a = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _a.playlist;
    const getSeason = playlist.find((item) => (item == null ? void 0 : item.id) === season.toString());
    if (!getSeason) {
      throw new NotFoundError("No season found");
    }
    const getEpisode = getSeason == null ? void 0 : getSeason.folder.find((item) => (item == null ? void 0 : item.episode) === episode.toString());
    if (!getEpisode) {
      throw new NotFoundError("No episode found");
    }
    let file = getEpisode == null ? void 0 : getEpisode.folder.find((item) => (item == null ? void 0 : item.title) === lang);
    if (!file) {
      file = (_b = getEpisode == null ? void 0 : getEpisode.folder) == null ? void 0 : _b[0];
    }
    if (!file) {
      throw new NotFoundError("No file found");
    }
    const availableLang = getEpisode == null ? void 0 : getEpisode.folder.map((item) => {
      return item == null ? void 0 : item.title;
    });
    const filterLang = availableLang.filter((item) => (item == null ? void 0 : item.length) > 0);
    const key2 = (_c = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _c.key;
    ctx.progress(70);
    const streamUrl = await getStream$1(ctx, file == null ? void 0 : file.file, key2);
    if (streamUrl == null ? void 0 : streamUrl.success) {
      return {
        success: true,
        data: streamUrl == null ? void 0 : streamUrl.data,
        availableLang: filterLang
      };
    }
    throw new NotFoundError("No stream url found");
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new NotFoundError("Failed to fetch TV data");
  }
}
async function comboScraper$r(ctx) {
  ({
    title: ctx.media.title,
    releaseYear: ctx.media.releaseYear,
    tmdbId: ctx.media.tmdbId,
    imdbId: ctx.media.imdbId,
    type: ctx.media.type
  });
  if (ctx.media.type === "show") {
    ctx.media.season.number.toString();
    ctx.media.episode.number.toString();
  }
  if (ctx.media.type === "movie") {
    ctx.progress(40);
    const res = await getMovie(ctx, ctx.media.imdbId);
    if (res == null ? void 0 : res.success) {
      ctx.progress(90);
      return {
        embeds: [],
        stream: [
          {
            id: "primary",
            captions: [],
            playlist: res.data.link,
            type: "hls",
            flags: [flags.CORS_ALLOWED]
          }
        ]
      };
    }
    throw new NotFoundError("No providers available");
  }
  if (ctx.media.type === "show") {
    ctx.progress(40);
    const lang = "English";
    const res = await getTV(ctx, ctx.media.imdbId, ctx.media.season.number, ctx.media.episode.number, lang);
    if (res == null ? void 0 : res.success) {
      ctx.progress(90);
      return {
        embeds: [],
        stream: [
          {
            id: "primary",
            captions: [],
            playlist: res.data.link,
            type: "hls",
            flags: [flags.CORS_ALLOWED]
          }
        ]
      };
    }
    throw new NotFoundError("No providers available");
  }
  throw new NotFoundError("No providers available");
}
const EightStreamScraper = makeSourcerer({
  id: "8stream",
  name: "8stream",
  rank: 111,
  flags: [],
  disabled: false,
  scrapeMovie: comboScraper$r,
  scrapeShow: comboScraper$r
});
const baseUrl$h = "https://www3.animeflv.net";
async function searchAnimeFlv(ctx, title) {
  const searchUrl = `${baseUrl$h}/browse?q=${encodeURIComponent(title)}`;
  const html = await ctx.proxiedFetcher(searchUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const $ = load(html);
  const results = $("div.Container ul.ListAnimes li article");
  if (!results.length) throw new NotFoundError("No se encontró el anime en AnimeFLV");
  let animeUrl = "";
  results.each((_, el) => {
    const resultTitle = $(el).find("a h3").text().trim().toLowerCase();
    if (resultTitle === title.trim().toLowerCase()) {
      animeUrl = $(el).find("div.Description a.Button").attr("href") || "";
      return false;
    }
  });
  if (!animeUrl) {
    animeUrl = results.first().find("div.Description a.Button").attr("href") || "";
  }
  if (!animeUrl) throw new NotFoundError("No se encontró el anime en AnimeFLV");
  const fullUrl = animeUrl.startsWith("http") ? animeUrl : `${baseUrl$h}${animeUrl}`;
  return fullUrl;
}
async function getEpisodes(ctx, animeUrl) {
  const html = await ctx.proxiedFetcher(animeUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const $ = load(html);
  let episodes = [];
  $("script").each((_, script) => {
    var _a, _b, _c;
    const data = $(script).html() || "";
    if (data.includes("var anime_info =")) {
      const animeInfo = (_a = data.split("var anime_info = [")[1]) == null ? void 0 : _a.split("];")[0];
      const animeUri = (_b = animeInfo == null ? void 0 : animeInfo.split(",")[2]) == null ? void 0 : _b.replace(/"/g, "").trim();
      const episodesRaw = (_c = data.split("var episodes = [")[1]) == null ? void 0 : _c.split("];")[0];
      if (animeUri && episodesRaw) {
        const arrEpisodes = episodesRaw.split("],[");
        episodes = arrEpisodes.map((arrEp) => {
          const noEpisode = arrEp.replace("[", "").replace("]", "").split(",")[0];
          return {
            number: parseInt(noEpisode, 10),
            url: `${baseUrl$h}/ver/${animeUri}-${noEpisode}`
          };
        });
      } else {
        console.log("[AnimeFLV] No se encontró animeUri o lista de episodios en el script");
      }
    }
  });
  if (episodes.length === 0) {
    console.log("[AnimeFLV] No se encontraron episodios");
  }
  return episodes;
}
async function getEmbeds$1(ctx, episodeUrl) {
  const html = await ctx.proxiedFetcher(episodeUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const $ = load(html);
  const script = $('script:contains("var videos =")').html();
  if (!script) return {};
  const match = script.match(/var videos = (\{[\s\S]*?\});/);
  if (!match) return {};
  let videos = {};
  try {
    videos = JSON.parse(match[1]);
  } catch {
    return {};
  }
  let streamwishJapanese;
  if (videos.SUB) {
    const sw = videos.SUB.find((s) => {
      var _a;
      return ((_a = s.title) == null ? void 0 : _a.toLowerCase()) === "sw";
    });
    if (sw && (sw.url || sw.code)) {
      streamwishJapanese = sw.url || sw.code;
      if (streamwishJapanese && streamwishJapanese.startsWith("/e/")) {
        streamwishJapanese = `https://streamwish.to${streamwishJapanese}`;
      }
    }
  }
  let streamtapeLatino;
  if (videos.LAT) {
    const stape = videos.LAT.find(
      (s) => {
        var _a, _b;
        return ((_a = s.title) == null ? void 0 : _a.toLowerCase()) === "stape" || ((_b = s.title) == null ? void 0 : _b.toLowerCase()) === "streamtape";
      }
    );
    if (stape && (stape.url || stape.code)) {
      streamtapeLatino = stape.url || stape.code;
      if (streamtapeLatino && streamtapeLatino.startsWith("/e/")) {
        streamtapeLatino = `https://streamtape.com${streamtapeLatino}`;
      }
    }
  }
  return {
    "streamwish-japanese": streamwishJapanese,
    "streamtape-latino": streamtapeLatino
  };
}
async function comboScraper$q(ctx) {
  var _a;
  const title = ctx.media.title;
  if (!title) throw new NotFoundError("Falta el título");
  console.log(`[AnimeFLV] Iniciando scraping para: ${title}`);
  const animeUrl = await searchAnimeFlv(ctx, title);
  let episodeUrl = animeUrl;
  if (ctx.media.type === "show") {
    const episode = (_a = ctx.media.episode) == null ? void 0 : _a.number;
    if (!episode) throw new NotFoundError("Faltan datos de episodio");
    const episodes = await getEpisodes(ctx, animeUrl);
    const ep = episodes.find((e) => e.number === episode);
    if (!ep) throw new NotFoundError(`No se encontró el episodio ${episode}`);
    episodeUrl = ep.url;
  } else if (ctx.media.type === "movie") {
    const html = await ctx.proxiedFetcher(animeUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const $ = load(html);
    let animeUri = null;
    $("script").each((_, script) => {
      var _a2, _b;
      const data = $(script).html() || "";
      if (data.includes("var anime_info =")) {
        const animeInfo = (_a2 = data.split("var anime_info = [")[1]) == null ? void 0 : _a2.split("];")[0];
        animeUri = ((_b = animeInfo == null ? void 0 : animeInfo.split(",")[2]) == null ? void 0 : _b.replace(/"/g, "").trim()) || null;
      }
    });
    if (!animeUri) throw new NotFoundError("No se pudo obtener el animeUri para la película");
    episodeUrl = `${baseUrl$h}/ver/${animeUri}-1`;
  }
  const embedsObj = await getEmbeds$1(ctx, episodeUrl);
  const filteredEmbeds = Object.entries(embedsObj).filter(([, url]) => typeof url === "string" && !!url).map(([embedId, url]) => ({ embedId, url }));
  if (filteredEmbeds.length === 0) {
    throw new NotFoundError("No se encontraron streams válidos");
  }
  return { embeds: filteredEmbeds };
}
const animeflvScraper = makeSourcerer({
  id: "animeflv",
  name: "AnimeFLV",
  rank: 90,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeShow: comboScraper$q,
  scrapeMovie: comboScraper$q
});
const cache = /* @__PURE__ */ new Map();
function normalizeTitle$4(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function matchesType(mediaType, anilist) {
  if (mediaType === "show") {
    return ["TV", "TV_SHORT", "OVA", "ONA", "SPECIAL"].includes(anilist.format);
  }
  return anilist.format === "MOVIE";
}
const anilistQuery = `
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 20) {
    media(search: $search, type: $type, sort: POPULARITY_DESC) {
      id
      type
      format
      seasonYear
      title {
        romaji
        english
        native
      }
    }
  }
}
`;
async function getAnilistIdFromMedia(ctx, media) {
  var _a, _b, _c;
  const key2 = `${media.type}:${media.title}:${media.releaseYear}`;
  const cached = cache.get(key2);
  if (cached) return cached;
  const res = await ctx.proxiedFetcher("", {
    baseUrl: "https://graphql.anilist.co",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: anilistQuery,
      variables: {
        search: media.title,
        type: "ANIME"
      }
    })
  });
  const items = ((_b = (_a = res.data) == null ? void 0 : _a.Page) == null ? void 0 : _b.media) ?? [];
  if (!items.length) {
    throw new Error("AniList id not found");
  }
  const targetTitle = normalizeTitle$4(media.title);
  const scored = items.filter((it) => matchesType(media.type, it)).map((it) => {
    const titles = [it.title.romaji];
    if (it.title.english) titles.push(it.title.english);
    if (it.title.native) titles.push(it.title.native);
    const normTitles = titles.map(normalizeTitle$4).filter(Boolean);
    const exact = normTitles.includes(targetTitle);
    const partial = normTitles.some((t) => t.includes(targetTitle) || targetTitle.includes(t));
    const yearDelta = it.seasonYear ? Math.abs(it.seasonYear - media.releaseYear) : 5;
    let score = 0;
    if (exact) score += 100;
    else if (partial) score += 50;
    score += Math.max(0, 20 - yearDelta * 4);
    return { it, score };
  }).sort((a, b) => b.score - a.score);
  const winner = ((_c = scored[0]) == null ? void 0 : _c.it) ?? items[0];
  const anilistId = winner == null ? void 0 : winner.id;
  if (!anilistId) throw new Error("AniList id not found");
  cache.set(key2, anilistId);
  return anilistId;
}
const anilistTitlesQuery = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    title {
      romaji
      english
      native
    }
    synonyms
  }
}
`;
async function getAnilistEnglishTitle(ctx, media) {
  const id = await getAnilistIdFromMedia(ctx, media);
  const res = await ctx.proxiedFetcher("", {
    baseUrl: "https://graphql.anilist.co",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: anilistTitlesQuery,
      variables: {
        id
      }
    })
  });
  const englishTitle = res.data.Media.title.english;
  return englishTitle ? englishTitle.toLowerCase() : null;
}
async function comboScraper$p(ctx) {
  const anilistId = await getAnilistIdFromMedia(ctx, ctx.media);
  const query = {
    type: ctx.media.type,
    title: ctx.media.title,
    tmdbId: ctx.media.tmdbId,
    imdbId: ctx.media.imdbId,
    anilistId,
    ...ctx.media.type === "show" && {
      season: ctx.media.season.number,
      episode: ctx.media.episode.number
    },
    ...ctx.media.type === "movie" && { episode: 1 },
    releaseYear: ctx.media.releaseYear
  };
  return {
    embeds: [
      {
        embedId: "animetsu-pahe",
        url: JSON.stringify(query)
      },
      {
        embedId: "animetsu-zoro",
        url: JSON.stringify(query)
      },
      {
        embedId: "animetsu-zaza",
        url: JSON.stringify(query)
      },
      {
        embedId: "animetsu-meg",
        url: JSON.stringify(query)
      },
      {
        embedId: "animetsu-bato",
        url: JSON.stringify(query)
      }
    ]
  };
}
const animetsuScraper = makeSourcerer({
  id: "animetsu",
  name: "Animetsu",
  rank: 112,
  flags: [],
  scrapeShow: comboScraper$p
});
const baseUrl$g = "https://cinehdplus.zone";
async function comboScraper$o(ctx) {
  const searchUrl = `${baseUrl$g}/series/?story=${ctx.media.tmdbId}&do=search&subaction=search`;
  const searchPage = await ctx.proxiedFetcher(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Referer: baseUrl$g
    }
  });
  const $search = load(searchPage);
  const seriesUrl = $search(".card__title a[href]:first").attr("href");
  if (!seriesUrl) {
    throw new NotFoundError("Series not found in search results");
  }
  ctx.progress(30);
  const seriesPageUrl = new URL(seriesUrl, baseUrl$g);
  const seriesPage = await ctx.proxiedFetcher(seriesPageUrl.href, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Referer: baseUrl$g
    }
  });
  const $ = load(seriesPage);
  const episodeSelector = `[data-num="${ctx.media.season.number}x${ctx.media.episode.number}"]`;
  const mirrorUrls = $(episodeSelector).siblings(".mirrors").children("[data-link]").map((_, el) => $(el).attr("data-link")).get().filter(Boolean).filter((link) => !link.match(/cinehdplus/)).map((link) => {
    const url = link.startsWith("http") ? link : `https://${link}`;
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }).filter((url) => url !== null && url.hostname !== "cinehdplus.zone");
  if (!mirrorUrls.length) {
    throw new NotFoundError("No streaming links found for this episode");
  }
  ctx.progress(70);
  const embeds = mirrorUrls.map((url) => {
    let embedId;
    if (url.hostname.includes("supervideo")) {
      embedId = "supervideo";
    } else if (url.hostname.includes("dropload")) {
      embedId = "dropload";
    } else {
      return null;
    }
    return {
      embedId,
      url: url.href
    };
  }).filter((embed2) => embed2 !== null);
  ctx.progress(90);
  return {
    embeds
  };
}
const cinehdplusScraper = makeSourcerer({
  id: "cinehdplus",
  name: "CineHDPlus (Latino)",
  rank: 904,
  disabled: false,
  flags: [],
  scrapeShow: comboScraper$o
});
const baseUrl$f = "https://cine.su";
const verifyHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": `${baseUrl$f}/en/watch`,
  "Origin": baseUrl$f
};
async function comboScraper$n(ctx) {
  let url = "";
  if (ctx.media.type === "show") {
    url = `${baseUrl$f}/v1/stream/master/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}.m3u8`;
  } else {
    url = `${baseUrl$f}/v1/stream/master/movie/${ctx.media.tmdbId}.m3u8`;
  }
  const res = await ctx.proxiedFetcher.full(url, {
    method: "GET",
    headers: verifyHeaders
  });
  if (res.statusCode !== 200) throw new NotFoundError("Stream not found");
  if (!res.body || !res.body.toString().trim().startsWith("#EXTM3U")) {
    throw new NotFoundError("Invalid playlist");
  }
  ctx.progress(90);
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: url,
        flags: [],
        headers: {
          Referer: `${baseUrl$f}/en/watch`,
          Origin: baseUrl$f
        },
        captions: []
      }
    ],
    embeds: []
  };
}
const cinesuScraper = makeSourcerer({
  id: "cinesu",
  name: "CineSu",
  rank: 980,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$n,
  scrapeShow: comboScraper$n
});
const gateUrl = "https://gate.flicky.host";
const referer = "https://meowtv.ru";
const ua$1 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36";
const headers$8 = {
  "User-Agent": ua$1,
  "Accept": "application/json",
  "Referer": referer,
  "Origin": referer
};
async function comboScraper$m(ctx) {
  var _a;
  const type = ctx.media.type === "show" ? "tv" : "movie";
  let url = `${gateUrl}/v17/${type}/${ctx.media.tmdbId}`;
  if (ctx.media.type === "show") {
    url += `/${ctx.media.season.number}/${ctx.media.episode.number}`;
  }
  const data = await ctx.proxiedFetcher(url, { headers: headers$8 });
  const streamUrl = (_a = data == null ? void 0 : data.stream) == null ? void 0 : _a.url;
  if (!streamUrl || !streamUrl.startsWith("http")) {
    throw new NotFoundError("No stream url found");
  }
  ctx.progress(90);
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: streamUrl,
        flags: [],
        headers: {
          "User-Agent": ua$1,
          "Referer": referer,
          "Origin": referer
        },
        captions: []
      }
    ],
    embeds: []
  };
}
const meowtvScraper = makeSourcerer({
  id: "meowtv",
  name: "MeowTV",
  rank: 175,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$m,
  scrapeShow: comboScraper$m
});
const baseUrl$e = "https://streams.icefy.top";
const headers$7 = {
  "Referer": `${baseUrl$e}/`,
  "Origin": baseUrl$e
};
async function comboScraper$l(ctx) {
  let url = "";
  if (ctx.media.type === "show") {
    url = `${baseUrl$e}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  } else {
    url = `${baseUrl$e}/movie/${ctx.media.tmdbId}`;
  }
  const data = await ctx.proxiedFetcher(url, {
    headers: {
      "Referer": `${baseUrl$e}/`
    }
  });
  if (!(data == null ? void 0 : data.stream)) {
    throw new NotFoundError("No stream found");
  }
  ctx.progress(90);
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: data.stream,
        flags: [],
        headers: headers$7,
        captions: []
      }
    ],
    embeds: []
  };
}
const icefyScraper = makeSourcerer({
  id: "icefy",
  name: "Icefy",
  rank: 965,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$l,
  scrapeShow: comboScraper$l
});
const baseUrl$d = "https://vixsrc.to";
const headers$6 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": `${baseUrl$d}/`,
  "Origin": baseUrl$d
};
async function comboScraper$k(ctx) {
  var _a, _b, _c, _d;
  let apiUrl = "";
  if (ctx.media.type === "show") {
    apiUrl = `${baseUrl$d}/api/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  } else {
    apiUrl = `${baseUrl$d}/api/movie/${ctx.media.tmdbId}`;
  }
  const apiData = await ctx.proxiedFetcher(apiUrl, { headers: headers$6 });
  if (!(apiData == null ? void 0 : apiData.src)) throw new NotFoundError("No API source found");
  const embedUrl = apiData.src.startsWith("http") ? apiData.src : `${baseUrl$d}${apiData.src}`;
  const embedHtml = await ctx.proxiedFetcher(embedUrl, { headers: headers$6 });
  if (!embedHtml) throw new NotFoundError("Failed to fetch embed page");
  const token = (_a = embedHtml.match(/token["']\s*:\s*["']([^"']+)/)) == null ? void 0 : _a[1];
  const expires = (_b = embedHtml.match(/expires["']\s*:\s*["']([^"']+)/)) == null ? void 0 : _b[1];
  const playlist = (_c = embedHtml.match(/url\s*:\s*["']([^"']+)/)) == null ? void 0 : _c[1];
  const lang = ((_d = embedHtml.match(/lang(?:uage)?["']\s*:\s*["']([a-z]{2,5})/i)) == null ? void 0 : _d[1]) ?? "en";
  if (!token || !expires || !playlist) throw new NotFoundError("Invalid token data");
  const sep = playlist.includes("?") ? "&" : "?";
  const masterUrl = `${playlist}${sep}token=${token}&expires=${expires}&h=1&lang=${lang}`;
  ctx.progress(90);
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: masterUrl,
        flags: [],
        headers: headers$6,
        captions: []
      }
    ],
    embeds: []
  };
}
const vixsrcScraper = makeSourcerer({
  id: "vixsrc",
  name: "VixSrc",
  rank: 160,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$k,
  scrapeShow: comboScraper$k
});
const playerUrl = "https://player.vidzee.wtf";
const coreUrl = "https://core.vidzee.wtf";
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36";
const headers$5 = {
  "User-Agent": ua,
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": playerUrl,
  "Origin": playerUrl
};
const hlsHeaders = {
  "User-Agent": ua,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": playerUrl,
  "Origin": playerUrl
};
function base64ToBytes(s) {
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
function bufferToString(buf) {
  return new TextDecoder().decode(buf);
}
function stringToBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}
async function deriveKey(e) {
  if (!e) return "";
  const t = base64ToBytes(e);
  if (t.length <= 28) return "";
  const n = t.slice(0, 12);
  const r = t.slice(12, 28);
  const a = t.slice(28);
  const i = new Uint8Array(a.length + r.length);
  i.set(a, 0);
  i.set(r, a.length);
  const l = await crypto.subtle.digest("SHA-256", stringToBuffer("4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c"));
  const o = await crypto.subtle.importKey("raw", l, { name: "AES-GCM" }, false, ["decrypt"]);
  const c = await crypto.subtle.decrypt({ name: "AES-GCM", iv: n, tagLength: 128 }, o, i);
  return bufferToString(c);
}
async function decrypt$1(encryptedData, decryptionKey) {
  if (!encryptedData || !decryptionKey) return "";
  const decoded = atob(encryptedData);
  const [ivBase64, cipherBase64] = decoded.split(":");
  if (!ivBase64 || !cipherBase64) return "";
  const iv2 = base64ToBytes(ivBase64);
  const cipherBytes = base64ToBytes(cipherBase64);
  const encoded = new TextEncoder().encode(decryptionKey);
  const keyBytes = new Uint8Array(32);
  keyBytes.set(encoded.slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv2 }, cryptoKey, cipherBytes);
  return bufferToString(decrypted);
}
async function comboScraper$j(ctx) {
  const type = ctx.media.type === "show" ? "tv" : "movie";
  let season = 1;
  let episode = 1;
  if (ctx.media.type === "show") {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }
  const apiKeyText = await ctx.proxiedFetcher(`${coreUrl}/api-key`, { headers: headers$5 });
  if (!apiKeyText) throw new NotFoundError("Failed to fetch api key");
  const decKey = await deriveKey(apiKeyText);
  if (!decKey) throw new NotFoundError("Failed to derive decryption key");
  for (let sr = 0; sr < 14; sr++) {
    let url = `${playerUrl}/api/server?id=${ctx.media.tmdbId}&sr=${sr}`;
    if (type === "tv") {
      url += `&ss=${season}&ep=${episode}`;
    }
    try {
      const data = await ctx.proxiedFetcher(url, { headers: headers$5 });
      if (!data || data.error || !Array.isArray(data.url) || !data.url.length) continue;
      for (const entry of data.url) {
        if (!entry.link) continue;
        const decrypted = await decrypt$1(entry.link, decKey);
        if (decrypted && decrypted.startsWith("http")) {
          ctx.progress(90);
          return {
            stream: [
              {
                id: "primary",
                type: "hls",
                playlist: decrypted,
                flags: [],
                headers: hlsHeaders,
                captions: []
              }
            ],
            embeds: []
          };
        }
      }
    } catch {
      continue;
    }
  }
  throw new NotFoundError("No valid stream found");
}
const vidzeeScraper = makeSourcerer({
  id: "vidzee",
  name: "VidZee",
  rank: 155,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$j,
  scrapeShow: comboScraper$j
});
const servers$1 = [
  { name: "Yoru", url: "https://api.videasy.net/cdn/sources-with-title" },
  { name: "Neon", url: "https://api.videasy.net/mb-flix/sources-with-title" },
  { name: "Breach", url: "https://api.videasy.net/m4uhd/sources-with-title" },
  { name: "Cypher", url: "https://api.videasy.net/moviebox/sources-with-title" },
  { name: "Sage", url: "https://api.videasy.net/1movies/sources-with-title" },
  { name: "Vyse", url: "https://api.videasy.net/hdmovie/sources-with-title", filterQuality: "English" },
  { name: "Fade", url: "https://api.videasy.net/hdmovie/sources-with-title", filterQuality: "Hindi" },
  { name: "Killjoy", url: "https://api.videasy.net/meine/sources-with-title", extraParams: { language: "german" } },
  { name: "Omen", url: "https://api.videasy.net/lamovie/sources-with-title" },
  { name: "Raze", url: "https://api.videasy.net/superflix/sources-with-title" }
];
async function comboScraper$i(ctx) {
  let season = 1;
  let episode = 1;
  if (ctx.media.type === "show") {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }
  const tmdbId = ctx.media.tmdbId;
  const embeds = servers$1.map((server) => {
    const queryObj = {
      title: "",
      mediaType: ctx.media.type === "show" ? "tv" : "movie",
      tmdbId: String(tmdbId),
      imdbId: "",
      episodeId: String(episode),
      seasonId: String(season)
    };
    if (server.extraParams) {
      Object.assign(queryObj, server.extraParams);
    }
    const params = new URLSearchParams(queryObj);
    const url = `${server.url}?${params}`;
    return {
      embedId: `videasy-${server.name.toLowerCase()}`,
      url
    };
  });
  ctx.progress(90);
  return {
    embeds
  };
}
const videasyScraper = makeSourcerer({
  id: "videasy",
  name: "Videasy 🔥",
  rank: 950,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$i,
  scrapeShow: comboScraper$i
});
const baseUrl$c = "https://vidfast.pro";
const servers = [
  // 🔥 4K-capable server — stays on top
  { name: "Vfast", serverParam: "vfast" },
  { name: "Alpha", serverParam: "Alpha" },
  { name: "Beta", serverParam: "Beta" },
  { name: "Oscar", serverParam: "Oscar" },
  { name: "Max", serverParam: "Max" },
  { name: "Iron", serverParam: "Iron" },
  { name: "Charlie", serverParam: "Charlie" },
  { name: "Cobra", serverParam: "Cobra" },
  { name: "Viper", serverParam: "Viper" },
  { name: "Ranger", serverParam: "Ranger" },
  { name: "Specter", serverParam: "Specter" },
  { name: "Echo", serverParam: "Echo" },
  { name: "Vodka", serverParam: "Vodka" },
  { name: "Pablo", serverParam: "Pablo" },
  { name: "Loco", serverParam: "Loco" },
  { name: "Samba", serverParam: "Samba" },
  { name: "Bollywood", serverParam: "Bollywood" },
  { name: "Kirito", serverParam: "Kirito" },
  { name: "Meliodas", serverParam: "Meliodas" }
];
async function comboScraper$h(ctx) {
  const { tmdbId } = ctx.media;
  const embeds = servers.map((server) => {
    let embedUrl;
    if (ctx.media.type === "show") {
      embedUrl = `${baseUrl$c}/tv/${tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}#${server.serverParam}`;
    } else {
      embedUrl = `${baseUrl$c}/movie/${tmdbId}#${server.serverParam}`;
    }
    return {
      embedId: `vidfast-${server.name.toLowerCase()}`,
      url: embedUrl
    };
  });
  ctx.progress(90);
  return { embeds };
}
const vidfastScraper = makeSourcerer({
  id: "vidfast",
  name: "VidFast 🔥",
  rank: 920,
  // Enabled: VidFast player encryption flow is fully implemented and resolved 
  // via the enc-dec.app API decryption endpoints.
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$h,
  scrapeShow: comboScraper$h
});
const decApi = "https://enc-dec.app/api/dec-videasy";
const headers$4 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, */*; q=0.01",
  "Referer": "https://www.vidking.net/",
  "Origin": "https://www.vidking.net"
};
const movieApi = "https://api.videasy.net/mb-flix/sources-with-title";
const tvApi = "https://api.videasy.net/downloader2/sources-with-title";
async function decrypt(blob, tmdbId, ctx) {
  var _a;
  if (!blob || blob.length < 10) return null;
  try {
    const res = await ctx.proxiedFetcher(decApi, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: blob, id: tmdbId })
    });
    if ((res == null ? void 0 : res.status) !== 200 || !((_a = res == null ? void 0 : res.result) == null ? void 0 : _a.sources)) return null;
    return res.result.sources.filter((s) => s == null ? void 0 : s.url).map((s) => s.url);
  } catch {
    return null;
  }
}
async function comboScraper$g(ctx) {
  const isMovie = ctx.media.type === "movie";
  const mediaType = isMovie ? "movie" : "tv";
  const apiUrl = isMovie ? movieApi : tvApi;
  let season = 1;
  let episode = 1;
  if (ctx.media.type === "show") {
    season = ctx.media.season.number;
    episode = ctx.media.episode.number;
  }
  const params = new URLSearchParams({
    title: ctx.media.title,
    mediaType,
    year: String(ctx.media.releaseYear),
    episodeId: String(episode),
    seasonId: String(season),
    tmdbId: ctx.media.tmdbId,
    imdbId: ctx.media.imdbId || "",
    _t: String(Date.now())
  });
  const url = `${apiUrl}?${params}`;
  const blob = await ctx.proxiedFetcher(url, { headers: headers$4 });
  if (!blob || blob.length < 10) throw new NotFoundError("No stream blob returned");
  const urls = await decrypt(blob, ctx.media.tmdbId, ctx);
  if (!urls || !urls.length) throw new NotFoundError("Failed to decrypt stream");
  ctx.progress(90);
  return {
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: urls[0],
        flags: [],
        headers: headers$4,
        captions: []
      }
    ],
    embeds: []
  };
}
const vidkingScraper = makeSourcerer({
  id: "vidking",
  name: "VidKing",
  rank: 145,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$g,
  scrapeShow: comboScraper$g
});
const L1_KEY = "Sn00pD0g#L1_X0R_M4st3rK3y!2026sex";
const L1_SALT = "xK9!mR2@pL5#nQ8sex";
const L3_KEY = "Sn00pD0g#L3_AES_S3cur3K3y@2026$sex";
const L4_KEY = "Sn00pD0g#L4_HMAC_F1n4lW4ll#2026!sex";
const subSources = [
  { name: "onion", movieApi: "https://api.tulnex.com/onion/movie/${id}", tvApi: "https://api.tulnex.com/onion/tv/${id}/${s}/${e}" },
  { name: "vidzee", movieApi: "https://api.tulnex.com/vidzee/movie/${id}?server=0", tvApi: "https://api.tulnex.com/vidzee/tv/${id}/${s}/${e}?server=0" },
  { name: "icefy", movieApi: "https://api.tulnex.com/icefy/movie/${id}", tvApi: "https://api.tulnex.com/icefy/tv/${id}/${s}/${e}" },
  { name: "tik", movieApi: "https://api.tulnex.com/tik/movie/${id}", tvApi: "https://api.tulnex.com/tik/tv/${id}/${s}/${e}" },
  { name: "vaplayer", movieApi: "https://api.tulnex.com/vaplayer/movie/${id}", tvApi: "https://api.tulnex.com/vaplayer/tv/${id}/${s}/${e}" },
  { name: "vidfast-alpha", movieApi: "https://api.tulnex.com/vidfast/movie/Alpha/${id}", tvApi: "https://api.tulnex.com/vidfast/tv/Alpha/${id}/${s}/${e}" },
  { name: "uniquestream", movieApi: "https://api.tulnex.com/uniquestream/movie/${id}", tvApi: "https://api.tulnex.com/uniquestream/tv/${id}/${s}/${e}" },
  { name: "vidfast-mega", movieApi: "https://api.tulnex.com/vidfast/movie/Mega/${id}", tvApi: "https://api.tulnex.com/vidfast/tv/Mega/${id}/${s}/${e}" },
  { name: "vidfast-vrapid", movieApi: "https://api.tulnex.com/vidfast/movie/VRapid/${id}", tvApi: "https://api.tulnex.com/vidfast/tv/VRapid/${id}/${s}/${e}" },
  { name: "allmovies", movieApi: "https://api.tulnex.com/provider/allmovies/movie/${id}?lang=english", tvApi: "https://api.tulnex.com/provider/allmovies/tv/${id}/${s}/${e}?lang=english" },
  { name: "vidlink", movieApi: "https://api.tulnex.com/provider/vidlink/movie/${id}", tvApi: "https://api.tulnex.com/provider/vidlink/tv/${id}/${s}/${e}" },
  { name: "vidfast-vedge", movieApi: "https://api.tulnex.com/vidfast/movie/vedge/${id}", tvApi: "https://api.tulnex.com/vidfast/tv/vedge/${id}/${s}/${e}" },
  { name: "vidfast-vfast", movieApi: "https://api.videasy.net/vidfast/movie/vfast/${id}", tvApi: "https://api.videasy.net/vidfast/tv/vfast/${id}/${s}/${e}" },
  { name: "moviebox", movieApi: "https://api.tulnex.com/moviebox/movie/${id}", tvApi: "https://api.tulnex.com/moviebox/tv/${id}/${s}/${e}" }
];
function base64ToBuffer(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function strToBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}
function bufferToStr(buf) {
  return new TextDecoder().decode(buf);
}
function hexToUint8(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}
async function pbkdf2(pass, salt, iterations, keyLen, hash) {
  const keyMat = await crypto.subtle.importKey("raw", strToBuffer(pass), { name: "PBKDF2" }, false, ["deriveKey"]);
  const derived = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: strToBuffer(salt), iterations, hash },
    keyMat,
    { name: "AES-GCM", length: keyLen * 8 },
    true,
    ["encrypt", "decrypt"]
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", derived));
}
function xorDecrypt(hexStr, keyBytes) {
  const src = hexToUint8(hexStr);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = src[i] ^ keyBytes[i % 32];
  }
  return bufferToStr(out.buffer);
}
function binaryDecode(encoded) {
  return atob(encoded).split(" ").map((s) => String.fromCharCode(parseInt(s, 2))).join("");
}
async function decodeL3(data) {
  const parts = data.split(".");
  if (parts.length !== 3) throw new Error("L3 invalid");
  const [ivB64, saltB64, ctB64] = parts;
  const salt = atob(saltB64);
  const keyBytes = await pbkdf2(L3_KEY, salt, 1e5, 32, "SHA-512");
  const aesKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(base64ToBuffer(ivB64)) },
    aesKey,
    base64ToBuffer(ctB64)
  );
  return bufferToStr(decrypted);
}
async function decodeL4(data) {
  const sep = data.indexOf("|");
  if (sep === -1) throw new Error("L4 no separator");
  const receivedHmac = data.slice(0, sep);
  const payload = data.slice(sep + 1);
  const payloadStr = bufferToStr(base64ToBuffer(payload));
  const hmacKey = await crypto.subtle.importKey("raw", strToBuffer(L4_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(payloadStr));
  if (receivedHmac !== bufferToHex(sig)) throw new Error("L4 HMAC mismatch");
  return payloadStr;
}
async function decryptPayload(payload) {
  const xorKey = await pbkdf2(L1_KEY, L1_SALT, 5e4, 32, "SHA-256");
  const l4out = await decodeL4(payload);
  const l3out = await decodeL3(l4out);
  const l2out = binaryDecode(l3out);
  return JSON.parse(xorDecrypt(l2out, xorKey));
}
function extractUrl(data) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  if (!data) return null;
  const wrap = (url, headers22 = null) => {
    if (!url || typeof url !== "string" || !url.includes("http")) return null;
    return { url, headers: headers22 };
  };
  if (typeof data === "string" && data.includes("http")) return wrap(data);
  const headers2 = data.headers || null;
  if (data.url && typeof data.url === "string" && data.url.includes("http")) return wrap(data.url, headers2);
  if (data.stream && typeof data.stream === "string" && data.stream.includes("http")) return wrap(data.stream, headers2);
  if (data.playlist && typeof data.playlist === "string" && data.playlist.includes("http")) return wrap(data.playlist, headers2);
  if (data.streamUrl && typeof data.streamUrl === "string" && data.streamUrl.includes("http")) return wrap(data.streamUrl, headers2);
  if (data.stream_url && typeof data.stream_url === "string" && data.stream_url.includes("http")) return wrap(data.stream_url, headers2);
  if (data.streaming_url && typeof data.streaming_url === "string" && data.streaming_url.includes("http")) return wrap(data.streaming_url, headers2);
  if (data.video_url && typeof data.video_url === "string" && data.video_url.includes("http")) return wrap(data.video_url, headers2);
  if (data.m3u8 && typeof data.m3u8 === "string" && data.m3u8.includes("http")) return wrap(data.m3u8, headers2);
  if ((_b = (_a = data.sources) == null ? void 0 : _a.primary) == null ? void 0 : _b.url) return wrap(data.sources.primary.url, data.sources.primary.headers || headers2);
  if (data.sources && Array.isArray(data.sources) && data.sources.length > 0) {
    const sorted = data.sources.filter((s) => s.url && s.url.includes("http")).sort((a, b) => {
      const qa = parseInt((a.quality || "").replace("p", "") || "0", 10);
      const qb = parseInt((b.quality || "").replace("p", "") || "0", 10);
      return qb - qa;
    });
    if (sorted.length > 0) return wrap(sorted[0].url, sorted[0].headers || headers2);
  }
  if (data.languages && Array.isArray(data.languages)) {
    const orig = data.languages.find((l) => {
      var _a2;
      return l.original === true && ((_a2 = l.sources) == null ? void 0 : _a2.length) > 0;
    });
    if (orig) {
      const sorted = [...orig.sources].sort((a, b) => {
        return parseInt((b.quality || "").replace("p", "") || "0", 10) - parseInt((a.quality || "").replace("p", "") || "0", 10);
      });
      return wrap(sorted[0].url || sorted[0].file, sorted[0].headers || orig.headers || headers2);
    }
  }
  if (data.links && Array.isArray(data.links) && data.links.length > 0) {
    const link = data.links.find((l) => l.url && l.url.includes("http"));
    if (link) return wrap(link.url, headers2);
  }
  if ((_e = (_d = (_c = data.data) == null ? void 0 : _c.data) == null ? void 0 : _d.stream) == null ? void 0 : _e.playlist) return wrap(data.data.data.stream.playlist, headers2);
  if ((_g = (_f = data.data) == null ? void 0 : _f.stream) == null ? void 0 : _g.playlist) return wrap(data.data.stream.playlist, headers2);
  if (((_h = data.data) == null ? void 0 : _h.url) && typeof data.data.url === "string" && data.data.url.includes("http")) return wrap(data.data.url, data.data.headers || headers2);
  if (((_i = data.data) == null ? void 0 : _i.sources) && Array.isArray(data.data.sources)) {
    const src = data.data.sources.find((s) => s.url && s.url.includes("http"));
    if (src) return wrap(src.url, src.headers || headers2);
  }
  if (data.streams && Array.isArray(data.streams)) {
    const src = data.streams.find((s) => (s.url || s.link) && (s.url || s.link).includes("http"));
    if (src) return wrap(src.url || src.link, src.headers || headers2);
  }
  return null;
}
async function comboScraper$f(ctx) {
  const isMovie = ctx.media.type === "movie";
  const id = ctx.media.tmdbId;
  let s = "1";
  let e = "1";
  if (ctx.media.type === "show") {
    s = String(ctx.media.season.number);
    e = String(ctx.media.episode.number);
  }
  for (const src of subSources) {
    const url = isMovie ? src.movieApi.replace("${id}", id) : src.tvApi.replace("${id}", id).replace("${s}", s).replace("${e}", e);
    try {
      const res = await ctx.proxiedFetcher(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json, */*"
        }
      });
      if (!res) continue;
      let decryptedData = res;
      if ((res == null ? void 0 : res.v) === 4 && (res == null ? void 0 : res.payload)) {
        decryptedData = await decryptPayload(res.payload);
      }
      const extracted = extractUrl(decryptedData);
      if (extracted == null ? void 0 : extracted.url) {
        ctx.progress(90);
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: extracted.url,
              flags: [],
              headers: extracted.headers || {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
              },
              captions: []
            }
          ],
          embeds: []
        };
      }
    } catch {
      continue;
    }
  }
  throw new NotFoundError("No stream found from any sub-source");
}
const cinezoScraper = makeSourcerer({
  id: "cinezo",
  name: "Cinezo",
  rank: 940,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$f,
  scrapeShow: comboScraper$f
});
const baseUrl$b = "https://api.coitus.ca";
async function comboScraper$e(ctx) {
  const apiUrl = ctx.media.type === "movie" ? `${baseUrl$b}/movie/${ctx.media.tmdbId}` : `${baseUrl$b}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  const apiRes = await ctx.proxiedFetcher(apiUrl);
  if (!apiRes.videoSource) throw new NotFoundError("No watchable item found");
  let processedUrl = apiRes.videoSource;
  let streamHeaders = {};
  if (processedUrl.includes("orbitproxy")) {
    try {
      const urlParts = processedUrl.split(/orbitproxy\.[^/]+\//);
      if (urlParts.length >= 2) {
        const encryptedPart = urlParts[1].split(".m3u8")[0];
        try {
          const decodedData = Buffer.from(encryptedPart, "base64").toString("utf-8");
          const jsonData = JSON.parse(decodedData);
          const originalUrl = jsonData.u;
          const referer2 = jsonData.r || "";
          streamHeaders = { referer: referer2 };
          processedUrl = createM3U8ProxyUrl(originalUrl, ctx.features, streamHeaders);
        } catch (jsonError) {
          console.error("Error decoding/parsing orbitproxy data:", jsonError);
        }
      }
    } catch (error) {
      console.error("Error processing orbitproxy URL:", error);
    }
  }
  console.log(apiRes);
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        captions: [],
        playlist: processedUrl,
        type: "hls",
        headers: streamHeaders,
        flags: [flags.CORS_ALLOWED]
      }
    ]
  };
}
const coitusScraper = makeSourcerer({
  id: "coitus",
  name: "Autoembed+",
  rank: 91,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$e,
  scrapeShow: comboScraper$e
});
const baseUrl$a = "https://www.cuevana3.eu";
function normalizeTitle$3(title) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
async function getStreamUrl(ctx, embedUrl) {
  try {
    const html = await ctx.proxiedFetcher(embedUrl);
    const match = html.match(/var url = '([^']+)'/);
    if (match) {
      return match[1];
    }
  } catch {
  }
  return null;
}
function validateStream(url) {
  return url.startsWith("https://") && (url.includes("streamwish") || url.includes("filemoon") || url.includes("vidhide"));
}
async function extractVideos(ctx, videos) {
  const videoList = [];
  for (const [lang, videoArray] of Object.entries(videos)) {
    if (!videoArray) continue;
    for (const video of videoArray) {
      if (!video.result) continue;
      const realUrl = await getStreamUrl(ctx, video.result);
      if (!realUrl || !validateStream(realUrl)) continue;
      let embedId = "";
      if (realUrl.includes("filemoon")) embedId = "filemoon";
      else if (realUrl.includes("streamwish")) {
        if (lang === "latino") embedId = "streamwish-latino";
        else if (lang === "spanish") embedId = "streamwish-spanish";
        else if (lang === "english") embedId = "streamwish-english";
        else embedId = "streamwish-latino";
      } else if (realUrl.includes("vidhide")) embedId = "vidhide";
      else if (realUrl.includes("voe")) embedId = "voe";
      else continue;
      videoList.push({
        embedId,
        url: realUrl
      });
    }
  }
  return videoList;
}
async function comboScraper$d(ctx) {
  var _a, _b, _c, _d;
  const mediaType = ctx.media.type;
  const tmdbId = ctx.media.tmdbId;
  if (!tmdbId) {
    throw new NotFoundError("TMDB ID is required to fetch the title in Spanish");
  }
  const translatedTitle = await fetchTMDBName(ctx, "es-ES");
  let normalizedTitle = normalizeTitle$3(translatedTitle);
  let pageUrl = mediaType === "movie" ? `${baseUrl$a}/ver-pelicula/${normalizedTitle}` : `${baseUrl$a}/episodio/${normalizedTitle}-temporada-${(_a = ctx.media.season) == null ? void 0 : _a.number}-episodio-${(_b = ctx.media.episode) == null ? void 0 : _b.number}`;
  ctx.progress(60);
  let pageContent = await ctx.proxiedFetcher(pageUrl);
  let $ = load(pageContent);
  let script = $("script").toArray().find((scriptEl) => {
    var _a2;
    const content = ((_a2 = scriptEl.children[0]) == null ? void 0 : _a2.data) || "";
    return content.includes('{"props":{"pageProps":');
  });
  let embeds = [];
  if (script) {
    let jsonData;
    try {
      const jsonString = script.children[0].data;
      const start = jsonString.indexOf('{"props":{"pageProps":');
      if (start === -1) throw new Error("No valid JSON start found");
      const partialJson = jsonString.slice(start);
      jsonData = JSON.parse(partialJson);
    } catch (error) {
      throw new NotFoundError(`Failed to parse JSON: ${error.message}`);
    }
    if (mediaType === "movie") {
      const movieData = jsonData.props.pageProps.thisMovie;
      if (movieData == null ? void 0 : movieData.videos) {
        embeds = await extractVideos(ctx, movieData.videos) ?? [];
      }
    } else {
      const episodeData = jsonData.props.pageProps.episode;
      if (episodeData == null ? void 0 : episodeData.videos) {
        embeds = await extractVideos(ctx, episodeData.videos) ?? [];
      }
    }
  }
  if (embeds.length === 0) {
    normalizedTitle = normalizeTitle$3(ctx.media.title);
    pageUrl = mediaType === "movie" ? `${baseUrl$a}/ver-pelicula/${normalizedTitle}` : `${baseUrl$a}/episodio/${normalizedTitle}-temporada-${(_c = ctx.media.season) == null ? void 0 : _c.number}-episodio-${(_d = ctx.media.episode) == null ? void 0 : _d.number}`;
    pageContent = await ctx.proxiedFetcher(pageUrl);
    $ = load(pageContent);
    script = $("script").toArray().find((scriptEl) => {
      var _a2;
      const content = ((_a2 = scriptEl.children[0]) == null ? void 0 : _a2.data) || "";
      return content.includes('{"props":{"pageProps":');
    });
    if (script) {
      let jsonData;
      try {
        const jsonString = script.children[0].data;
        const start = jsonString.indexOf('{"props":{"pageProps":');
        if (start === -1) throw new Error("No valid JSON start found");
        const partialJson = jsonString.slice(start);
        jsonData = JSON.parse(partialJson);
      } catch (error) {
        throw new NotFoundError(`Failed to parse JSON: ${error.message}`);
      }
      if (mediaType === "movie") {
        const movieData = jsonData.props.pageProps.thisMovie;
        if (movieData == null ? void 0 : movieData.videos) {
          embeds = await extractVideos(ctx, movieData.videos) ?? [];
        }
      } else {
        const episodeData = jsonData.props.pageProps.episode;
        if (episodeData == null ? void 0 : episodeData.videos) {
          embeds = await extractVideos(ctx, episodeData.videos) ?? [];
        }
      }
    }
  }
  if (embeds.length === 0) {
    throw new NotFoundError("No valid streams found");
  }
  return { embeds };
}
const cuevana3Scraper = makeSourcerer({
  id: "cuevana3",
  name: "Cuevana3",
  rank: 80,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$d,
  scrapeShow: comboScraper$d
});
async function getAddonStreams(addonUrl, ctx) {
  if (!ctx.media.imdbId) {
    throw new Error("Error: ctx.media.imdbId is required.");
  }
  let addonResponse;
  if (ctx.media.type === "show") {
    addonResponse = await ctx.proxiedFetcher(
      `${addonUrl}/stream/series/${ctx.media.imdbId}:${ctx.media.season.number}:${ctx.media.episode.number}.json`
    );
  } else {
    addonResponse = await ctx.proxiedFetcher(`${addonUrl}/stream/movie/${ctx.media.imdbId}.json`);
  }
  if (!addonResponse) {
    throw new Error("Error: addon did not respond");
  }
  return addonResponse;
}
async function parseStreamData(streams, ctx) {
  return ctx.proxiedFetcher("https://torrent-parse.pstream.mov", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(streams)
  });
}
async function getCometStreams(token, debridProvider, ctx) {
  const cometBaseUrl = "https://comet.elfhosted.com";
  const cometConfig = btoa(
    JSON.stringify({
      maxResultsPerResolution: 0,
      maxSize: 0,
      cachedOnly: false,
      removeTrash: true,
      resultFormat: ["all"],
      debridService: debridProvider,
      debridApiKey: token,
      debridStreamProxyPassword: "",
      languages: { exclude: [], preferred: ["en"] },
      resolutions: {},
      options: { remove_ranks_under: -1e10, allow_english_in_languages: false, remove_unknown_languages: false }
    })
  );
  const cometStreamsRaw = (await getAddonStreams(`${cometBaseUrl}/${cometConfig}`, ctx)).streams;
  const newStreams = [];
  for (let i = 0; i < cometStreamsRaw.length; i++) {
    if (cometStreamsRaw[i].description !== void 0)
      newStreams.push({
        title: cometStreamsRaw[i].description.replace(/\n/g, ""),
        url: cometStreamsRaw[i].url
      });
  }
  const parsedData = await parseStreamData(newStreams, ctx);
  return parsedData;
}
const OVERRIDE_TOKEN = "";
const OVERRIDE_SERVICE = "";
const getDebridToken = () => {
  var _a;
  try {
    if (OVERRIDE_TOKEN) ;
  } catch {
  }
  try {
    if (typeof window === "undefined") return null;
    const prefData = window.localStorage.getItem("__MW::preferences");
    if (!prefData) return null;
    const parsedAuth = JSON.parse(prefData);
    return ((_a = parsedAuth == null ? void 0 : parsedAuth.state) == null ? void 0 : _a.debridToken) || null;
  } catch (e) {
    console.error("Error getting debrid token:", e);
    return null;
  }
};
const getDebridService = () => {
  var _a;
  try {
    if (OVERRIDE_SERVICE) ;
  } catch {
  }
  try {
    if (typeof window === "undefined") return "real-debrid";
    const prefData = window.localStorage.getItem("__MW::preferences");
    if (!prefData) return "real-debrid";
    const parsedPrefs = JSON.parse(prefData);
    const saved = (_a = parsedPrefs == null ? void 0 : parsedPrefs.state) == null ? void 0 : _a.debridService;
    if (saved === "realdebrid" || !saved) return "real-debrid";
    return saved;
  } catch (e) {
    console.error("Error getting debrid service (defaulting to real-debrid):", e);
    return "real-debrid";
  }
};
function normalizeQuality(resolution) {
  if (!resolution) return "unknown";
  const res = resolution.toLowerCase();
  if (res === "4k" || res === "2160p") return "4k";
  if (res === "1080p") return 1080;
  if (res === "720p") return 720;
  if (res === "480p") return 480;
  if (res === "360p") return 360;
  return "unknown";
}
function scoreStream(stream) {
  let score = 0;
  if (stream.container === "mp4") score += 10;
  if (stream.audio === "aac") score += 5;
  if (stream.codec === "h265") score += 2;
  if (stream.container === "mkv") score -= 2;
  if (stream.complete) score += 1;
  return score;
}
async function comboScraper$c(ctx) {
  const apiKey = getDebridToken();
  if (!apiKey) {
    throw new NotFoundError("Debrid API token is required");
  }
  const debridProvider = getDebridService();
  const [torrentioResult, cometStreams] = await Promise.all([
    getAddonStreams(`https://torrentio.strem.fun/${debridProvider}=${apiKey}`, ctx),
    getCometStreams(apiKey, debridProvider, ctx).catch(() => {
      return [];
    })
  ]);
  ctx.progress(33);
  const torrentioStreams = await parseStreamData(
    torrentioResult.streams.map((s) => ({
      ...s,
      title: s.title ?? ""
    })),
    ctx
  );
  const allStreams = [...torrentioStreams, ...cometStreams];
  if (allStreams.length === 0) {
    console.log("No streams found from either source!");
    throw new NotFoundError("No streams found or parse failed!");
  }
  console.log(
    `Total streams: ${allStreams.length} (${torrentioStreams.length} from Torrentio, ${cometStreams.length} from Comet)`
  );
  ctx.progress(66);
  const qualities = {};
  const byQuality = {};
  for (const stream of allStreams) {
    const quality = normalizeQuality(stream.resolution);
    if (!byQuality[quality]) byQuality[quality] = [];
    byQuality[quality].push(stream);
  }
  for (const [quality, streams] of Object.entries(byQuality)) {
    const mp4Aac = streams.find((s) => s.container === "mp4" && s.audio === "aac");
    if (mp4Aac) {
      qualities[quality] = {
        type: "mp4",
        url: mp4Aac.url
      };
      continue;
    }
    const mp4 = streams.find((s) => s.container === "mp4");
    if (mp4) {
      qualities[quality] = {
        type: "mp4",
        url: mp4.url
      };
      continue;
    }
    streams.sort((a, b) => scoreStream(b) - scoreStream(a));
    const best = streams[0];
    if (best) {
      qualities[quality] = {
        type: "mp4",
        // has to be set as mp4 because of types..... But mkvs *can* work in a browser depending on codec, usually it cant be hevc and has to have AAC audio
        url: best.url
      };
    }
  }
  ctx.progress(100);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "file",
        qualities,
        captions: [],
        flags: []
      }
    ]
  };
}
const debridScraper = makeSourcerer({
  id: "debrid",
  name: "Debrid",
  rank: 450,
  disabled: !getDebridToken(),
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$c,
  scrapeShow: comboScraper$c
});
function rtt(str) {
  return str.replace(/[a-z]/gi, (c) => {
    return String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13));
  });
}
function decodeAtom(e) {
  const t = atob(e.split("").reverse().join(""));
  let o = "";
  for (let i = 0; i < t.length; i++) {
    const r = "K9L"[i % 3];
    const n = t.charCodeAt(i) - (r.charCodeAt(0) % 5 + 1);
    o += String.fromCharCode(n);
  }
  return atob(o);
}
function extractPackerParams(rawInput) {
  const regex = /'((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/;
  const match = regex.exec(rawInput);
  if (!match) {
    console.error("Could not parse parameters. Format is not as expected.");
    return null;
  }
  return {
    payload: match[1],
    radix: parseInt(match[2], 10),
    count: parseInt(match[3], 10),
    keywords: match[4].split("|")
  };
}
function decodeDeanEdwards(params) {
  const { payload, radix, count, keywords } = params;
  const dict = /* @__PURE__ */ Object.create(null);
  const encodeBase = (num) => {
    if (num < radix) {
      const char2 = num % radix;
      return char2 > 35 ? String.fromCharCode(char2 + 29) : char2.toString(36);
    }
    const prefix = encodeBase(Math.floor(num / radix));
    const char = num % radix;
    const suffix = char > 35 ? String.fromCharCode(char + 29) : char.toString(36);
    return prefix + suffix;
  };
  let i = count;
  while (i--) {
    const key2 = encodeBase(i);
    const value = keywords[i] || key2;
    dict[key2] = value;
  }
  return payload.replace(/\b\w+\b/g, (word) => {
    if (word in dict) {
      return dict[word];
    }
    return word;
  });
}
function decodeHex(str) {
  return str.replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hexGroup) => {
    return String.fromCharCode(parseInt(hexGroup, 16));
  });
}
function unescapeString(str) {
  return str.replace(/\\(.)/g, (match, char) => char);
}
const baseUrl$9 = "https://www.fullhdfilmizlesene.tv";
const headers$3 = {
  Referer: baseUrl$9,
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};
function extractVidmoxy(body) {
  const regex = /eval\(function\(p,a,c,k,e,d\){.+}}return p}\((\\?'.+.split\(\\?'\|\\?'\)).+$/m;
  let decoded = body;
  let i = 0;
  while (decoded.includes("eval(")) {
    const decodedMatch = decoded.match(regex);
    if (!decodedMatch) {
      throw new NotFoundError("Decryption unsuccessful");
    }
    const parameters = extractPackerParams(i > 0 ? unescapeString(decodedMatch[1]) : decodedMatch[1]);
    if (!parameters) throw new NotFoundError("Decryption unsuccessful");
    decoded = decodeDeanEdwards(parameters);
    i++;
  }
  const fileMatch = decoded.match(/"file":"(.+?)"/);
  if (!fileMatch) throw new NotFoundError("No playlist found");
  const playlistUrl = unescapeString(decodeHex(fileMatch[1]));
  return playlistUrl;
}
function extractAtom(body) {
  const fileMatch = body.match(/"file": av\('(.+)'\),$/m);
  if (!fileMatch) throw new NotFoundError("No playlist found");
  const playlistUrl = decodeAtom(fileMatch[1]);
  return playlistUrl;
}
async function scrapeMovie(ctx) {
  if (!ctx.media.imdbId) {
    throw new NotFoundError("IMDb id not provided");
  }
  const searchJson = await ctx.proxiedFetcher(
    `/autocomplete/q.php?q=${ctx.media.imdbId}`,
    {
      baseUrl: baseUrl$9,
      headers: headers$3
    }
  );
  ctx.progress(30);
  if (!searchJson.length) throw new NotFoundError("Media not found");
  const searchResult = searchJson[0];
  const mediaUrl = `/${searchResult.prefix}/${searchResult.dizilink}`;
  const mediaPage = await ctx.proxiedFetcher(mediaUrl, {
    baseUrl: baseUrl$9,
    headers: headers$3
  });
  const playerMatch = mediaPage.match(/var scx = {.+"t":\["(.+)"\]},/);
  if (!playerMatch) throw new NotFoundError("No source found");
  ctx.progress(60);
  const playerUrl2 = atob(rtt(playerMatch[1]));
  const isVidmoxy = playerUrl2.startsWith("https://vidmoxy.com");
  const playerResponse = await ctx.proxiedFetcher(playerUrl2 + (isVidmoxy ? "?vst=1" : ""), {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: baseUrl$9,
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-User": "?1",
      "Sec-GPC": "1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
  });
  ctx.progress(80);
  if (!playerResponse || playerResponse === "404") throw new NotFoundError("Player 404: Source is inaccessible");
  const playlistUrl = isVidmoxy ? extractVidmoxy(playerResponse) : extractAtom(playerResponse);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: createM3U8ProxyUrl(playlistUrl, ctx.features, headers$3),
        headers: headers$3,
        flags: [flags.CORS_ALLOWED],
        captions: []
      }
    ]
  };
}
const fullhdfilmizleScraper = makeSourcerer({
  id: "fullhdfilmizle",
  name: "FullHDFilmizle (Turkish)",
  rank: 6,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie
});
function generateRandomFavs() {
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const generateSegment = (length) => Array.from({ length }, randomHex).join("");
  return `${generateSegment(8)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(
    12
  )}`;
}
function parseSubtitleLinks(inputString) {
  if (!inputString || typeof inputString === "boolean") return [];
  const linksArray = inputString.split(",");
  const captions = [];
  linksArray.forEach((link) => {
    const match = link.match(/\[([^\]]+)\](https?:\/\/\S+?)(?=,\[|$)/);
    if (match) {
      const type = getCaptionTypeFromUrl(match[2]);
      const language = labelToLanguageCode(match[1]);
      if (!type || !language) return;
      captions.push({
        id: match[2],
        language,
        hasCorsRestrictions: false,
        type,
        url: match[2]
      });
    }
  });
  return captions;
}
function parseVideoLinks(inputString) {
  if (!inputString) throw new NotFoundError("No video links found");
  try {
    const qualityMap = {};
    const links = inputString.split(",");
    links.forEach((link) => {
      const match = link.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
      if (match) {
        const [_, quality, url] = match;
        if (url === "null") return;
        const normalizedQuality = quality.replace(/<[^>]+>/g, "").toLowerCase().replace("p", "").trim();
        qualityMap[normalizedQuality] = {
          type: "mp4",
          url: url.trim()
        };
      }
    });
    const result = {};
    Object.entries(qualityMap).forEach(([quality, data]) => {
      const validQuality = getValidQualityFromString(quality);
      result[validQuality] = data;
    });
    return result;
  } catch (error) {
    console.error("Error parsing video links:", error);
    throw new NotFoundError("Failed to parse video links");
  }
}
const rezkaBase = "https://hdrezka.ag/";
const baseHeaders = {
  "X-Hdrezka-Android-App": "1",
  "X-Hdrezka-Android-App-Version": "2.2.0",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "CF-IPCountry": "RU"
};
async function searchAndFindMediaId(ctx) {
  const searchData = await ctx.proxiedFetcher(`/engine/ajax/search.php`, {
    baseUrl: rezkaBase,
    headers: baseHeaders,
    query: { q: ctx.media.title }
  });
  const $ = load(searchData);
  const items = $("a").map((_, el) => {
    var _a;
    const $el = $(el);
    const url = $el.attr("href");
    const titleText = $el.find("span.enty").text();
    const yearMatch = titleText.match(/\((\d{4})\)/) || (url == null ? void 0 : url.match(/-(\d{4})(?:-|\.html)/)) || titleText.match(/(\d{4})/);
    const itemYear = yearMatch ? yearMatch[1] : null;
    const id = (_a = url == null ? void 0 : url.match(/\/(\d+)-[^/]+\.html$/)) == null ? void 0 : _a[1];
    if (id) {
      return {
        id,
        year: itemYear ? parseInt(itemYear, 10) : ctx.media.releaseYear,
        type: ctx.media.type,
        url: url || ""
      };
    }
    return null;
  }).get().filter(Boolean);
  items.sort((a, b) => {
    const diffA = Math.abs(a.year - ctx.media.releaseYear);
    const diffB = Math.abs(b.year - ctx.media.releaseYear);
    return diffA - diffB;
  });
  return items[0] || null;
}
async function getStream(id, translatorId, ctx) {
  const searchParams = new URLSearchParams();
  searchParams.append("id", id);
  searchParams.append("translator_id", translatorId);
  if (ctx.media.type === "show") {
    searchParams.append("season", ctx.media.season.number.toString());
    searchParams.append("episode", ctx.media.episode.number.toString());
  }
  searchParams.append("favs", generateRandomFavs());
  searchParams.append("action", ctx.media.type === "show" ? "get_stream" : "get_movie");
  searchParams.append("t", Date.now().toString());
  const response = await ctx.proxiedFetcher("/ajax/get_cdn_series/", {
    baseUrl: rezkaBase,
    method: "POST",
    body: searchParams,
    headers: {
      ...baseHeaders,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${rezkaBase}films/action/${id}-novokain-2025-latest.html`
    }
  });
  try {
    const data = JSON.parse(response);
    if (!data.url && data.success) {
      throw new NotFoundError("Movie found but no stream available (might be premium or not yet released)");
    }
    if (!data.url) {
      throw new NotFoundError("No stream URL found in response");
    }
    return data;
  } catch (error) {
    console.error("Error parsing stream response:", error);
    throw new NotFoundError("Failed to parse stream response");
  }
}
async function getTranslatorId(url, id, ctx) {
  const response = await ctx.proxiedFetcher(url, {
    headers: baseHeaders
  });
  if (response.includes(`data-translator_id="238"`)) {
    return "238";
  }
  const functionName = ctx.media.type === "movie" ? "initCDNMoviesEvents" : "initCDNSeriesEvents";
  const regexPattern = new RegExp(`sof\\.tv\\.${functionName}\\(${id}, ([^,]+)`, "i");
  const match = response.match(regexPattern);
  const translatorId = match ? match[1] : null;
  return translatorId;
}
const universalScraper$4 = async (ctx) => {
  const result = await searchAndFindMediaId(ctx);
  if (!result || !result.id) throw new NotFoundError("No result found");
  const translatorId = await getTranslatorId(result.url, result.id, ctx);
  if (!translatorId) throw new NotFoundError("No translator id found");
  const { url: streamUrl, subtitle: streamSubtitle } = await getStream(result.id, translatorId, ctx);
  const parsedVideos = parseVideoLinks(streamUrl);
  const parsedSubtitles = parseSubtitleLinks(streamSubtitle);
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "file",
        flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
        captions: parsedSubtitles,
        qualities: parsedVideos
      }
    ]
  };
};
const hdRezkaScraper = makeSourcerer({
  id: "hdrezka",
  name: "HDRezka",
  rank: 105,
  flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
  scrapeShow: universalScraper$4,
  scrapeMovie: universalScraper$4
});
async function getVideoSources(ctx, id, media) {
  let path = "";
  if (media.type === "show") {
    path = `/v1/episodes/view`;
  } else if (media.type === "movie") {
    path = `/v1/movies/view`;
  }
  const data = await ctx.proxiedFetcher(path, {
    baseUrl: baseUrl$8,
    query: { expand: "streams,subtitles", id }
  });
  return data;
}
async function getVideo(ctx, id, media) {
  const data = await getVideoSources(ctx, id, media);
  const videoSources = data.streams;
  const opts = ["auto", "1080p", "1080", "720p", "720", "480p", "480", "240p", "240", "360p", "360", "144", "144p"];
  let videoUrl = null;
  for (const res of opts) {
    if (videoSources[res] && !videoUrl) {
      videoUrl = videoSources[res];
    }
  }
  let captions = [];
  for (const sub of data.subtitles) {
    const language = labelToLanguageCode(sub.language);
    if (!language) continue;
    captions.push({
      id: sub.url,
      type: "vtt",
      url: `${baseUrl$8}${sub.url}`,
      hasCorsRestrictions: false,
      language
    });
  }
  captions = removeDuplicatedLanguages(captions);
  return {
    playlist: videoUrl,
    captions
  };
}
const baseUrl$8 = "https://lmscript.xyz";
async function searchAndFindMedia(ctx, media) {
  if (media.type === "show") {
    const searchRes = await ctx.proxiedFetcher(`/v1/shows`, {
      baseUrl: baseUrl$8,
      query: { "filters[q]": media.title }
    });
    const results = searchRes.items;
    const result = results.find((res) => compareMedia(media, res.title, Number(res.year)));
    return result;
  }
  if (media.type === "movie") {
    const searchRes = await ctx.proxiedFetcher(`/v1/movies`, {
      baseUrl: baseUrl$8,
      query: { "filters[q]": media.title }
    });
    const results = searchRes.items;
    const result = results.find((res) => compareMedia(media, res.title, Number(res.year)));
    return result;
  }
}
async function scrape(ctx, media, result) {
  var _a;
  let id = null;
  if (media.type === "movie") {
    id = result.id_movie;
  } else if (media.type === "show") {
    const data = await ctx.proxiedFetcher(`/v1/shows`, {
      baseUrl: baseUrl$8,
      query: { expand: "episodes", id: result.id_show }
    });
    const episode = (_a = data.episodes) == null ? void 0 : _a.find((v) => {
      return Number(v.season) === Number(media.season.number) && Number(v.episode) === Number(media.episode.number);
    });
    if (episode) id = episode.id;
  }
  if (id === null) throw new NotFoundError("Not found");
  const video = await getVideo(ctx, id, media);
  return video;
}
async function universalScraper$3(ctx) {
  const lookmovieData = await searchAndFindMedia(ctx, ctx.media);
  if (!lookmovieData) throw new NotFoundError("Media not found");
  ctx.progress(30);
  const video = await scrape(ctx, ctx.media, lookmovieData);
  if (!video.playlist) throw new NotFoundError("No video found");
  ctx.progress(60);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        playlist: video.playlist,
        type: "hls",
        flags: [flags.IP_LOCKED],
        captions: video.captions
      }
    ]
  };
}
const lookmovieScraper = makeSourcerer({
  id: "lookmovie",
  name: "LookMovie",
  disabled: false,
  rank: 171,
  flags: [flags.IP_LOCKED],
  scrapeShow: universalScraper$3,
  scrapeMovie: universalScraper$3
});
const baseUrl$7 = "https://movies4f.com";
const headers$2 = {
  Referer: "https://movies4f.com/",
  Origin: "https://movies4f.com",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};
async function comboScraper$b(ctx) {
  let searchQuery = encodeURIComponent(ctx.media.title);
  let searchUrl = `${baseUrl$7}/search?q=${searchQuery}`;
  let searchPage = await ctx.proxiedFetcher(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
  if (!searchPage.includes("/film/")) {
    searchQuery = encodeURIComponent(`${ctx.media.title} ${ctx.media.releaseYear}`);
    searchUrl = `${baseUrl$7}/search?q=${searchQuery}`;
    searchPage = await ctx.proxiedFetcher(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  }
  ctx.progress(40);
  let filmUrl = null;
  const filmCardRegex = /<a[^>]*href="([^"]*\/film\/\d+\/[^"]*)"[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]*alt="([^"]*)"[^>]*>/g;
  let filmMatch;
  for (; ; ) {
    filmMatch = filmCardRegex.exec(searchPage);
    if (filmMatch === null) break;
    const link = filmMatch[1];
    const title = filmMatch[2];
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedSearchTitle = ctx.media.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedTitle.includes(normalizedSearchTitle)) {
      if (ctx.media.type === "show") {
        const episode = ctx.media.episode.number;
        const episodeUrl = `${baseUrl$7}${link}/episode-${episode}`;
        if (title.toLowerCase().includes("season") || link.includes("/film/")) {
          filmUrl = episodeUrl;
          break;
        }
      } else {
        filmUrl = `${baseUrl$7}${link}`;
        break;
      }
    }
  }
  if (!filmUrl) {
    throw new NotFoundError("No matching film found in search results");
  }
  ctx.progress(50);
  const filmPage = await ctx.proxiedFetcher(filmUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
  ctx.progress(60);
  const $film = load(filmPage);
  const iframeSrc = $film("iframe#iframeStream").attr("src");
  if (!iframeSrc) {
    throw new NotFoundError("No embed iframe found");
  }
  const embedUrl = new URL(iframeSrc);
  const videoId = embedUrl.searchParams.get("id");
  if (!videoId) {
    throw new NotFoundError("No video ID found in embed URL");
  }
  ctx.progress(70);
  const tokenResponse = await ctx.proxiedFetcher("https://moviking.childish2x2.fun/geturl", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=----geckoformboundaryc5f480bcac13a77346dab33881da6bfb",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: iframeSrc
    },
    body: `------geckoformboundaryc5f480bcac13a77346dab33881da6bfb
Content-Disposition: form-data; name="renderer"

ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar
------geckoformboundaryc5f480bcac13a77346dab33881da6bfb
Content-Disposition: form-data; name="id"

6164426f797cf4b2fe93e4b20c0a4338
------geckoformboundaryc5f480bcac13a77346dab33881da6bfb
Content-Disposition: form-data; name="videoId"

${videoId}
------geckoformboundaryc5f480bcac13a77346dab33881da6bfb
Content-Disposition: form-data; name="domain"

${baseUrl$7}/
------geckoformboundaryc5f480bcac13a77346dab33881da6bfb--`
  });
  ctx.progress(80);
  const tokenMatch = tokenResponse.match(/token1=(\w+)&token2=(\w+)&token3=(\w+)/);
  if (!tokenMatch) {
    throw new NotFoundError("Failed to extract tokens");
  }
  const [, token1, token2, token3] = tokenMatch;
  const streamingUrl = `https://cdn4.zenty.store/streaming?id=${videoId}&web=movies4f.com&token1=${token1}&token2=${token2}&token3=${token3}&cdn=https%3A%2F%2Fcdn4.zenty.store&lang=en`;
  const streamingPage = await ctx.proxiedFetcher(streamingUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://moviking.childish2x2.fun/"
    }
  });
  ctx.progress(90);
  const urlRegex = /url = '([^']+)'/;
  const urlMatch = streamingPage.match(urlRegex);
  if (!urlMatch) {
    throw new NotFoundError("Failed to extract stream URL from streaming page");
  }
  const streamBaseUrl = urlMatch[1];
  const videoIdMatch = streamingUrl.match(/id=([^&]+)/);
  if (!videoIdMatch) {
    throw new NotFoundError("Failed to extract videoId from streaming URL");
  }
  const streamVideoId = videoIdMatch[1];
  const streamUrl = `${streamBaseUrl}${streamVideoId}/?token1=${token1}&token3=${token3}`;
  ctx.progress(95);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: streamUrl,
        headers: headers$2,
        flags: [flags.CORS_ALLOWED],
        captions: []
      }
    ]
  };
}
const movies4fScraper = makeSourcerer({
  id: "movies4f",
  name: "M4F",
  rank: 166,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$b,
  scrapeShow: comboScraper$b
});
const baseUrl$6 = "https://multiembed.mov";
async function comboScraper$a(ctx) {
  ctx.progress(50);
  let url;
  if (ctx.media.type === "show") {
    url = `${baseUrl$6}/?video_id=${ctx.media.imdbId}&s=${ctx.media.season.number}&e=${ctx.media.episode.number}`;
  } else {
    url = `${baseUrl$6}/?video_id=${ctx.media.imdbId}`;
  }
  return {
    embeds: [
      {
        embedId: "streambucket",
        url
      }
    ]
  };
}
const multiembedScraper = makeSourcerer({
  id: "multiembed",
  name: "MultiEmbed 🔥",
  rank: 145,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$a,
  scrapeShow: comboScraper$a
});
const GEMINI_BASE_URL = "https://gemini.aether.mom/v1beta/models/gemini-2.5-flash-lite:generateContent";
function buildPrompt(media, searchResults) {
  const seasons = media.season.number > 1 ? ` and has ${media.season.number} seasons` : "";
  const prompt = `
    You are an AI that matches TMDB movie and show data to myanime search results.
    The user is searching for "${media.title}" which was released in ${media.releaseYear}${seasons}.
    The user is looking for season ${media.season.number} (TMDB title: "${media.season.title}", ${media.season.episodeCount ?? "unknown"} episodes), episode ${media.episode.number}.

    Here are the search results from myanime:
    ${JSON.stringify(searchResults, null, 2)}

    IMPORTANT: Some shows on TMDB have continuous episode numbering across seasons (e.g., episode 25 is the first episode of season 2), but myanime lists seasons as separate entries with their own episode counts. The myanime entry may also have a different title (e.g., "Mugen Train Arc").
    To solve this, please return a JSON object with a "results" array that contains ALL entries from the search results that match the requested show, including all of its seasons, even if the user is only asking for one.
    Each object in the "results" array should have the "id" of the matching anime from the myanime search results, and the "season" number. You must determine the season number for each entry based on its title.
    The results MUST be sorted by season number in ascending order so the calling code can correctly map the episode number.
    Pay close attention to the season title and episode counts from both TMDB and the myanime results to find the best match. If TMDB combines seasons into one, you must split them based on the episode counts in the search results.
    Use the TMDB season title as the primary key for matching, and do not assign the same season number to different arcs.
    Your response must only be the raw JSON object, without any markdown formatting, comments, or other text.
  `;
  return prompt.trim();
}
async function getAiMatching(ctx, media, searchResults) {
  try {
    const prompt = buildPrompt(media, searchResults);
    const response = await ctx.fetcher(GEMINI_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    const text = response.candidates[0].content.parts[0].text;
    const firstBracket = text.indexOf("{");
    const lastBracket = text.lastIndexOf("}");
    if (firstBracket === -1 || lastBracket === -1) {
      throw new Error("Invalid AI response: No JSON object found");
    }
    const jsonString = text.substring(firstBracket, lastBracket + 1);
    const data = JSON.parse(jsonString);
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid AI response format");
    }
    return data;
  } catch (error) {
    if (error instanceof Error) {
      ctx.progress(0);
    }
    return null;
  }
}
const showScraper = async (ctx) => {
  var _a, _b, _c;
  const title = await getAnilistEnglishTitle(ctx, ctx.media);
  if (!title) throw new NotFoundError("Anime not found");
  const allAnimes = [];
  for (const t of [ctx.media.title, title]) {
    try {
      const searchResult = await ctx.proxiedFetcher(
        `https://anime.aether.mom/api/search?keyword=${encodeURIComponent(t)}`
      );
      if ((_a = searchResult == null ? void 0 : searchResult.results) == null ? void 0 : _a.data) {
        allAnimes.push(...searchResult.results.data);
      }
    } catch (err) {
    }
  }
  const uniqueAnimes = [...new Map(allAnimes.map((item) => [item.id, item])).values()];
  if (uniqueAnimes.length === 0) throw new NotFoundError("Anime not found");
  const tvAnimes = uniqueAnimes.filter((v) => v.tvInfo.showType === "TV");
  const aiResult = await getAiMatching(ctx, ctx.media, tvAnimes);
  let seasons = [];
  if (aiResult && aiResult.results.length > 0) {
    seasons = aiResult.results.map((v) => {
      const anime = tvAnimes.find((a) => a.id === v.id);
      if (!anime) return null;
      return {
        ...anime,
        seasonNum: v.season ?? 1
      };
    }).filter((v) => v !== null).sort((a, b) => a.seasonNum - b.seasonNum);
  }
  if (seasons.length === 0) throw new NotFoundError("Anime not found");
  let episodeId;
  let season = seasons.find((v) => v.seasonNum === ctx.media.season.number);
  const seasonEntries = seasons.filter((v) => v.seasonNum === ctx.media.season.number);
  if (seasonEntries.length > 1) {
    const sorted = seasonEntries.sort((a, b) => {
      const aTitleText = a.title;
      const bTitleText = b.title;
      const targetTitle = ctx.media.season.title;
      return Number(compareTitle(bTitleText, targetTitle)) - Number(compareTitle(aTitleText, targetTitle));
    });
    season = sorted[0];
  }
  if (season) {
    const episodeData = await ctx.proxiedFetcher(`https://anime.aether.mom/api/episodes/${season.id}`);
    if ((_b = episodeData == null ? void 0 : episodeData.results) == null ? void 0 : _b.episodes) {
      const episode = episodeData.results.episodes.find((ep) => ep.episode_no === ctx.media.episode.number);
      if (episode) episodeId = episode.id;
    }
  }
  if (!episodeId) {
    let episodeNumber = ctx.media.episode.number;
    for (const s of seasons) {
      const epCount = s.tvInfo.sub ?? 0;
      if (episodeNumber <= epCount) {
        const targetEpisodeNumber = episodeNumber;
        const episodeData = await ctx.proxiedFetcher(`https://anime.aether.mom/api/episodes/${s.id}`);
        if ((_c = episodeData == null ? void 0 : episodeData.results) == null ? void 0 : _c.episodes) {
          const episode = episodeData.results.episodes.find((ep) => ep.episode_no === targetEpisodeNumber);
          if (episode) {
            episodeId = episode.id;
            break;
          }
        }
      }
      if (episodeId) break;
      episodeNumber -= epCount;
    }
  }
  if (!episodeId) throw new NotFoundError("Episode not found");
  return {
    embeds: [
      {
        embedId: "myanimesub",
        url: episodeId
      },
      {
        embedId: "myanimedub",
        url: episodeId
      }
    ]
  };
};
const universalScraper$2 = async (ctx) => {
  const searchResults = await ctx.proxiedFetcher(
    `https://anime.aether.mom/api/search?keyword=${encodeURIComponent(ctx.media.title)}`
  );
  const movie = searchResults.results.data.find((v) => v.tvInfo.showType === "Movie");
  if (!movie) throw new NotFoundError("No watchable sources found");
  const episodeData = await ctx.proxiedFetcher(`https://anime.aether.mom/api/episodes/${movie.id}`);
  const episode = episodeData.results.episodes.find((e) => e.episode_no === 1);
  if (!episode) throw new NotFoundError("No watchable sources found");
  return {
    embeds: [
      {
        embedId: "myanimesub",
        url: episode.id
      },
      {
        embedId: "myanimedub",
        url: episode.id
      }
    ]
  };
};
const myanimeScraper = makeSourcerer({
  id: "myanime",
  name: "MyAnime",
  rank: 113,
  disabled: false,
  // disabled since AI api is not privated
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: universalScraper$2,
  scrapeShow: showScraper
});
const mamaApiBase = "https://mama.up.railway.app/api/showbox";
const getUserToken = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem("febbox_ui_token") : null;
  } catch (e) {
    console.warn("Unable to access localStorage:", e);
    return null;
  }
};
async function comboScraper$9(ctx) {
  const userToken = getUserToken();
  const apiUrl = ctx.media.type === "movie" ? `${mamaApiBase}/movie/${ctx.media.tmdbId}?token=${userToken}` : `${mamaApiBase}/tv/${ctx.media.tmdbId}?season=${ctx.media.season.number}&episode=${ctx.media.episode.number}&token=${userToken}`;
  const apiRes = await ctx.proxiedFetcher(apiUrl);
  if (!apiRes) {
    throw new NotFoundError("No response from API");
  }
  const data = await apiRes;
  if (!data.success) {
    throw new NotFoundError("No streams found");
  }
  const streamItems = Array.isArray(data.streams) ? data.streams : [data.streams];
  if (streamItems.length === 0 || !streamItems[0].player_streams) {
    throw new NotFoundError("No valid streams found");
  }
  let bestStreamItem = streamItems[0];
  for (const item of streamItems) {
    if (item.quality.includes("4K") || item.quality.includes("2160p")) {
      bestStreamItem = item;
      break;
    }
  }
  const streams = bestStreamItem.player_streams.reduce((acc, stream) => {
    let qualityKey;
    if (stream.quality === "4K" || stream.quality.includes("4K")) {
      qualityKey = 2160;
    } else if (stream.quality === "ORG" || stream.quality.includes("ORG")) {
      return acc;
    } else {
      qualityKey = parseInt(stream.quality.replace("P", ""), 10);
    }
    if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
    acc[qualityKey] = stream.file;
    return acc;
  }, {});
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        captions: [],
        qualities: {
          ...streams[2160] && {
            "4k": {
              type: "mp4",
              url: streams[2160]
            }
          },
          ...streams[1080] && {
            1080: {
              type: "mp4",
              url: streams[1080]
            }
          },
          ...streams[720] && {
            720: {
              type: "mp4",
              url: streams[720]
            }
          },
          ...streams[480] && {
            480: {
              type: "mp4",
              url: streams[480]
            }
          },
          ...streams[360] && {
            360: {
              type: "mp4",
              url: streams[360]
            }
          }
        },
        type: "file",
        flags: [flags.CORS_ALLOWED]
      }
    ]
  };
}
const nunflixScraper = makeSourcerer({
  id: "nunflix",
  name: "NFlix",
  rank: 155,
  disabled: !getUserToken(),
  // disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$9,
  scrapeShow: comboScraper$9
});
const baseUrl$5 = "https://ww3.pelisplus.to";
function normalizeTitle$2(title) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
function decodeBase64(str) {
  try {
    return atob(str);
  } catch {
    return "";
  }
}
function fetchUrls(text) {
  if (!text) return [];
  const linkRegex2 = /(http|ftp|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+))([\w.,@?^=%&:/~+#-]*[\w@?^=%&/~+#-])/g;
  return Array.from(text.matchAll(linkRegex2)).map((m) => m[0].replace(/^"+|"+$/g, ""));
}
async function resolvePlayerUrl(ctx, url) {
  try {
    const html = await ctx.proxiedFetcher(url);
    const $ = load(html);
    const script = $('script:contains("window.onload")').html() || "";
    return fetchUrls(script)[0] || "";
  } catch {
    return "";
  }
}
async function extractVidhideEmbed(ctx, $) {
  const regIsUrl = /^https?:\/\/([\w.-]+\.[a-z]{2,})(\/.*)?$/i;
  const playerLinks = [];
  $(".bg-tabs ul li").each((idx, el) => {
    var _a, _b;
    const li = $(el);
    const langBtn = (_b = (_a = li.parent()) == null ? void 0 : _a.parent()) == null ? void 0 : _b.find("button").first().text().trim().toLowerCase();
    const dataServer = li.attr("data-server") || "";
    const decoded = decodeBase64(dataServer);
    const url = regIsUrl.test(decoded) ? decoded : `${baseUrl$5}/player/${btoa(dataServer)}`;
    playerLinks.push({ idx, langBtn, url });
  });
  const results = [];
  for (const link of playerLinks) {
    let realUrl = link.url;
    if (realUrl.includes("/player/")) {
      realUrl = await resolvePlayerUrl(ctx, realUrl);
    }
    if (/vidhide/i.test(realUrl)) {
      let embedId = "vidhide";
      if (link.langBtn.includes("latino")) embedId = "vidhide-latino";
      else if (link.langBtn.includes("castellano") || link.langBtn.includes("español")) embedId = "vidhide-spanish";
      else if (link.langBtn.includes("ingles") || link.langBtn.includes("english")) embedId = "vidhide-english";
      results.push({ embedId, url: realUrl });
    }
  }
  return results;
}
async function fetchTmdbTitleInSpanish(tmdbId, apiKey, mediaType) {
  const endpoint = mediaType === "movie" ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES` : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=es-ES`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Error fetching TMDB data: ${response.statusText}`);
  }
  const tmdbData = await response.json();
  return mediaType === "movie" ? tmdbData.title : tmdbData.name;
}
async function fallbackSearchByGithub(ctx) {
  var _a, _b;
  const tmdbId = ctx.media.tmdbId;
  const mediaType = ctx.media.type;
  if (!tmdbId) return [];
  const jsonFile = mediaType === "movie" ? "pelisplushd_movies.json" : "pelisplushd_series.json";
  let fallbacks = {};
  try {
    const url = `https://raw.githubusercontent.com/moonpic/fixed-titles/main/${jsonFile}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error();
    fallbacks = await response.json();
  } catch {
    return [];
  }
  const fallbackTitle = fallbacks[tmdbId.toString()];
  if (!fallbackTitle) return [];
  const normalizedTitle = normalizeTitle$2(fallbackTitle);
  const pageUrl = mediaType === "movie" ? `${baseUrl$5}/pelicula/${normalizedTitle}` : `${baseUrl$5}/serie/${normalizedTitle}/season/${(_a = ctx.media.season) == null ? void 0 : _a.number}/episode/${(_b = ctx.media.episode) == null ? void 0 : _b.number}`;
  let html = "";
  try {
    html = await ctx.proxiedFetcher(pageUrl);
  } catch {
    return [];
  }
  const $ = load(html);
  return extractVidhideEmbed(ctx, $);
}
async function comboScraper$8(ctx) {
  var _a, _b;
  const mediaType = ctx.media.type;
  const tmdbId = ctx.media.tmdbId;
  const apiKey = "7604525319adb2db8e7e841cb98e9217";
  if (!tmdbId) throw new NotFoundError("TMDB ID is required to fetch the title in Spanish");
  let translatedTitle = "";
  try {
    translatedTitle = await fetchTmdbTitleInSpanish(Number(tmdbId), apiKey, mediaType);
  } catch {
    throw new NotFoundError("Could not get the title from TMDB");
  }
  const normalizedTitle = normalizeTitle$2(translatedTitle);
  const pageUrl = mediaType === "movie" ? `${baseUrl$5}/pelicula/${normalizedTitle}` : `${baseUrl$5}/serie/${normalizedTitle}/season/${(_a = ctx.media.season) == null ? void 0 : _a.number}/episode/${(_b = ctx.media.episode) == null ? void 0 : _b.number}`;
  ctx.progress(60);
  let html = "";
  try {
    html = await ctx.proxiedFetcher(pageUrl);
  } catch {
    html = "";
  }
  let embeds = [];
  if (html) {
    const $ = load(html);
    try {
      embeds = await extractVidhideEmbed(ctx, $);
    } catch {
      embeds = [];
    }
  }
  if (!embeds.length) {
    embeds = await fallbackSearchByGithub(ctx);
  }
  if (!embeds.length) {
    throw new NotFoundError("No vidhide embed found in PelisPlusHD");
  }
  return { embeds };
}
const pelisplushdScraper = makeSourcerer({
  id: "pelisplushd",
  name: "PelisPlusHD",
  rank: 75,
  flags: [flags.IP_LOCKED],
  // Vidhide embeds are IP locked
  scrapeMovie: comboScraper$8,
  scrapeShow: comboScraper$8
});
const ridoMoviesBase = `https://ridomovies.is`;
const ridoMoviesApiBase = `${ridoMoviesBase}/core/api`;
const normalizeTitle$1 = (title) => {
  return title.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
};
const universalScraper$1 = async (ctx) => {
  var _a;
  const searchResult = await ctx.proxiedFetcher("/search", {
    baseUrl: ridoMoviesApiBase,
    query: {
      q: ctx.media.title
    }
  });
  if (!((_a = searchResult.data) == null ? void 0 : _a.items) || searchResult.data.items.length === 0) {
    throw new NotFoundError("No search results found");
  }
  const mediaData = searchResult.data.items.map((movieEl) => {
    const name = movieEl.title;
    const year = movieEl.contentable.releaseYear;
    const fullSlug = movieEl.fullSlug;
    return { name, year, fullSlug };
  });
  const normalizedSearchTitle = normalizeTitle$1(ctx.media.title);
  const searchYear = ctx.media.releaseYear.toString();
  let targetMedia = mediaData.find((m) => normalizeTitle$1(m.name) === normalizedSearchTitle && m.year === searchYear);
  if (!targetMedia) {
    targetMedia = mediaData.find((m) => {
      const normalizedName = normalizeTitle$1(m.name);
      return m.year === searchYear && (normalizedName.includes(normalizedSearchTitle) || normalizedSearchTitle.includes(normalizedName));
    });
  }
  if (!(targetMedia == null ? void 0 : targetMedia.fullSlug)) {
    throw new NotFoundError("No matching media found");
  }
  ctx.progress(40);
  let iframeSourceUrl = `/${targetMedia.fullSlug}/videos`;
  if (ctx.media.type === "show") {
    const showPageResult = await ctx.proxiedFetcher(`/${targetMedia.fullSlug}`, {
      baseUrl: ridoMoviesBase
    });
    const fullEpisodeSlug = `season-${ctx.media.season.number}/episode-${ctx.media.episode.number}`;
    const regexPattern = new RegExp(
      `\\\\"id\\\\":\\\\"(\\d+)\\\\"(?=.*?\\\\"fullSlug\\\\":\\\\"[^"]*${fullEpisodeSlug}[^"]*\\\\")`,
      "g"
    );
    const matches = [...showPageResult.matchAll(regexPattern)];
    const episodeIds = matches.map((match) => match[1]);
    if (episodeIds.length === 0) {
      throw new NotFoundError("Episode not found");
    }
    const episodeId = episodeIds[episodeIds.length - 1];
    iframeSourceUrl = `/episodes/${episodeId}/videos`;
  }
  const iframeSource = await ctx.proxiedFetcher(iframeSourceUrl, {
    baseUrl: ridoMoviesApiBase
  });
  if (!iframeSource.data || iframeSource.data.length === 0) {
    throw new NotFoundError("No video sources found");
  }
  const iframeSource$ = load(iframeSource.data[0].url);
  const iframeUrl = iframeSource$("iframe").attr("data-src");
  if (!iframeUrl) {
    throw new NotFoundError("No iframe URL found");
  }
  ctx.progress(60);
  const embeds = [];
  let embedId = "closeload";
  if (iframeUrl.includes("ridoo")) {
    embedId = "ridoo";
  }
  embeds.push({
    embedId,
    url: iframeUrl
  });
  ctx.progress(80);
  if (embeds.length === 0) {
    throw new NotFoundError("No supported embeds found");
  }
  ctx.progress(90);
  return {
    embeds
  };
};
const ridooMoviesScraper = makeSourcerer({
  id: "ridomovies",
  name: "RidoMovies",
  rank: 203,
  flags: [],
  disabled: false,
  scrapeMovie: universalScraper$1,
  scrapeShow: universalScraper$1
});
const baseUrl$4 = "https://pupp.slidemovies-dev.workers.dev";
async function comboScraper$7(ctx) {
  const watchPageUrl = ctx.media.type === "movie" ? `${baseUrl$4}/movie/${ctx.media.tmdbId}` : `${baseUrl$4}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/-${ctx.media.episode.number}`;
  const watchPage = await ctx.proxiedFetcher(watchPageUrl);
  const $ = load(watchPage);
  ctx.progress(50);
  const proxiedStreamUrl = $("media-player").attr("src");
  if (!proxiedStreamUrl) {
    throw new NotFoundError("Stream URL not found");
  }
  const proxyUrl = new URL(proxiedStreamUrl);
  const encodedUrl = proxyUrl.searchParams.get("url") || "";
  const playlist = decodeURIComponent(encodedUrl);
  const captions = $("media-provider track").map((_, el) => {
    const url = $(el).attr("src") || "";
    const rawLang = $(el).attr("lang") || "unknown";
    const languageCode = labelToLanguageCode(rawLang) || rawLang;
    const isVtt = url.endsWith(".vtt") ? "vtt" : "srt";
    return {
      type: isVtt,
      id: url,
      url,
      language: languageCode,
      hasCorsRestrictions: false
    };
  }).get();
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "hls",
        flags: [],
        playlist,
        captions
      }
    ]
  };
}
const slidemoviesScraper = makeSourcerer({
  id: "slidemovies",
  name: "SlideMovies",
  rank: 135,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$7,
  scrapeShow: comboScraper$7
});
async function convertPlaylistsToDataUrls(fetcher, playlistUrl, headers2) {
  const playlistData = await fetcher(playlistUrl, { headers: headers2 });
  const playlist = parse(playlistData);
  if (playlist.isMasterPlaylist) {
    const baseUrl2 = new URL(playlistUrl).origin;
    await Promise.all(
      playlist.variants.map(async (variant) => {
        let variantUrl = variant.uri;
        if (!variantUrl.startsWith("http")) {
          if (!variantUrl.startsWith("/")) {
            variantUrl = `/${variantUrl}`;
          }
          variantUrl = baseUrl2 + variantUrl;
        }
        const variantPlaylistData = await fetcher(variantUrl, { headers: headers2 });
        const variantPlaylist = parse(variantPlaylistData);
        variant.uri = `data:application/vnd.apple.mpegurl;base64,${btoa(stringify(variantPlaylist))}`;
      })
    );
  }
  return `data:application/vnd.apple.mpegurl;base64,${btoa(stringify(playlist))}`;
}
const baseUrl$3 = "https://soaper.cc";
const universalScraper = async (ctx) => {
  var _a;
  const searchResult = await ctx.proxiedFetcher("/search.html", {
    baseUrl: baseUrl$3,
    query: {
      keyword: ctx.media.title
    }
  });
  const search$ = load(searchResult);
  const searchResults = [];
  search$(".thumbnail").each((_, element) => {
    const title = search$(element).find("h5").find("a").first().text().trim();
    const year = search$(element).find(".img-tip").first().text().trim();
    const url = search$(element).find("h5").find("a").first().attr("href");
    if (!title || !url) return;
    searchResults.push({ title, year: year ? parseInt(year, 10) : void 0, url });
  });
  let showLink = (_a = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))) == null ? void 0 : _a.url;
  if (!showLink) throw new NotFoundError("Content not found");
  if (ctx.media.type === "show") {
    const seasonNumber = ctx.media.season.number;
    const episodeNumber = ctx.media.episode.number;
    const showPage = await ctx.proxiedFetcher(showLink, { baseUrl: baseUrl$3 });
    const showPage$ = load(showPage);
    const seasonBlock = showPage$("h4").filter((_, el) => showPage$(el).text().trim().split(":")[0].trim() === `Season${seasonNumber}`).parent();
    const episodes = seasonBlock.find("a").toArray();
    showLink = showPage$(
      episodes.find((el) => parseInt(showPage$(el).text().split(".")[0], 10) === episodeNumber)
    ).attr("href");
  }
  if (!showLink) throw new NotFoundError("Content not found");
  const contentPage = await ctx.proxiedFetcher(showLink, { baseUrl: baseUrl$3 });
  const contentPage$ = load(contentPage);
  const pass = contentPage$("#hId").attr("value");
  if (!pass) throw new NotFoundError("Content not found");
  ctx.progress(50);
  const formData = new URLSearchParams();
  formData.append("pass", pass);
  formData.append("e2", "0");
  formData.append("server", "0");
  const infoEndpoint = ctx.media.type === "show" ? "/home/index/getEInfoAjax" : "/home/index/getMInfoAjax";
  const streamRes = await ctx.proxiedFetcher(infoEndpoint, {
    baseUrl: baseUrl$3,
    method: "POST",
    body: formData,
    headers: {
      referer: `${baseUrl$3}${showLink}`,
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Viewport-Width": "375"
    }
  });
  const streamResJson = JSON.parse(streamRes);
  const captions = [];
  if (Array.isArray(streamResJson.subs)) {
    for (const sub of streamResJson.subs) {
      let language = "";
      if (sub.name.includes(".srt")) {
        const langName = sub.name.split(".srt")[0].trim();
        language = labelToLanguageCode(langName);
      } else if (sub.name.includes(":")) {
        const langName = sub.name.split(":")[0].trim();
        language = labelToLanguageCode(langName);
      } else {
        const langName = sub.name.trim();
        language = labelToLanguageCode(langName);
      }
      if (!language) continue;
      captions.push({
        id: sub.path,
        url: `${baseUrl$3}${sub.path}`,
        type: "srt",
        hasCorsRestrictions: false,
        language
      });
    }
  }
  ctx.progress(90);
  const headers2 = {
    referer: `${baseUrl$3}${showLink}`,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Viewport-Width": "375",
    Origin: baseUrl$3
  };
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        playlist: await convertPlaylistsToDataUrls(ctx.proxiedFetcher, `${baseUrl$3}/${streamResJson.val}`, headers2),
        type: "hls",
        proxyDepth: 2,
        flags: [flags.CORS_ALLOWED],
        captions
      },
      ...streamResJson.val_bak ? [
        {
          id: "backup",
          playlist: await convertPlaylistsToDataUrls(
            ctx.proxiedFetcher,
            `${baseUrl$3}/${streamResJson.val_bak}`,
            headers2
          ),
          type: "hls",
          flags: [flags.CORS_ALLOWED],
          proxyDepth: 2,
          captions
        }
      ] : []
    ]
  };
};
const soaperTvScraper = makeSourcerer({
  id: "soapertv",
  name: "SoaperTV",
  rank: 130,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper
});
const VIDIFY_SERVERS = [
  { name: "Mbox", sr: 17 },
  { name: "Xprime", sr: 15 },
  { name: "Hexo", sr: 8 },
  { name: "Prime", sr: 9 },
  { name: "Nitro", sr: 20 },
  { name: "Meta", sr: 6 },
  { name: "Veasy", sr: 16 },
  { name: "Lux", sr: 26 },
  { name: "Vfast", sr: 11 },
  { name: "Zozo", sr: 7 },
  { name: "Tamil", sr: 13 },
  { name: "Telugu", sr: 14 },
  { name: "Beta", sr: 5 },
  { name: "Alpha", sr: 1 },
  { name: "Vplus", sr: 18 },
  { name: "Cobra", sr: 12 }
];
async function comboScraper$6(ctx) {
  const query = {
    type: ctx.media.type,
    tmdbId: ctx.media.tmdbId,
    ...ctx.media.type === "show" && {
      season: ctx.media.season.number,
      episode: ctx.media.episode.number
    }
  };
  return {
    embeds: VIDIFY_SERVERS.map((server) => ({
      embedId: `vidify-${server.name.toLowerCase()}`,
      url: JSON.stringify({ ...query, sr: server.sr })
    }))
  };
}
const vidifyScraper = makeSourcerer({
  id: "vidify",
  name: "Vidify 🔥",
  rank: 204,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper$6,
  scrapeShow: comboScraper$6
});
const API_BASE = "https://enc-dec.app/api";
const VIDLINK_BASE = "https://vidlink.pro/api/b";
const headers$1 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Connection: "keep-alive",
  Referer: "https://vidlink.pro/",
  Origin: "https://vidlink.pro"
};
async function encryptTmdbId(ctx, tmdbId) {
  const response = await ctx.proxiedFetcher(`${API_BASE}/enc-vidlink`, {
    method: "GET",
    query: { text: tmdbId }
  });
  if (!(response == null ? void 0 : response.result)) {
    throw new NotFoundError("Failed to encrypt TMDB ID");
  }
  return response.result;
}
async function comboScraper$5(ctx) {
  const { tmdbId } = ctx.media;
  ctx.progress(10);
  const encryptedId = await encryptTmdbId(ctx, tmdbId.toString());
  ctx.progress(30);
  const apiUrl = ctx.media.type === "movie" ? `${VIDLINK_BASE}/movie/${encryptedId}` : `${VIDLINK_BASE}/tv/${encryptedId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  const vidlinkRaw = await ctx.proxiedFetcher(apiUrl, {
    headers: headers$1
  });
  if (!vidlinkRaw) {
    throw new NotFoundError("No response from vidlink API");
  }
  ctx.progress(60);
  let vidlinkData;
  try {
    vidlinkData = typeof vidlinkRaw === "string" ? JSON.parse(vidlinkRaw) : vidlinkRaw;
  } catch {
    throw new NotFoundError("Invalid JSON from vidlink API");
  }
  ctx.progress(80);
  if (!vidlinkData.stream) {
    throw new NotFoundError("No stream data found in vidlink response");
  }
  const { stream } = vidlinkData;
  const captions = [];
  if (stream.captions && Array.isArray(stream.captions)) {
    for (const caption of stream.captions) {
      const captionType = caption.type === "srt" ? "srt" : "vtt";
      captions.push({
        id: caption.id || caption.url,
        url: caption.url,
        language: caption.language || "Unknown",
        type: captionType,
        hasCorsRestrictions: caption.hasCorsRestrictions || false
      });
    }
  }
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: stream.id || "primary",
        type: stream.type || "file",
        qualities: stream.qualities || {},
        playlist: stream.playlist,
        captions,
        flags: [],
        headers: stream.headers || headers$1
      }
    ]
  };
}
const vidlinkScraper = makeSourcerer({
  id: "vidlink",
  name: "VidLink 🔥",
  rank: 310,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$5,
  scrapeShow: comboScraper$5
});
async function comboScraper$4(ctx) {
  const query = {
    type: ctx.media.type,
    tmdbId: ctx.media.tmdbId
  };
  if (ctx.media.type === "show") {
    query.season = ctx.media.season.number;
    query.episode = ctx.media.episode.number;
  }
  return {
    embeds: [
      { embedId: "vidnest-hollymoviehd", url: JSON.stringify(query) },
      { embedId: "vidnest-allmovies", url: JSON.stringify(query) }
    ]
  };
}
const vidnestScraper = makeSourcerer({
  id: "vidnest",
  name: "Vidnest",
  rank: 915,
  flags: [],
  disabled: false,
  // The streams cause the site to crash
  scrapeMovie: comboScraper$4,
  scrapeShow: comboScraper$4
});
const headers = {
  Origin: "https://vidrock.ru",
  Referer: "https://vidrock.ru/"
};
const passphrase = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
const key = CryptoJS.enc.Utf8.parse(passphrase);
const iv = CryptoJS.enc.Utf8.parse(passphrase.substring(0, 16));
const baseUrl$2 = "https://vidrock.ru/api";
const userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
async function comboScraper$3(ctx) {
  const itemType = ctx.media.type;
  let itemId;
  if (itemType === "movie") {
    itemId = ctx.media.tmdbId;
  } else {
    itemId = `${ctx.media.tmdbId}_${ctx.media.season.number}_${ctx.media.episode.number}`;
  }
  const encrypted = CryptoJS.AES.encrypt(itemId, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  let encryptedBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  encryptedBase64 = encryptedBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const encoded = encodeURIComponent(encryptedBase64);
  const apiType = itemType === "movie" ? "movie" : "tv";
  const url = `${baseUrl$2}/${apiType}/${encoded}`;
  const res = await ctx.proxiedFetcher(url, {
    headers: {
      ...headers,
      "User-Agent": userAgent
    }
  });
  let parsedRes = res;
  if (typeof res === "string") {
    try {
      parsedRes = JSON.parse(res);
    } catch (e) {
      throw new NotFoundError("No sources found from Vidrock API: Invalid JSON response");
    }
  }
  if (!parsedRes || typeof parsedRes !== "object" || Array.isArray(parsedRes)) {
    throw new NotFoundError("No sources found from Vidrock API: Invalid response");
  }
  const embeds = [];
  const createMirrorEmbed = (serverName, serverData) => {
    if (!(serverData == null ? void 0 : serverData.url)) return null;
    if (serverName.includes("Astra") || serverData.url.includes(".workers.dev")) return null;
    const context = {
      type: "hls",
      stream: serverData.url,
      headers,
      flags: [flags.CORS_ALLOWED],
      captions: []
    };
    return {
      embedId: "mirror",
      url: JSON.stringify(context)
    };
  };
  for (const sourceKey of Object.keys(parsedRes)) {
    const sourceData = parsedRes[sourceKey];
    if ((sourceData == null ? void 0 : sourceData.url) && sourceData.url !== null) {
      if (sourceKey === "Atlas" || sourceData.url.includes("cdn.vidrock.store/playlist/")) {
        try {
          const playlistRes = await ctx.proxiedFetcher(sourceData.url, {
            headers: {
              ...headers,
              "User-Agent": userAgent
            }
          });
          let playlistData = playlistRes;
          if (typeof playlistRes === "string") {
            try {
              playlistData = JSON.parse(playlistRes);
            } catch (e) {
              continue;
            }
          }
          if (Array.isArray(playlistData) && playlistData.length > 0) {
            const qualities = {};
            for (const stream of playlistData) {
              if ((stream == null ? void 0 : stream.url) && (stream == null ? void 0 : stream.resolution)) {
                const resolution = stream.resolution.toString();
                qualities[resolution] = {
                  type: "mp4",
                  url: stream.url
                };
              }
            }
            if (Object.keys(qualities).length > 0) {
              const context = {
                type: "file",
                qualities,
                headers,
                flags: [flags.CORS_ALLOWED],
                captions: []
              };
              embeds.push({
                embedId: "mirror",
                url: JSON.stringify(context)
              });
            }
          }
        } catch (e) {
          continue;
        }
      } else {
        const embed2 = createMirrorEmbed(sourceKey, sourceData);
        if (embed2) embeds.push(embed2);
      }
    }
  }
  if (embeds.length === 0) {
    throw new NotFoundError("No valid sources found from Vidrock API");
  }
  return {
    embeds
  };
}
const vidrockScraper = makeSourcerer({
  id: "vidrock",
  name: "Granite",
  rank: 970,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$3,
  scrapeShow: comboScraper$3
});
async function getEmbeds(id, servers2, ctx) {
  var _a;
  const embeds = [];
  for (const server of servers2.split(",")) {
    await ctx.proxiedFetcher(`/getEmbed.php`, {
      baseUrl: warezcdnBase,
      headers: {
        Referer: `${warezcdnBase}/getEmbed.php?${new URLSearchParams({ id, sv: server })}`
      },
      method: "HEAD",
      query: { id, sv: server }
    });
    const embedPage = await ctx.proxiedFetcher(`/getPlay.php`, {
      baseUrl: warezcdnBase,
      headers: {
        Referer: `${warezcdnBase}/getEmbed.php?${new URLSearchParams({ id, sv: server })}`
      },
      query: { id, sv: server }
    });
    const url = (_a = embedPage.match(/window.location.href\s*=\s*"([^"]+)"/)) == null ? void 0 : _a[1];
    if (url && server === "warezcdn") {
      embeds.push(
        { embedId: warezcdnembedHlsScraper.id, url },
        { embedId: warezcdnembedMp4Scraper.id, url },
        { embedId: warezPlayerScraper.id, url }
      );
    } else if (url && server === "mixdrop") embeds.push({ embedId: mixdropScraper.id, url });
  }
  return { embeds };
}
const warezcdnScraper = makeSourcerer({
  id: "warezcdn",
  name: "WarezCDN",
  disabled: false,
  rank: 115,
  flags: [],
  scrapeMovie: async (ctx) => {
    if (!ctx.media.imdbId) throw new NotFoundError("This source requires IMDB id.");
    const serversPage = await ctx.proxiedFetcher(`/filme/${ctx.media.imdbId}`, {
      baseUrl: warezcdnBase
    });
    const [, id, servers2] = serversPage.match(/let\s+data\s*=\s*'\[\s*\{\s*"id":"([^"]+)".*?"servers":"([^"]+)"/);
    if (!id || !servers2) throw new NotFoundError("Failed to find episode id");
    ctx.progress(40);
    return getEmbeds(id, servers2, ctx);
  }
  // scrapeShow: async (ctx) => {
  //   if (!ctx.media.imdbId) throw new NotFoundError('This source requires IMDB id.');
  //   const url = `${warezcdnBase}/serie/${ctx.media.imdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
  //   const serversPage = await ctx.proxiedFetcher<string>(url);
  //   const seasonsApi = serversPage.match(/var\s+cachedSeasons\s*=\s*"([^"]+)"/)?.[1];
  //   if (!seasonsApi) throw new NotFoundError('Failed to find data');
  //   ctx.progress(40);
  //   const streamsData = await ctx.proxiedFetcher<cachedSeasonsRes>(seasonsApi, {
  //     baseUrl: warezcdnBase,
  //     headers: {
  //       Referer: url,
  //       'X-Requested-With': 'XMLHttpRequest',
  //     },
  //   });
  //   const season = Object.values(streamsData.seasons).find((s) => s.name === ctx.media.season.number.toString());
  //   if (!season) throw new NotFoundError('Failed to find season id');
  //   const episode = Object.values(season.episodes).find((e) => e.name === ctx.media.season.number.toString())?.id;
  //   if (!episode) throw new NotFoundError('Failed to find episode id');
  //   const episodeData = await ctx.proxiedFetcher<string>('/core/ajax.php', {
  //     baseUrl: warezcdnBase,
  //     headers: {
  //       Referer: url,
  //       'X-Requested-With': 'XMLHttpRequest',
  //     },
  //     query: { audios: episode },
  //   });
  //   const [, id, servers] = episodeData.replace(/\\"/g, '"').match(/"\[\s*\{\s*"id":"([^"]+)".*?"servers":"([^"]+)"/)!;
  //   if (!id || !servers) throw new NotFoundError('Failed to find episode id');
  //   return getEmbeds(id, servers, ctx);
  // },
});
const baseUrl$1 = "https://watchanimeworld.in";
const zephyrBaseUrl = "https://play.zephyrflick.top";
const tmdbApiKey = "5b9790d9305dca8713b9a0afad42ea8d";
async function fetchTMDBData(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${tmdbApiKey}`);
  if (!response.ok) {
    throw new NotFoundError("Failed to fetch TMDB data");
  }
  const data = await response.json();
  if (mediaType === "movie") {
    const movieData = data;
    return movieData.title || movieData.original_title;
  }
  const showData = data;
  return showData.name || showData.original_name;
}
function normalizeTitle(title) {
  return title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
}
async function comboScraper$2(ctx) {
  const isTVShow = "season" in ctx.media;
  const endpoint = isTVShow ? "tv" : "movie";
  const title = await fetchTMDBData(ctx.media.tmdbId, endpoint);
  const normalizedTitle = normalizeTitle(title);
  let watchUrl;
  if (ctx.media.type === "movie") {
    watchUrl = `${baseUrl$1}/movies/${normalizedTitle}/`;
  } else {
    const season = ctx.media.season.number;
    const episode = ctx.media.episode.number;
    watchUrl = `${baseUrl$1}/episode/${normalizedTitle}-${season}x${episode}/`;
  }
  ctx.progress(30);
  const watchPage = await ctx.proxiedFetcher(watchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
  });
  const $ = load(watchPage);
  const iframeSrc = $("iframe[data-src]").attr("data-src") || $("iframe[src]").attr("src");
  if (!iframeSrc) {
    throw new NotFoundError("No iframe found on watch page");
  }
  const hashMatch = iframeSrc.match(/\/video\/([a-f0-9]+)/);
  if (!hashMatch) {
    throw new NotFoundError("Could not extract video hash from iframe");
  }
  const videoHash = hashMatch[1];
  ctx.progress(60);
  const apiUrl = `${zephyrBaseUrl}/player/index.php?data=${videoHash}&do=getVideo`;
  const streamResponse = await ctx.proxiedFetcher(apiUrl, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Referer: `${zephyrBaseUrl}/`,
      Origin: zephyrBaseUrl,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: `data=${videoHash}&do=getVideo`
  });
  const streamData = JSON.parse(streamResponse);
  if (!streamData.hls || !streamData.videoSource) {
    throw new NotFoundError("No HLS stream found");
  }
  ctx.progress(90);
  const streamHeaders = {
    Referer: `${zephyrBaseUrl}/`,
    Origin: zephyrBaseUrl,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "hls",
        playlist: streamData.videoSource,
        headers: streamHeaders,
        flags: [flags.CORS_ALLOWED],
        captions: []
      }
    ]
  };
}
const watchanimeworldScraper = makeSourcerer({
  id: "watchanimeworld",
  name: "WatchAnimeWorld",
  rank: 116,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$2,
  scrapeShow: comboScraper$2
});
const baseUrl = "https://wecima.tube";
async function comboScraper$1(ctx) {
  const searchPage = await ctx.proxiedFetcher(`/search/${encodeURIComponent(ctx.media.title)}/`, {
    baseUrl
  });
  const search$ = load(searchPage);
  const firstResult = search$(".Grid--WecimaPosts .GridItem a").first();
  if (!firstResult.length) throw new NotFoundError("No results found");
  const contentUrl = firstResult.attr("href");
  if (!contentUrl) throw new NotFoundError("No content URL found");
  ctx.progress(30);
  const contentPage = await ctx.proxiedFetcher(contentUrl, { baseUrl });
  const content$ = load(contentPage);
  let embedUrl;
  if (ctx.media.type === "movie") {
    embedUrl = content$('meta[itemprop="embedURL"]').attr("content");
  } else {
    const seasonLinks = content$(".List--Seasons--Episodes a");
    let seasonUrl;
    for (const element of seasonLinks) {
      const text = content$(element).text().trim();
      if (text.includes(`موسم ${ctx.media.season}`)) {
        seasonUrl = content$(element).attr("href");
        break;
      }
    }
    if (!seasonUrl) throw new NotFoundError(`Season ${ctx.media.season} not found`);
    const seasonPage = await ctx.proxiedFetcher(seasonUrl, { baseUrl });
    const season$ = load(seasonPage);
    const episodeLinks = season$(".Episodes--Seasons--Episodes a");
    for (const element of episodeLinks) {
      const epTitle = season$(element).find("episodetitle").text().trim();
      if (epTitle === `الحلقة ${ctx.media.episode}`) {
        const episodeUrl = season$(element).attr("href");
        if (episodeUrl) {
          const episodePage = await ctx.proxiedFetcher(episodeUrl, { baseUrl });
          const episode$ = load(episodePage);
          embedUrl = episode$('meta[itemprop="embedURL"]').attr("content");
        }
        break;
      }
    }
  }
  if (!embedUrl) throw new NotFoundError("No embed URL found");
  ctx.progress(60);
  const embedPage = await ctx.proxiedFetcher(embedUrl);
  const embed$ = load(embedPage);
  const videoSource = embed$('source[type="video/mp4"]').attr("src");
  if (!videoSource) throw new NotFoundError("No video source found");
  ctx.progress(90);
  return {
    embeds: [],
    stream: [
      {
        id: "primary",
        type: "file",
        flags: [],
        headers: {
          referer: baseUrl
        },
        qualities: {
          unknown: {
            type: "mp4",
            url: videoSource
          }
        },
        captions: []
      }
    ]
  };
}
const wecimaScraper = makeSourcerer({
  id: "wecima",
  name: "Wecima (Arabic)",
  rank: 3,
  disabled: false,
  flags: [],
  scrapeMovie: comboScraper$1,
  scrapeShow: comboScraper$1
});
async function comboScraper(ctx) {
  const anilistId = await getAnilistIdFromMedia(ctx, ctx.media);
  const query = {
    type: ctx.media.type,
    title: ctx.media.title,
    tmdbId: ctx.media.tmdbId,
    imdbId: ctx.media.imdbId,
    anilistId,
    ...ctx.media.type === "show" && {
      season: ctx.media.season.number,
      episode: ctx.media.episode.number
    },
    ...ctx.media.type === "movie" && { episode: 1 },
    releaseYear: ctx.media.releaseYear
  };
  return {
    embeds: [
      {
        embedId: "zunime-hd-2",
        url: JSON.stringify(query)
      },
      {
        embedId: "zunime-miko",
        url: JSON.stringify(query)
      },
      {
        embedId: "zunime-shiro",
        url: JSON.stringify(query)
      },
      {
        embedId: "zunime-zaza",
        url: JSON.stringify(query)
      }
    ]
  };
}
const zunimeScraper = makeSourcerer({
  id: "zunime",
  name: "Zunime",
  rank: 114,
  flags: [],
  scrapeShow: comboScraper
});
function gatherAllSources() {
  return [
    fsOnlineScraper,
    cuevana3Scraper,
    ridooMoviesScraper,
    hdRezkaScraper,
    warezcdnScraper,
    insertunitScraper,
    soaperTvScraper,
    myanimeScraper,
    tugaflixScraper,
    ee3Scraper,
    fsharetvScraper,
    slidemoviesScraper,
    coitusScraper,
    nunflixScraper,
    EightStreamScraper,
    wecimaScraper,
    animeflvScraper,
    animekaiScraper,
    FedAPIScraper,
    FedAPIDBScraper,
    vidsrcvipScraper,
    vidifyScraper,
    zunimeScraper,
    vidnestScraper,
    animetsuScraper,
    lookmovieScraper,
    pelisplushdScraper,
    movies4fScraper,
    debridScraper,
    cinehdplusScraper,
    cinesuScraper,
    meowtvScraper,
    icefyScraper,
    vixsrcScraper,
    vidzeeScraper,
    videasyScraper,
    vidfastScraper,
    vidkingScraper,
    cinezoScraper,
    fullhdfilmizleScraper,
    vidlinkScraper,
    vidrockScraper,
    watchanimeworldScraper,
    multiembedScraper
  ];
}
function gatherAllEmbeds() {
  return [
    ...fsOnlineEmbeds,
    serverMirrorEmbed,
    upcloudScraper,
    vidCloudScraper,
    mixdropScraper,
    ridooScraper,
    closeLoadScraper,
    doodScraper,
    streamvidScraper,
    streamtapeScraper,
    warezcdnembedHlsScraper,
    warezcdnembedMp4Scraper,
    warezPlayerScraper,
    streambucketScraper,
    VidsrcsuServer1Scraper,
    VidsrcsuServer2Scraper,
    VidsrcsuServer3Scraper,
    VidsrcsuServer4Scraper,
    VidsrcsuServer5Scraper,
    VidsrcsuServer6Scraper,
    VidsrcsuServer7Scraper,
    VidsrcsuServer8Scraper,
    VidsrcsuServer9Scraper,
    VidsrcsuServer10Scraper,
    VidsrcsuServer11Scraper,
    VidsrcsuServer12Scraper,
    VidsrcsuServer20Scraper,
    viperScraper,
    streamwishJapaneseScraper,
    streamwishLatinoScraper,
    streamwishSpanishScraper,
    streamwishEnglishScraper,
    streamtapeLatinoScraper,
    ...cinemaosEmbeds,
    // ...cinemaosHexaEmbeds,
    // vidsrcNovaEmbed,
    // vidsrcCometEmbed,
    // vidsrcPulsarEmbed,
    ...vidifyEmbeds,
    ...zunimeEmbeds,
    ...AnimetsuEmbeds,
    ...VidnestEmbeds,
    myanimesubScraper,
    myanimedubScraper,
    filemoonScraper,
    vidhideLatinoScraper,
    vidhideSpanishScraper,
    vidhideEnglishScraper,
    filelionsScraper,
    droploadScraper,
    supervideoScraper,
    voeScraper,
    AnimekaiScraper,
    videasyYoruEmbed,
    videasyNeonEmbed,
    videasyBreachEmbed,
    videasyCypherEmbed,
    videasySageEmbed,
    videasyVyseEmbed,
    videasyOmenEmbed,
    videasyRazeEmbed,
    videasyFadeEmbed,
    videasyKilljoyEmbed,
    vidfastAlphaEmbed,
    vidfastBetaEmbed,
    vidfastOscarEmbed,
    vidfastMaxEmbed,
    vidfastIronEmbed,
    vidfastCharlieEmbed,
    vidfastCobraEmbed,
    vidfastViperEmbed,
    vidfastRangerEmbed,
    vidfastSpecterEmbed,
    vidfastEchoEmbed,
    vidfastVodkaEmbed,
    vidfastPabloEmbed,
    vidfastLocoEmbed,
    vidfastSambaEmbed,
    vidfastBollywoodEmbed,
    vidfastKiritoEmbed,
    vidfastMeliodasEmbed,
    vidfastVefastEmbed
  ];
}
function getBuiltinSources() {
  return gatherAllSources().filter((v) => !v.disabled && !v.externalSource);
}
function getBuiltinExternalSources() {
  return gatherAllSources().filter((v) => v.externalSource && !v.disabled);
}
function getBuiltinEmbeds() {
  return gatherAllEmbeds().filter((v) => !v.disabled);
}
function findDuplicates(items, keyFn) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key2 = keyFn(item);
    if (!groups.has(key2)) {
      groups.set(key2, []);
    }
    groups.get(key2).push(item);
  }
  return Array.from(groups.entries()).filter(([_, groupItems]) => groupItems.length > 1).map(([key2, groupItems]) => ({ key: key2, items: groupItems }));
}
function formatDuplicateError(type, duplicates, keyName) {
  const duplicateList = duplicates.map(({ key: key2, items }) => {
    const itemNames = items.map((item) => item.name || item.id).join(", ");
    return `  ${keyName} ${key2}: ${itemNames}`;
  }).join("\n");
  return `${type} have duplicate ${keyName}s:
${duplicateList}`;
}
function getProviders(features, list) {
  const sources = list.sources.filter((v) => !(v == null ? void 0 : v.disabled));
  const embeds = list.embeds.filter((v) => !(v == null ? void 0 : v.disabled));
  const combined = [...sources, ...embeds];
  const duplicateIds = findDuplicates(combined, (v) => v.id);
  if (duplicateIds.length > 0) {
    throw new Error(formatDuplicateError("Sources/embeds", duplicateIds, "ID"));
  }
  const duplicateSourceRanks = findDuplicates(sources, (v) => v.rank);
  if (duplicateSourceRanks.length > 0) {
    throw new Error(formatDuplicateError("Sources", duplicateSourceRanks, "rank"));
  }
  const duplicateEmbedRanks = findDuplicates(embeds, (v) => v.rank);
  if (duplicateEmbedRanks.length > 0) {
    throw new Error(formatDuplicateError("Embeds", duplicateEmbedRanks, "rank"));
  }
  return {
    sources: sources.filter((s) => flagsAllowedInFeatures(features, s.flags)),
    embeds: embeds.filter((e) => flagsAllowedInFeatures(features, e.flags))
  };
}
function makeProviders(ops) {
  var _a;
  const features = getTargetFeatures(
    ops.proxyStreams ? "any" : ops.target,
    ops.consistentIpForRequests ?? false,
    ops.proxyStreams
  );
  const sources = [...getBuiltinSources()];
  if (ops.externalSources === "all") sources.push(...getBuiltinExternalSources());
  else {
    (_a = ops.externalSources) == null ? void 0 : _a.forEach((source) => {
      const matchingSource = getBuiltinExternalSources().find((v) => v.id === source);
      if (!matchingSource) return;
      sources.push(matchingSource);
    });
  }
  const list = getProviders(features, {
    embeds: getBuiltinEmbeds(),
    sources
  });
  return makeControls({
    embeds: list.embeds,
    sources: list.sources,
    features,
    fetcher: ops.fetcher,
    proxiedFetcher: ops.proxiedFetcher,
    proxyStreams: ops.proxyStreams
  });
}
function buildProviders() {
  let consistentIpForRequests = false;
  let target = null;
  let fetcher = null;
  let proxiedFetcher = null;
  const embeds = [];
  const sources = [];
  const builtinSources = getBuiltinSources();
  const builtinExternalSources = getBuiltinExternalSources();
  const builtinEmbeds = getBuiltinEmbeds();
  return {
    enableConsistentIpForRequests() {
      consistentIpForRequests = true;
      return this;
    },
    setFetcher(f) {
      fetcher = f;
      return this;
    },
    setProxiedFetcher(f) {
      proxiedFetcher = f;
      return this;
    },
    setTarget(t) {
      target = t;
      return this;
    },
    addSource(input) {
      if (typeof input !== "string") {
        sources.push(input);
        return this;
      }
      const matchingSource = [...builtinSources, ...builtinExternalSources].find((v) => v.id === input);
      if (!matchingSource) throw new Error("Source not found");
      sources.push(matchingSource);
      return this;
    },
    addEmbed(input) {
      if (typeof input !== "string") {
        embeds.push(input);
        return this;
      }
      const matchingEmbed = builtinEmbeds.find((v) => v.id === input);
      if (!matchingEmbed) throw new Error("Embed not found");
      embeds.push(matchingEmbed);
      return this;
    },
    addBuiltinProviders() {
      sources.push(...builtinSources);
      embeds.push(...builtinEmbeds);
      return this;
    },
    build() {
      if (!target) throw new Error("Target not set");
      if (!fetcher) throw new Error("Fetcher not set");
      const features = getTargetFeatures(target, consistentIpForRequests);
      const list = getProviders(features, {
        embeds,
        sources
      });
      return makeControls({
        fetcher,
        proxiedFetcher: proxiedFetcher ?? void 0,
        embeds: list.embeds,
        sources: list.sources,
        features
      });
    }
  };
}
const isReactNative = () => {
  try {
    require("react-native");
    return true;
  } catch (e) {
    return false;
  }
};
function serializeBody(body) {
  if (body === void 0 || typeof body === "string" || body instanceof URLSearchParams || body instanceof FormData) {
    if (body instanceof URLSearchParams && isReactNative()) {
      return {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      };
    }
    return {
      headers: {},
      body
    };
  }
  return {
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}
function getHeaders(list, res) {
  const output = new Headers();
  list.forEach((header) => {
    var _a;
    const realHeader = header.toLowerCase();
    const realValue = res.headers.get(realHeader);
    const extraValue = (_a = res.extraHeaders) == null ? void 0 : _a.get(realHeader);
    const value = extraValue ?? realValue;
    if (!value) return;
    output.set(realHeader, value);
  });
  return output;
}
function makeStandardFetcher(f) {
  const normalFetch = async (url, ops) => {
    var _a;
    const fullUrl = makeFullUrl(url, ops);
    const seralizedBody = serializeBody(ops.body);
    const controller = new AbortController();
    const timeout = 15e3;
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await f(fullUrl, {
        method: ops.method,
        headers: {
          ...seralizedBody.headers,
          ...ops.headers
        },
        body: seralizedBody.body,
        credentials: ops.credentials,
        signal: controller.signal
        // Pass the signal to fetch
      });
      clearTimeout(timeoutId);
      let body;
      const contentType = (_a = res.headers.get("content-type")) == null ? void 0 : _a.toLowerCase();
      const isJson = contentType == null ? void 0 : contentType.includes("application/json");
      const isBinary = (contentType == null ? void 0 : contentType.includes("application/wasm")) || (contentType == null ? void 0 : contentType.includes("application/octet-stream")) || (contentType == null ? void 0 : contentType.includes("binary"));
      if (res.status === 204) {
        body = null;
      } else if (isJson) {
        body = await res.json();
      } else if (isBinary) {
        body = await res.arrayBuffer();
      } else {
        body = await res.text();
      }
      return {
        body,
        finalUrl: res.extraUrl ?? res.url,
        headers: getHeaders(ops.readHeaders, res),
        statusCode: res.status
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Fetch request to ${fullUrl} timed out after ${timeout}ms`);
      }
      throw error;
    }
  };
  return normalFetch;
}
const headerMap = {
  cookie: "X-Cookie",
  referer: "X-Referer",
  origin: "X-Origin",
  "user-agent": "X-User-Agent",
  "x-real-ip": "X-X-Real-Ip"
};
const responseHeaderMap = {
  "x-set-cookie": "Set-Cookie"
};
function makeSimpleProxyFetcher(proxyUrl, f) {
  const proxiedFetch = async (url, ops) => {
    const fetcher = makeStandardFetcher(async (a, b) => {
      const controller = new AbortController();
      const timeout = 2e4;
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await f(a, {
          method: (b == null ? void 0 : b.method) || "GET",
          headers: (b == null ? void 0 : b.headers) || {},
          body: b == null ? void 0 : b.body,
          credentials: b == null ? void 0 : b.credentials,
          signal: controller.signal
          // Pass the signal to fetch
        });
        clearTimeout(timeoutId);
        res.extraHeaders = new Headers();
        Object.entries(responseHeaderMap).forEach((entry) => {
          var _a;
          const value = res.headers.get(entry[0]);
          if (!value) return;
          (_a = res.extraHeaders) == null ? void 0 : _a.set(entry[1].toLowerCase(), value);
        });
        res.extraUrl = res.headers.get("X-Final-Destination") ?? res.url;
        return res;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error(`Fetch request to ${a} timed out after ${timeout}ms`);
        }
        throw error;
      }
    });
    const fullUrl = makeFullUrl(url, ops);
    const headerEntries = Object.entries(ops.headers).map((entry) => {
      const key2 = entry[0].toLowerCase();
      if (headerMap[key2]) return [headerMap[key2], entry[1]];
      return entry;
    });
    return fetcher(proxyUrl, {
      ...ops,
      query: {
        destination: fullUrl
      },
      headers: Object.fromEntries(headerEntries),
      baseUrl: void 0
    });
  };
  return proxiedFetch;
}
export {
  NotFoundError,
  buildProviders,
  createM3U8ProxyUrl,
  flags,
  getBuiltinEmbeds,
  getBuiltinExternalSources,
  getBuiltinSources,
  getM3U8ProxyUrl,
  labelToLanguageCode,
  makeProviders,
  makeSimpleProxyFetcher,
  makeStandardFetcher,
  setM3U8ProxyUrl,
  targets,
  updateM3U8ProxyUrl
};
