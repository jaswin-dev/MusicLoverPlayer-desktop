

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { AudioLines, LoaderCircle, Music2 } from 'lucide-react';



const LRCLIB = 'https://lrclib.net/api';

// Album artwork lookup: Deezer -> iTunes -> MusicBrainz/Cover Art Archive -> Last.fm.
// Results are cached for this browser session to avoid repeating provider requests.
const albumCoverCache = new Map();

function normalizeCoverText(value = '') {
  return String(value).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function coverMatchScore(resultTitle, resultArtist, track) {
  const title = normalizeCoverText(track.title || track.name);
  const artist = normalizeCoverText(track.artist || track.artistName);
  const candidateTitle = normalizeCoverText(resultTitle);
  const candidateArtist = normalizeCoverText(resultArtist);
  let score = 0;
  if (title && candidateTitle === title) score += 6;
  else if (title && (candidateTitle.includes(title) || title.includes(candidateTitle))) score += 3;
  if (artist && candidateArtist === artist) score += 6;
  else if (artist && (candidateArtist.includes(artist) || artist.includes(candidateArtist))) score += 3;
  return score;
}

async function fetchCoverJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Cover provider returned ${response.status}`);
  return response.json();
}

function getTrackAlbumCover(track) {
  return track?.coverUrl || track?.artworkUrl || track?.albumCover ||
    track?.cover || track?.artwork || track?.image || track?.picture || '';
}

async function findAlbumCover(track, signal) {
  const title = String(track?.title || track?.name || '').trim();
  const artist = String(track?.artist || track?.artistName || '').trim();
  const album = String(track?.album || track?.albumName || '').trim();
  if (!title && !album) return '';

  const cacheKey = normalizeCoverText(`${title}|${artist}|${album}`);
  if (albumCoverCache.has(cacheKey)) return albumCoverCache.get(cacheKey);

  const remember = url => {
    if (url) albumCoverCache.set(cacheKey, url);
    return url || '';
  };

  // 1. Deezer: match both track and artist before accepting its album image.
  try {
    const query = [title && `track:"${title}"`, artist && `artist:"${artist}"`]
      .filter(Boolean).join(' ');
    const data = await fetchCoverJson(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}`,
      signal
    );
    const matches = (data?.data || []).map(item => ({
      score: coverMatchScore(item.title, item.artist?.name, track),
      url: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium,
    })).filter(item => item.url).sort((a, b) => b.score - a.score);
    if (matches[0]?.score >= 9) return remember(matches[0].url);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }

  // 2. Apple iTunes Search API.
  try {
    const term = [title, artist, album].filter(Boolean).join(' ');
    const data = await fetchCoverJson(
      `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(term)}`,
      signal
    );
    const matches = (data?.results || []).map(item => ({
      score: coverMatchScore(item.trackName, item.artistName, track),
      url: item.artworkUrl100?.replace(/100x100bb/i, '600x600bb') || item.artworkUrl100,
    })).filter(item => item.url).sort((a, b) => b.score - a.score);
    if (matches[0]?.score >= 9) return remember(matches[0].url);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }

  // 3. MusicBrainz release search, then the Cover Art Archive front image.
  try {
    const terms = [
      album && `release:"${album}"`,
      artist && `artist:"${artist}"`,
      !album && title && `recording:"${title}"`,
    ].filter(Boolean).join(' AND ');
    const data = await fetchCoverJson(
      `https://musicbrainz.org/ws/2/release/?fmt=json&limit=5&query=${encodeURIComponent(terms)}`,
      signal
    );
    const releases = (data?.releases || []).map(release => ({
      id: release.id,
      score: coverMatchScore(release.title, (release['artist-credit'] || [])
        .map(credit => credit.name || credit.artist?.name || '').join(' '), track),
    })).filter(item => item.id).sort((a, b) => b.score - a.score);
    for (const release of releases) {
      if (release.score < 9) continue;
      try {
        const coverResponse = await fetch(
          `https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-500`,
          { signal, redirect: 'follow' }
        );
        if (coverResponse.ok) return remember(coverResponse.url ||
          `https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-500`);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }

  // 4. Last.fm requires a public API key configured in VITE_LASTFM_API_KEY.
  try {
    const apiKey = import.meta.env?.VITE_LASTFM_API_KEY;
    if (apiKey && title && artist) {
      const data = await fetchCoverJson(
        `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${encodeURIComponent(apiKey)}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json`,
        signal
      );
      const images = data?.track?.album?.image || [];
      const imageUrl = images.find(image => image.size === 'extralarge')?.['#text'] ||
        images.find(image => image.size === 'large')?.['#text'] ||
        [...images].reverse().find(image => image['#text'])?.['#text'];
      if (imageUrl) return remember(imageUrl);
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }

  albumCoverCache.set(cacheKey, '');
  return '';
}


// Resolve the audio format from track metadata or filename.
function getTrackAudioFormat(track) {
  if (!track) return '';
  const candidates = [track.format, track.fileFormat, track.audioFormat, track.codec,
    track.mimeType, track.contentType, track.fileName, track.filename, track.name,
    track.url, track.src, track.streamUrl].filter(v => typeof v === 'string' && v.trim());
  const formats = { mpeg: 'MP3', mp3: 'MP3', mp4: 'M4A', m4a: 'M4A', aac: 'AAC',
    flac: 'FLAC', wav: 'WAV', wave: 'WAV', ogg: 'OGG', oga: 'OGG', opus: 'OPUS',
    webm: 'WEBM', aiff: 'AIFF', aif: 'AIFF', alac: 'ALAC' };
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase();
    const mime = value.match(/audio\/([a-z0-9.+-]+)/);
    const extension = value.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/);
    const detected = (mime?.[1] || extension?.[1] || value).replace(/^x-/, '').replace(/^audio\//, '');
    if (formats[detected]) return formats[detected];
  }
  return '';
}

// Detect Dolby Atmos only from explicit Atmos/JOC metadata, not from channel count alone.
function isDolbyAtmosTrack(track) {
  if (!track) return false;

  const explicitFlags = [
    track.isDolbyAtmos, track.dolbyAtmos, track.atmos, track.hasDolbyAtmos,
    track.isAtmos, track.spatialAudio,
  ];
  if (explicitFlags.some(value => value === true || value === 1 || value === 'true')) return true;

  const metadata = [
    track.audioFormat, track.format, track.codec, track.audioCodec,
    track.codecName, track.codec_name, track.codecString, track.codec_string,
    track.profile, track.audioProfile, track.audio_profile,
    track.mimeType, track.contentType, track.fileName, track.filename,
    track.description, track.audioDescription, track.quality,
  ].filter(value => typeof value === 'string').join(' ').toLowerCase();

  // Dolby Digital Plus Atmos is signalled by E-AC-3 with the JOC extension.
  // TrueHD Atmos and other Atmos profiles must be explicitly identified.
  return /dolby[\s_-]*atmos|\batmos\b|e[- ]?ac[- ]?3[^\n]*\bjoc\b|\bec[- ]?3[^\n]*\bjoc\b|\bjoc\b[^\n]*e[- ]?ac[- ]?3|\bjoc\b[^\n]*\bec[- ]?3/.test(metadata);
}

// Return a display bitrate only when it can be derived from reliable metadata.
function getTrackBitrate(track) {
  if (!track) return '';

  const rawBitrate = track.bitrate ?? track.bitRate ?? track.audioBitrate ??
    track.bit_rate ?? track.bitrateKbps ?? track.audio_bitrate;
  if (Number.isFinite(Number(rawBitrate)) && Number(rawBitrate) > 0) {
    const value = Number(rawBitrate);
    // Metadata APIs commonly report bits/s; an explicitly named kbps field is already kbps.
    const kbps = track.bitrateKbps != null ? value : value >= 10000 ? value / 1000 : value;
    return `${Math.round(kbps).toLocaleString()} kbps`;
  }

  const durationRaw = track.durationSeconds ?? track.duration ?? track.length;
  const duration = Number(durationRaw);
  const durationSeconds = Number.isFinite(duration) && duration > 0
    ? (duration > 100000 ? duration / 1000 : duration)
    : 0;
  const sizeRaw = track.fileSize ?? track.size ?? track.contentLength ?? track.bytes ?? track.file_size;
  const sizeBytes = Number(sizeRaw);
  if (durationSeconds > 0 && Number.isFinite(sizeBytes) && sizeBytes > 0) {
    return `~${Math.round((sizeBytes * 8) / durationSeconds / 1000).toLocaleString()} kbps`;
  }

  // For uncompressed PCM WAV, bitrate is determined by sample rate, bit depth and channels.
  const format = getTrackAudioFormat(track);
  const sampleRate = Number(track.sampleRate ?? track.sample_rate);
  const bitDepth = Number(track.bitDepth ?? track.bitsPerSample ?? track.bit_depth);
  const channels = Number(track.channels ?? track.channelCount ?? track.channel_count);
  if (format === 'WAV' && sampleRate > 0 && bitDepth > 0 && channels > 0) {
    return `${Math.round((sampleRate * bitDepth * channels) / 1000).toLocaleString()} kbps`;
  }
  return '';
}

function getTrackAudioDetails(track) {
  if (!track) return '';
  const details = [];
  const bitDepth = Number(track.bitDepth ?? track.bitsPerSample ?? track.bit_depth);
  const sampleRate = Number(track.sampleRate ?? track.sample_rate);
  const channels = Number(track.channels ?? track.channelCount ?? track.channel_count);
  if (bitDepth > 0) details.push(`${bitDepth}-bit`);
  if (sampleRate > 0) details.push(`${sampleRate >= 1000 ? (sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0) + ' kHz' : sampleRate + ' Hz'}`);
  if (channels > 0) details.push(channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels} channels`);
  return details.join(' · ');
}




// ======================================================

// PARSE LYRICS

// ======================================================



function parseLyrics(value = '') {

  return value

    .split(/\r?\n/)

    .map((raw, index) => {

      const matches = [

        ...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g),

      ];



      const text = raw

        .replace(/\[(\d{1,2}):\d{2}(?:\.\d{1,3})?\]/g, '')

        .trim();



      if (!text) return null;



      // Multiple timestamps on one line are supported.

      if (matches.length) {

        return matches.map(match => ({

          time: Number(match[1]) * 60 + Number(match[2]),

          text,

          index,

        }));

      }



      // Plain lyrics have no timestamps.

      return [{

        time: null,

        text,

        index,

      }];

    })

    .flat()

    .filter(Boolean)

    .sort((a, b) => {

      if (a.time === null && b.time === null) {

        return a.index - b.index;

      }



      if (a.time === null) return 1;

      if (b.time === null) return -1;



      return a.time - b.time;

    });

}



// ======================================================

// LANGUAGE DETECTION

// ======================================================



function isTamilLyrics(value = '') {

  return /[\u0B80-\u0BFF]/.test(value);

}



function isTanglishLyrics(value = '') {

  if (!value || isTamilLyrics(value)) return false;



  const words = value.toLowerCase().match(/[a-z]+/g) || [];



  const tamilWords = new Set([

    'naan', 'nee', 'neenga', 'enna', 'ennoda',

    'enakku', 'unakku', 'unnai', 'unnoda',

    'kadhal', 'kaadhal', 'kadhale', 'uyire', 'uyir',

    'manam', 'nenjam', 'nenjil', 'kann', 'kanne',

    'azhaga', 'azhage', 'vizhi', 'vizhiyil',

    'mazhai', 'nilave', 'nilavu', 'penne',

    'idhayam', 'idhu', 'adhu', 'oru',

    'illai', 'illa', 'irukku', 'irukkum',

    'thaan', 'dhaan', 'aasai', 'solla', 'sollu',

    'solladi', 'vandha', 'vandhen', 'varuven',

    'pogiren', 'poga', 'vaa', 'va', 'poda',

    'kanavu', 'inime', 'inbam', 'thanimai',

    'vaazhkai', 'mella', 'mounam', 'unnala',

    'ennai', 'anbe', 'anbu', 'kanna',

    'kaatru', 'kangal', 'paarvai', 'paadum',

    'thozhi', 'thozhan', 'manasa', 'chellam',

  ]);



  const matches = words.filter(word => tamilWords.has(word));



  return matches.length >= 2 ||

    (matches.length >= 1 && words.length <= 12);

}



function getLyricsLanguage(value = '') {

  if (isTamilLyrics(value)) return 'ta';

  if (isTanglishLyrics(value)) return 'tanglish';



  return 'unknown';

}



// ======================================================

// NORMALIZE SEARCH TEXT

// ======================================================



function normalize(value = '') {

  return value

    .toLowerCase()

    .replace(/[^\p{L}\p{N}\s]/gu, '')

    .replace(/\s+/g, ' ')

    .trim();

}



// ======================================================

// MATCH SCORING

// ======================================================



function scoreMatch(item, track) {

  const title = normalize(track.title);

  const artist = normalize(track.artist);



  const resultTitle = normalize(item.trackName);

  const resultArtist = normalize(item.artistName);



  let score = 0;



  if (resultTitle === title) {

    score += 10;

  } else if (

    resultTitle.includes(title) ||

    title.includes(resultTitle)

  ) {

    score += 5;

  }



  if (resultArtist === artist) {

    score += 10;

  } else if (

    resultArtist.includes(artist) ||

    artist.includes(resultArtist)

  ) {

    score += 5;

  }



  // Prefer synchronized lyrics.

  if (item.syncedLyrics?.trim()) {

    score += 3;

  }



  return score;

}



// ======================================================

// LRCLIB FETCH

// ======================================================



async function fetchLyricsJSON(url, signal) {

  const response = await fetch(url, {

    signal,

    headers: {

      Accept: 'application/json',

    },

  });



  if (!response.ok) {

    throw new Error('Lyrics not found.');

  }



  return response.json();

}



// ======================================================

// REMOVE DUPLICATE RESULTS

// ======================================================



function uniqueResults(items) {

  return [

    ...new Map(

      items.map(item => [

        `${item.id}-${item.trackName}-${item.artistName}`,

        item,

      ])

    ).values(),

  ];

}



// ======================================================

// FIND BEST LYRICS MATCH

// ======================================================



function findBestMatch(

  candidates,

  track,

  language,

  syncedOnly = false

) {

  return candidates

    .filter(item => {

      const lyrics = item.syncedLyrics || item.plainLyrics;



      if (!lyrics?.trim()) return false;



      if (syncedOnly && !item.syncedLyrics?.trim()) {

        return false;

      }



      if (language === 'ta' || language === 'tanglish') {

        return getLyricsLanguage(lyrics) === language;

      }



      return true;

    })

    .map(item => ({

      item,

      score: scoreMatch(item, track),

    }))

    .sort((a, b) => {

      const aSynced = Boolean(a.item.syncedLyrics?.trim());

      const bSynced = Boolean(b.item.syncedLyrics?.trim());



      if (aSynced !== bSynced) {

        return Number(bSynced) - Number(aSynced);

      }



      return b.score - a.score;

    })

    .find(result => result.score >= 5)?.item || null;

}



// ======================================================

// FIND LYRICS

// ======================================================



async function findLyricsForLanguage(track, language, signal) {

  const title = track.title || '';

  const rawArtist = track.artist || '';
  // Metadata may contain several credited artists; lyrics providers are more reliable
  // when queried with the primary artist only (before &, comma, feat./ft., or slash).
  const artist = rawArtist.split(/\s*(?:,|&|\||\/|\bfeat\.?\b|\bft\.?\b)\s*/i)[0].trim();
  const lyricsTrack = { ...track, artist };

  let exactPlainFallback = null;

  const artistFirstWord = artist;

  // Search the complete song title first, then add the artist's first word.
  const queries = [title];

  if (artistFirstWord) {
    queries.push(`${title} ${artistFirstWord}`);
  }

  if (language === 'ta') {
    queries.push(
      `${title} Tamil`,
      `${title} ${artistFirstWord} Tamil`,
      `${title} தமிழ்`
    );
  }

  if (language === 'tanglish') {
    queries.push(
      `${title} Tanglish`,
      `${title} ${artistFirstWord} Tanglish`,
      `${title} Thanglish`,
      `${title} Tamil transliteration`,
      `${title} Romanized Tamil`
    );
  }

  // Search sequentially so title-only lookup always happens first.
  const searchResults = [];

  for (const query of [...new Set(queries)]) {
    try {
      const params = new URLSearchParams({ q: query });
      const results = await fetchLyricsJSON(
        `${LRCLIB}/search?${params}`,
        signal
      );

      if (Array.isArray(results)) {
        searchResults.push(...results);
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }

    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const currentCandidates = uniqueResults(searchResults).filter(item =>
      item.syncedLyrics?.trim() || item.plainLyrics?.trim()
    );

    const currentSyncedMatch = findBestMatch(
      currentCandidates,
      lyricsTrack,
      language,
      true
    );

    if (currentSyncedMatch) {
      return currentSyncedMatch;
    }
  }

  const candidates = uniqueResults(searchResults).filter(item =>
    item.syncedLyrics?.trim() || item.plainLyrics?.trim()
  );

  // First: synchronized lyrics.

  const syncedMatch = findBestMatch(

    candidates,

    lyricsTrack,

    language,

    true

  );



  if (syncedMatch) {

    return syncedMatch;

  }



  // Exact metadata lookup is retained after the title-first searches.
  if (language === 'original' && !exactPlainFallback) {
    try {
      const params = new URLSearchParams({
        track_name: title,
        artist_name: artist,
      });
      const exact = await fetchLyricsJSON(`${LRCLIB}/get?${params}`, signal);
      if (exact.syncedLyrics?.trim()) return exact;
      if (exact.plainLyrics?.trim()) exactPlainFallback = exact;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }

  // Second: exact lookup plain fallback.

  if (

    exactPlainFallback &&

    (

      language === 'original' ||

      getLyricsLanguage(exactPlainFallback.plainLyrics) === language

    )

  ) {

    return exactPlainFallback;

  }



  // Third: search plain lyrics.

  const plainCandidates = candidates.filter(

    item =>

      !item.syncedLyrics?.trim() &&

      item.plainLyrics?.trim()

  );



  const plainMatch = findBestMatch(

    plainCandidates,

    lyricsTrack,

    language,

    false

  );



  if (plainMatch) {

    return plainMatch;

  }



  throw new Error(

    language === 'ta'

      ? 'Tamil lyrics are unavailable.'

      : language === 'tanglish'

        ? 'Tanglish lyrics are unavailable.'

        : 'Lyrics are unavailable.'

  );

}



// ======================================================

// Original lyrics are preferred. If unavailable, try Tamil and then Tanglish.
async function findLyrics(track, language, signal) {
  if (language !== 'original') {
    const result = await findLyricsForLanguage(track, language, signal);
    return { ...result, lyricsLanguage: language };
  }

  try {
    const original = await findLyricsForLanguage(track, 'original', signal);
    return { ...original, lyricsLanguage: 'original' };
  } catch (err) {
    if (err.name === 'AbortError' || signal.aborted) throw err;
  }

  for (const fallbackLanguage of ['ta', 'tanglish']) {
    try {
      const fallback = await findLyricsForLanguage(
        track,
        fallbackLanguage,
        signal
      );
      return { ...fallback, lyricsLanguage: fallbackLanguage };
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) throw err;
    }
  }

  throw new Error('Original, Tamil, and Tanglish lyrics are unavailable.');
}

// LIVE LYRICS COMPONENT

// ======================================================



export default function LiveLyrics({

  track,

  currentTime = 0,

  playing = false,

  onSeek,
  onClose,

}) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [language, setLanguage] = useState('original');
  const [coverUrl, setCoverUrl] = useState(() => getTrackAlbumCover(track));



  const activeLineRef = useRef(null);

  const lastTrackRef = useRef(track || null);

  const lyricsCache = useRef(new Map());



  // Remember the track when playback pauses.

  if (track) {

    lastTrackRef.current = track;

  }



  const displayTrack = track || lastTrackRef.current;

  // Resolve album artwork for the currently playing track without changing playback.
  useEffect(() => {
    const controller = new AbortController();
    const suppliedCover = getTrackAlbumCover(displayTrack);
    setCoverUrl(suppliedCover || '');
    if (!displayTrack) return () => controller.abort();

    if (!suppliedCover) {
      findAlbumCover(displayTrack, controller.signal)
        .then(url => {
          if (!controller.signal.aborted) setCoverUrl(url || '');
        })
        .catch(error => {
          if (error?.name !== 'AbortError') {
            console.warn('Album artwork lookup failed:', error);
          }
        });
    }
    return () => controller.abort();
  }, [displayTrack?.id, displayTrack?.title, displayTrack?.artist, displayTrack?.album, displayTrack?.coverUrl]);




  // ====================================================

  // LOAD ORIGINAL LYRICS

  // ====================================================



  useEffect(() => {

    if (!displayTrack?.id) {

      setData(null);

      setError('');

      setLoading(false);



      return;

    }



    const controller = new AbortController();



    setLoading(true);

    setError('');

    setData(null);

    setLanguage('original');



    const cacheKey = `${displayTrack.id}-original`;

    const cached = lyricsCache.current.get(cacheKey);



    if (cached) {

      setData(cached);

      setLoading(false);

    } else {

      findLyrics(

        displayTrack,

        'original',

        controller.signal

      )

        .then(result => {

          if (controller.signal.aborted) return;



          lyricsCache.current.set(cacheKey, result);

          setData(result);

        })

        .catch(err => {

          if (

            err.name !== 'AbortError' &&

            !controller.signal.aborted

          ) {

            setError('Lyrics are unavailable.');

          }

        })

        .finally(() => {

          if (!controller.signal.aborted) {

            setLoading(false);

          }

        });

    }



    return () => controller.abort();

  }, [displayTrack?.id]);



  // ====================================================

  // SWITCH LANGUAGE

  // ====================================================



  useEffect(() => {

    if (!displayTrack?.id || language === 'original') {

      return;

    }



    const controller = new AbortController();

    const cacheKey = `${displayTrack.id}-${language}`;



    setError('');



    const cached = lyricsCache.current.get(cacheKey);



    if (cached) {

      setData(cached);

      setLoading(false);



      return () => controller.abort();

    }



    setLoading(true);



    findLyrics(

      displayTrack,

      language,

      controller.signal

    )

      .then(result => {

        if (controller.signal.aborted) return;



        lyricsCache.current.set(cacheKey, result);

        setData(result);

      })

      .catch(err => {

        if (

          err.name !== 'AbortError' &&

          !controller.signal.aborted

        ) {

          setError(

            language === 'ta'

              ? 'Tamil lyrics are unavailable.'

              : 'Tanglish lyrics are unavailable.'

          );

        }

      })

      .finally(() => {

        if (!controller.signal.aborted) {

          setLoading(false);

        }

      });



    return () => controller.abort();

  }, [displayTrack?.id, language]);



  // ====================================================

  // PARSE CURRENT LYRICS

  // ====================================================



  const lyricsText = data?.syncedLyrics?.trim()

    ? data.syncedLyrics

    : data?.plainLyrics || '';



  const hasSyncedLyrics = Boolean(

    data?.syncedLyrics?.trim()

  );



  const lines = useMemo(

    () => parseLyrics(lyricsText),

    [lyricsText]

  );



  // ====================================================

  // FIND ACTIVE LYRIC

  // ====================================================



  const activeIndex = useMemo(() => {

    if (!hasSyncedLyrics || !lines.length) {

      return -1;

    }



    let active = -1;



    for (let index = 0; index < lines.length; index += 1) {

      if (lines[index].time === null) continue;



      if (lines[index].time <= currentTime) {

        active = index;

      } else {

        break;

      }

    }



    return active;

  }, [lines, currentTime, hasSyncedLyrics]);

  // Estimate how long the current lyric should remain visible. LRC files
  // provide start timestamps only, so use the text length and next timestamp.
  const activeLyricDuration = useMemo(() => {
    if (activeIndex < 0 || !lines[activeIndex]) return 0;

    const currentLine = lines[activeIndex];
    const nextLine = lines[activeIndex + 1];
    const estimatedFromText = Math.min(
      5.5,
      Math.max(1.4, (String(currentLine.text || '').trim().length / 13) * 1.15)
    );

    if (Number.isFinite(nextLine?.time)) {
      const gap = Math.max(0, nextLine.time - currentLine.time);
      return Math.min(estimatedFromText, Math.max(0.25, gap * 0.72));
    }

    return estimatedFromText;
  }, [lines, activeIndex]);

  const isCurrentLyricVisible =
    activeIndex >= 0 &&
    currentTime < lines[activeIndex].time + activeLyricDuration;

  // Show the equalizer only for music-only gaps longer than 3 seconds.
  const hasLongOpeningGap =
    activeIndex < 0 &&
    lines.length > 0 &&
    Number.isFinite(lines[0].time) &&
    lines[0].time > 3;

  const hasLongBetweenLyricsGap = (() => {
    if (activeIndex < 0 || activeIndex >= lines.length - 1) return false;

    const currentLineEnd = lines[activeIndex].time + activeLyricDuration;
    const nextLineStart = lines[activeIndex + 1].time;
    const gapDuration = nextLineStart - currentLineEnd;

    return (
      Number.isFinite(nextLineStart) &&
      gapDuration > 3 &&
      currentTime >= currentLineEnd &&
      currentTime < nextLineStart
    );
  })();


  // ====================================================

  // AUTOMATIC SCROLL FOR SYNCED LYRICS

  // ====================================================



  useEffect(() => {

    if (

      playing &&

      hasSyncedLyrics &&

      activeLineRef.current

    ) {

      activeLineRef.current.scrollIntoView({

        behavior: 'auto',

        block: 'center',

      });

    }

  }, [activeIndex, playing, hasSyncedLyrics]);



  // ====================================================

  // VISIBLE LINES

  // ====================================================



  const visibleLines = useMemo(() => {

    if (!hasSyncedLyrics) {

      return lines.map((line, index) => ({

        ...line,

        originalIndex: index,

      }));

    }



    if (activeIndex < 0) {

      return lines.slice(0, 5).map((line, index) => ({

        ...line,

        originalIndex: index,

      }));

    }



    const start = Math.max(0, activeIndex - 2);

    const end = Math.min(lines.length, activeIndex + 4);



    return lines.slice(start, end).map((line, offset) => ({

      ...line,

      originalIndex: start + offset,

    }));

  }, [lines, activeIndex, hasSyncedLyrics]);



  // ====================================================

  // CLICK LYRIC TO SEEK

  // ====================================================



  const handleLyricClick = async line => {

    if (

      !hasSyncedLyrics ||

      !Number.isFinite(line.time) ||

      typeof onSeek !== 'function'

    ) {

      return;

    }



    try {

      await onSeek(Math.max(0, line.time));

    } catch (err) {

      console.error('Unable to seek from lyric:', err);

    }

  };



  // ====================================================

  // KEYBOARD ACCESSIBILITY

  // ====================================================



  const handleLyricKeyDown = (event, line) => {

    if (

      event.key === 'Enter' ||

      event.key === ' '

    ) {

      event.preventDefault();

      handleLyricClick(line);

    }

  };



  // Hide lyrics when paused.

  if (!displayTrack || !playing) {

    return null;

  }



  // ====================================================

  // RENDER

  // ====================================================



  return (

    <div

      className="ml-live-lyrics-overlay"

      aria-label="Live lyrics overlay"

    >

      <section
        className="ml-live-lyrics"
        aria-label="Live lyrics"
      >
        <button className="ml-lyrics-close" type="button" onClick={onClose} aria-label="Close lyrics" title="Close lyrics">
          ×
        </button>
        {coverUrl && (
        <div className="ml-lyrics-cover-wrap">
          <img
            className="ml-lyrics-cover"
            src={coverUrl}
            alt={`${displayTrack?.album || displayTrack?.title || 'Album'} cover`}
            loading="lazy"
            onError={() => setCoverUrl('')}
          />
        </div>
      )}

      {/* LANGUAGE SELECTOR */}



        <div className="ml-lyrics-language-switch">

          <button

            type="button"

            className={language === 'original' ? 'active' : ''}

            onClick={() => setLanguage('original')}

            disabled={loading}

          >

            Original

          </button>



          <button

            type="button"

            className={language === 'ta' ? 'active' : ''}

            onClick={() => setLanguage('ta')}

            disabled={loading}

          >

            தமிழ்

          </button>



          <button

            type="button"

            className={language === 'tanglish' ? 'active' : ''}

            onClick={() => setLanguage('tanglish')}

            disabled={loading}

          >

            Tanglish

          </button>

        </div>

        {(getTrackAudioFormat(displayTrack) || getTrackBitrate(displayTrack) || getTrackAudioDetails(displayTrack) || isDolbyAtmosTrack(displayTrack)) && (
          <div className="ml-lyrics-format-label" aria-label={`Audio format ${getTrackAudioFormat(displayTrack) || 'unknown'}${getTrackBitrate(displayTrack) ? `, bitrate ${getTrackBitrate(displayTrack)}` : ''}${isDolbyAtmosTrack(displayTrack) ? ', Dolby Atmos source' : ''}`}>
            <AudioLines size={13} />
            <span>
              {getTrackAudioFormat(displayTrack) ? `Playing in ${getTrackAudioFormat(displayTrack)}` : 'Audio details'}
              {getTrackBitrate(displayTrack) ? ` · ${getTrackBitrate(displayTrack)}` : ''}
              {getTrackAudioDetails(displayTrack) ? ` · ${getTrackAudioDetails(displayTrack)}` : ''}
              {isDolbyAtmosTrack(displayTrack) ? ' · Dolby Atmos' : ''}
            </span>
          </div>
        )}

        {data?.lyricsLanguage && data.lyricsLanguage !== language && (
          <div className="ml-plain-lyrics-hint">
            {/* Original lyrics unavailable. Showing {data.lyricsLanguage === 'ta' ? 'Tamil' : 'Tanglish'} lyrics instead. */}
          </div>
        )}

        {/* LOADING */}



        {loading && (

          <div className="ml-lyrics-status">

            <LoaderCircle

              className="animate-spin"

              size={20}

            />



            <span>Loading lyrics...</span>

          </div>

        )}



        {/* ERROR */}



        {error && !lines.length && (

          <div className="ml-lyrics-status">

            <Music2 size={20} />

            <span>{error}</span>

          </div>

        )}



        {/* EMPTY STATE */}



        {!loading && !error && !lines.length && (

          <div className="ml-lyrics-status">

            <AudioLines size={20} />

            <span>No lyrics available.</span>

          </div>

        )}



        {/* PLAIN LYRICS HINT */}



        {!hasSyncedLyrics && lines.length > 0 && (

          <div className="ml-plain-lyrics-hint">

            Plain lyrics

          </div>

        )}



        <style>{`
          .ml-lyrics-cover-wrap {
            display: flex;
            justify-content: center;
            margin: 0 auto 12px;
          }
          .ml-lyrics-cover {
            display: block;
            width: min(180px, 42vw);
            aspect-ratio: 1;
            object-fit: cover;
            border-radius: 14px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.28);
          }
          .ml-lyrics-format-label {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            margin: 7px auto 10px; color: rgba(255,255,255,0.68);
            font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .ml-live-lyric-line.gap-hidden {
            display: none;
          }
          .ml-lyrics-gap-visualizer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            height: 30px;
            margin: 8px auto 14px;
            opacity: 0.8;
            pointer-events: none;
          }
          .ml-lyrics-gap-visualizer span {
            display: block;
            width: 3px;
            height: 7px;
            border-radius: 999px;
            background: currentColor;
            animation: ml-lyrics-equalizer 850ms ease-in-out infinite;
            transform-origin: center;
          }
          .ml-lyrics-gap-visualizer span:nth-child(2) { animation-delay: 120ms; }
          .ml-lyrics-gap-visualizer span:nth-child(3) { animation-delay: 240ms; }
          .ml-lyrics-gap-visualizer span:nth-child(4) { animation-delay: 360ms; }
          .ml-lyrics-gap-visualizer span:nth-child(5) { animation-delay: 480ms; }
          @keyframes ml-lyrics-equalizer {
            0%, 100% { height: 6px; opacity: 0.55; }
            50% { height: 24px; opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .ml-lyrics-gap-visualizer span { animation: none; height: 10px; }
          }
        `}</style>

        {/* LYRICS LIST */}



        <div

          className={`ml-live-lyrics-lines ${

            hasSyncedLyrics ? 'synced' : 'plain-scroll'

          }`}

          aria-live="polite"

          onWheel={event => {

            if (!hasSyncedLyrics) {

              event.preventDefault();

              event.stopPropagation();



              event.currentTarget.scrollTop += event.deltaY;

            }

          }}

        >

          {playing && hasSyncedLyrics && hasLongOpeningGap && (
            <div
              className="ml-lyrics-gap-visualizer"
              aria-label="Music playing between lyrics"
              role="img"
            >
              <span /><span /><span /><span /><span />
            </div>
          )}

          {visibleLines.map((line, index) => {

            const actualIndex =

              line.originalIndex ?? index;



            const isActive =
              hasSyncedLyrics &&
              actualIndex === activeIndex &&
              isCurrentLyricVisible;



            return (

              <Fragment key={`${line.index}-${line.time}-${actualIndex}`}>
              <p

                ref={isActive ? activeLineRef : null}

                className={`ml-live-lyric-line ${

                  isActive ? 'active' : ''

                } ${

                  hasSyncedLyrics &&
                  actualIndex < activeIndex
                    ? 'past'
                    : ''
                } ${
                  hasSyncedLyrics &&
                  actualIndex === activeIndex &&
                  !isCurrentLyricVisible
                    ? 'gap-hidden'
                    : ''
                } ${

                  hasSyncedLyrics ? 'clickable' : ''

                }`}

                onClick={() => handleLyricClick(line)}

                role={hasSyncedLyrics ? 'button' : undefined}

                tabIndex={hasSyncedLyrics ? 0 : undefined}

                onKeyDown={event =>

                  handleLyricKeyDown(event, line)

                }

                title={

                  hasSyncedLyrics

                    ? `Play from ${Math.floor(line.time / 60)}:${String(

                        Math.floor(line.time % 60)

                      ).padStart(2, '0')}`

                    : undefined

                }

              >

                {line.text}

              </p>

              {hasSyncedLyrics &&
                playing &&
                actualIndex === activeIndex &&
                hasLongBetweenLyricsGap && (
                  <div
                    className="ml-lyrics-gap-visualizer"
                    aria-label="Music playing between lyrics"
                    role="img"
                  >
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </Fragment>

            );

          })}

        </div>

      </section>

    </div>

  );

}
