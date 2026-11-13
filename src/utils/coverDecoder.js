import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';

const onlineCoverCache = new Map();

export function normalizeImageMime(mimeType = '', bytes = null) {
  if (bytes && bytes.length >= 4) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      return 'image/webp';
    }
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46
    ) {
      return 'image/gif';
    }
  }

  const raw = String(mimeType || '').trim().toLowerCase();
  if (raw === 'image/png' || raw === 'png') return 'image/png';
  if (raw === 'image/webp' || raw === 'webp') return 'image/webp';
  if (raw === 'image/gif' || raw === 'gif') return 'image/gif';
  if (raw === 'image/bmp' || raw === 'bmp') return 'image/bmp';
  if (
    raw === 'image/jpeg' ||
    raw === 'image/jpg' ||
    raw === 'jpg' ||
    raw === 'jpeg'
  ) {
    return 'image/jpeg';
  }

  return raw.startsWith('image/') ? raw : 'image/jpeg';
}

/**
 * Decode embedded cover art (tags.images) and metadata from a File or Blob using Mediabunny.
 */
export async function extractAlbumArtFromBlob(fileOrBlob) {
  const input = new Input({
    source: new BlobSource(fileOrBlob),
    formats: ALL_FORMATS,
  });

  try {
    const tags = await input.getMetadataTags();
    const images = tags?.images ?? [];

    let coverResult = null;

    if (images.length > 0) {
      const cover =
        images.find(img => img?.kind === 'coverFront' && img?.data?.byteLength > 32) ||
        images.find(img => img?.data?.byteLength > 32) ||
        images[0];

      if (cover?.data) {
        const bytes =
          cover.data instanceof Uint8Array
            ? Uint8Array.from(cover.data)
            : new Uint8Array(cover.data);

        if (bytes.byteLength > 32) {
          const mimeType = normalizeImageMime(cover.mimeType, bytes);
          const blob = new Blob([bytes], { type: mimeType });
          const url = URL.createObjectURL(blob);

          coverResult = {
            url,
            blob,
            kind: cover.kind || 'coverFront',
            mimeType,
          };
        }
      }
    }

    let duration = 0;
    try {
      if (typeof input.computeDuration === 'function') {
        const d = await input.computeDuration();
        if (Number.isFinite(d) && d > 0) duration = d;
      }
    } catch {
      // ignore duration calculation errors
    }

    return {
      cover: coverResult,
      tags: {
        title: tags?.title || '',
        artist: tags?.artist || tags?.albumArtist || '',
        album: tags?.album || '',
        duration,
      },
    };
  } finally {
    input.dispose();
  }
}

function normalizeCoverText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSongMetadataForSearch(track) {
  const rawTitle = String(track?.title || track?.name || '').trim();
  const rawArtist = String(track?.artist || track?.artistName || '').trim();
  const rawAlbum = String(track?.album || track?.albumName || '').trim();

  // Extract movie/album name from patterns like (From "Bachelor")
  const fromMatch = rawTitle.match(/\(\s*from\s+["'“”]?([^"'”)]+)["'”]?\s*\)/i) ||
                    rawTitle.match(/\[\s*from\s+["'“”]?([^"'”\]]+)["'”]?\s*\]/i);
  const extractedMovie = fromMatch ? fromMatch[1].trim() : '';

  const cleanedTitle = rawTitle
    .replace(/\(\s*from\s+[^)]+\)/gi, '')
    .replace(/\[\s*from\s+[^\]]+\]/gi, '')
    .replace(/\(\s*(?:instrumental|official|lyric|audio|video)[^)]*\)/gi, '')
    .replace(/\s*-\s*masstamilan.*$/i, '')
    .replace(/^\d+\s*[-._)]\s*/, '')
    .split(' - ')[0]
    .trim();

  const cleanArtist =
    rawArtist && !/unknown artist|musiclover library/i.test(rawArtist)
      ? rawArtist.split(/[,&|/]|\bfeat\.?\b|\bft\.?\b/i)[0].trim()
      : '';

  const cleanAlbum =
    rawAlbum && !/unknown album|masstamilan/i.test(rawAlbum)
      ? rawAlbum.replace(/\(\s*original.*\)/i, '').trim()
      : extractedMovie;

  return {
    rawTitle,
    cleanedTitle: cleanedTitle || rawTitle,
    cleanArtist,
    cleanAlbum,
    extractedMovie,
  };
}

function coverMatchScore(resultTitle, resultArtist, resultAlbum, meta) {
  const title = normalizeCoverText(meta.cleanedTitle);
  const artist = normalizeCoverText(meta.cleanArtist);
  const album = normalizeCoverText(meta.cleanAlbum || meta.extractedMovie);

  const candidateTitle = normalizeCoverText(resultTitle);
  const candidateArtist = normalizeCoverText(resultArtist);
  const candidateAlbum = normalizeCoverText(resultAlbum);

  let score = 0;
  if (title && candidateTitle === title) score += 6;
  else if (title && (candidateTitle.includes(title) || title.includes(candidateTitle))) score += 4;

  if (artist && candidateArtist === artist) score += 5;
  else if (artist && (candidateArtist.includes(artist) || artist.includes(candidateArtist))) score += 3;

  if (album && candidateAlbum && (candidateAlbum.includes(album) || album.includes(candidateAlbum))) {
    score += 3;
  }

  return score;
}

export async function findOnlineAlbumCover(track, signal) {
  const meta = cleanSongMetadataForSearch(track);
  if (!meta.cleanedTitle && !meta.cleanAlbum) return '';

  const cacheKey = normalizeCoverText(
    `${meta.cleanedTitle}|${meta.cleanArtist}|${meta.cleanAlbum}`
  );
  if (onlineCoverCache.has(cacheKey)) return onlineCoverCache.get(cacheKey);

  const queries = [
    [meta.cleanedTitle, meta.cleanArtist, meta.extractedMovie].filter(Boolean).join(' '),
    [meta.cleanedTitle, meta.cleanArtist].filter(Boolean).join(' '),
    meta.cleanedTitle,
  ].filter(Boolean);

  for (const term of [...new Set(queries)]) {
    try {
      const response = await fetch(
        `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(term)}`,
        { signal, headers: { Accept: 'application/json' } }
      );
      if (response.ok) {
        const data = await response.json();
        const matches = (data?.results || [])
          .map(item => ({
            score: coverMatchScore(
              item.trackName,
              item.artistName,
              item.collectionName,
              meta
            ),
            url:
              item.artworkUrl100?.replace(/100x100bb/i, '600x600bb') ||
              item.artworkUrl100,
          }))
          .filter(item => item.url)
          .sort((a, b) => b.score - a.score);

        if (matches[0]?.score >= 4) {
          onlineCoverCache.set(cacheKey, matches[0].url);
          return matches[0].url;
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }

  onlineCoverCache.set(cacheKey, '');
  return '';
}

/**
 * Live-decode cover art for a single track object:
 * 1. Mediabunny client-side decoding (tags.images -> coverFront)
 * 2. Electron main-process fallback (music-metadata / FFmpeg / local folder image)
 * 3. Online album cover fallback (iTunes Search API) when file has no embedded cover
 */
export async function decodeTrackCoverLive(track) {
  if (!track) return null;

  let extractedTags = null;

  // 1. Browser File object (when chosen via browser file input)
  if (track.file instanceof Blob) {
    try {
      const { cover, tags } = await extractAlbumArtFromBlob(track.file);
      extractedTags = tags;
      if (cover?.url) {
        return {
          ...cover,
          isObjectUrl: true,
          tags,
        };
      }
    } catch (err) {
      console.debug(`Mediabunny browser decode error for ${track.title}:`, err?.message || err);
    }
  }

  // 2. Electron local file bytes -> Mediabunny BlobSource
  if (window.musicLover?.readTrackBytes && track.id) {
    try {
      const fileBytes = await window.musicLover.readTrackBytes(track.id);
      if (fileBytes && fileBytes.byteLength > 0) {
        const audioBlob = new Blob([fileBytes]);
        const { cover, tags } = await extractAlbumArtFromBlob(audioBlob);
        extractedTags = tags;
        if (cover?.url) {
          return {
            ...cover,
            isObjectUrl: true,
            tags,
          };
        }
      }
    } catch (err) {
      console.debug(`Mediabunny Electron decode error for ${track.title}:`, err?.message || err);
    }
  }

  // 3. Electron main-process fallback (music-metadata / FFmpeg attached pic / folder art)
  if (window.musicLover?.readTrackCover && track.id) {
    try {
      const fallback = await window.musicLover.readTrackCover(track.id);
      if (fallback?.data) {
        const bytes =
          fallback.data instanceof Uint8Array
            ? Uint8Array.from(fallback.data)
            : new Uint8Array(fallback.data);
        if (bytes.byteLength > 32) {
          const mimeType = normalizeImageMime(fallback.mimeType, bytes);
          const blob = new Blob([bytes], { type: mimeType });
          const url = URL.createObjectURL(blob);
          return {
            url,
            blob,
            kind: fallback.kind || 'coverFront',
            mimeType,
            isObjectUrl: true,
            tags: extractedTags,
          };
        }
      }
    } catch (err) {
      console.debug(`Fallback cover decode error for ${track.title}:`, err?.message || err);
    }
  }

  // 4. Online album cover fallback for tracks that have no embedded image in the file
  try {
    const mergedTrack = {
      ...track,
      title: extractedTags?.title || track.title,
      artist:
        extractedTags?.artist && track.artist === 'Unknown Artist'
          ? extractedTags.artist
          : track.artist,
      album:
        extractedTags?.album && track.album === 'Unknown Album'
          ? extractedTags.album
          : track.album,
    };
    const onlineUrl = await findOnlineAlbumCover(mergedTrack);
    if (onlineUrl) {
      return {
        url: onlineUrl,
        blob: null,
        kind: 'coverFront',
        mimeType: 'image/jpeg',
        isObjectUrl: false,
        tags: extractedTags,
      };
    }
  } catch (err) {
    console.debug(`Online cover lookup error for ${track.title}:`, err?.message || err);
  }

  return extractedTags ? { url: null, isObjectUrl: false, tags: extractedTags } : null;
}
