import { Embed, Sourcerer } from '@/providers/base';
import { doodScraper } from '@/providers/embeds/dood';
import { filemoonScraper } from '@/providers/embeds/filemoon';
import { mixdropScraper } from '@/providers/embeds/mixdrop';
import { serverMirrorEmbed } from '@/providers/embeds/server-mirrors';
import { upcloudScraper } from '@/providers/embeds/upcloud';
import { fsharetvScraper } from '@/providers/sources/fsharetv';
import { fsOnlineEmbeds, fsOnlineScraper } from '@/providers/sources/fsonline/index';
import { tugaflixScraper } from '@/providers/sources/tugaflix';
import { vidsrcScraper } from '@/providers/sources/vidsrc';
import { streambucketScraper } from '@/providers/embeds/streambucket';

import { AnimetsuEmbeds } from './embeds/animetsu';
import { cinemaosEmbeds } from './embeds/cinemaos';
import { closeLoadScraper } from './embeds/closeload';
import { droploadScraper } from './embeds/dropload';
import { filelionsScraper } from './embeds/filelions';
import { myanimedubScraper } from './embeds/myanimedub';
import { myanimesubScraper } from './embeds/myanimesub';
import { ridooScraper } from './embeds/ridoo';
import { streamtapeLatinoScraper, streamtapeScraper } from './embeds/streamtape';
import { streamvidScraper } from './embeds/streamvid';
import {
  streamwishEnglishScraper,
  streamwishJapaneseScraper,
  streamwishLatinoScraper,
  streamwishSpanishScraper,
} from './embeds/streamwish';
import { supervideoScraper } from './embeds/supervideo';
import { vidCloudScraper } from './embeds/vidcloud';
import { vidhideEnglishScraper, vidhideLatinoScraper, vidhideSpanishScraper } from './embeds/vidhide';
import { VidnestEmbeds } from './embeds/vidnest';
import {
  VidsrcsuServer10Scraper,
  VidsrcsuServer11Scraper,
  VidsrcsuServer12Scraper,
  VidsrcsuServer1Scraper,
  VidsrcsuServer20Scraper,
  VidsrcsuServer2Scraper,
  VidsrcsuServer3Scraper,
  VidsrcsuServer4Scraper,
  VidsrcsuServer5Scraper,
  VidsrcsuServer6Scraper,
  VidsrcsuServer7Scraper,
  VidsrcsuServer8Scraper,
  VidsrcsuServer9Scraper,
} from './embeds/vidsrcsu';
import { viperScraper } from './embeds/viper';
import { voeScraper } from './embeds/voe';
import { zunimeEmbeds } from './embeds/zunime';
import {
  xprimeFingerEmbed,
  xprimePrimeboxEmbed,
  xprimeKingEmbed,
  xprimeFacileEmbed,
  xprimeLighterEmbed,
  xprimeFedEmbed,
  xprimeEekEmbed,
} from './embeds/xprime';
import {
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
} from './embeds/videasy';
import {
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
  vidfastVefastEmbed,
} from './embeds/vidfast';

import { animeflvScraper } from './sources/animeflv';
import { animetsuScraper } from './sources/animetsu';
import { cinehdplusScraper } from './sources/cinehdplus-es';
import { cinesuScraper } from './sources/cinesu';
import { meowtvScraper } from './sources/meowtv';
import { icefyScraper } from './sources/icefy';
import { vixsrcScraper } from './sources/vixsrc';
import { vidzeeScraper } from './sources/vidzee';
import { videasyScraper } from './sources/videasy';
import { xprimeScraper } from './sources/xprime';
import { vidfastScraper } from './sources/vidfast';
import { vidkingScraper } from './sources/vidking';
import { cinezoScraper } from './sources/cinezo';
import { coitusScraper } from './sources/coitus';
import { debridScraper } from './sources/debrid';
import { fullhdfilmizleScraper } from './sources/fullhdfilmizle';
import { hdRezkaScraper } from './sources/hdrezka';
import { lookmovieScraper } from './sources/lookmovie';
import { myanimeScraper } from './sources/myanime';
import { pelisplushdScraper } from './sources/pelisplushd';
import { ridooMoviesScraper } from './sources/ridomovies';
import { soaperTvScraper } from './sources/soapertv';
import { vidlinkScraper } from './sources/vidlink';
import { vidnestScraper } from './sources/vidnest';
import { vidrockScraper } from './sources/vidrock';
import { watchanimeworldScraper } from './sources/watchanimeworld';
import { wecimaScraper } from './sources/wecima';
import { zunimeScraper } from './sources/zunime';

export function gatherAllSources(): Array<Sourcerer> {
  // all sources are gathered here
  return [
    xprimeScraper,
    fsOnlineScraper,
    ridooMoviesScraper,
    hdRezkaScraper,
    soaperTvScraper,
    myanimeScraper,
    tugaflixScraper,
    fsharetvScraper,
    coitusScraper,
    wecimaScraper,
    animeflvScraper,
    vidsrcScraper,
    zunimeScraper,
    vidnestScraper,
    animetsuScraper,
    lookmovieScraper,
    pelisplushdScraper,
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
  ];
}

export function gatherAllEmbeds(): Array<Embed> {
  // all embeds are gathered here
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
    xprimeFingerEmbed,
    xprimePrimeboxEmbed,
    xprimeKingEmbed,
    xprimeFacileEmbed,
    xprimeLighterEmbed,
    xprimeFedEmbed,
    xprimeEekEmbed,
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
    vidfastVefastEmbed,
  ];
}
