import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AudioLines,
  Captions,
  ChevronRight,
  Disc3,
  Heart,
  Home,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  AlertCircle,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat2,
  X,
  UserRound,
  Moon,
} from 'lucide-react';

import LiveLyrics from './LiveLyrics.jsx';
import LikedSongsSlider from './LikedSongsSlider.jsx';
import { decodeTrackCoverLive } from './utils/coverDecoder.js';

const palettes = [
  'cover-ocean',
  'cover-night',
  'cover-road',
  'cover-palm',
  'cover-mountain',
  'cover-city',
];

const BROWSER_AUDIO_EXTENSIONS = new Set([
  'mp3', 'aac', 'm4a', 'mp4', 'mp2', 'mpa', 'ogg', 'oga', 'opus',
  'wma', 'flac', 'wav', 'wave', 'aiff', 'aif', 'alac', 'ape', 'wv',
  'tta', 'caf', 'webm', 'mka', 'mkv',
]);

function isSupportedBrowserAudioFile(file) {
  if (!file?.name) return false;
  if (file.type && (file.type.startsWith('audio/') || file.type === 'video/x-matroska')) {
    return true;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return BROWSER_AUDIO_EXTENSIONS.has(ext);
}

function time(value) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';

  return `${Math.floor(value / 60)}:${String(
    Math.floor(value % 60)
  ).padStart(2, '0')}`;
}

function getTrackFormat(track) {
  if (!track) return 'Audio';

  const explicitFormat =
    track.extension || track.format || track.fileFormat || track.mimeType;

  if (explicitFormat) {
    const format = String(explicitFormat).trim();
    const normalized = format.includes('/') ? format.split('/').pop() : format;
    return normalized.replace(/^\./, '').toUpperCase() || 'Audio';
  }

  const fileName =
    track.fileName || track.filename || track.originalName ||
    track.name || track.key || track.path || track.title || '';
  const match = String(fileName).match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);

  return match ? match[1].toUpperCase() : 'Audio';
}

function Art({ track, index = 0 }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const coverUrl = track?.coverUrl;

  if (coverUrl && failedUrl !== coverUrl) {
    return (
      <div className="ml-art ml-art-original">
        <img
          src={coverUrl}
          alt={`${track?.title || 'Song'} original album cover`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(coverUrl)}
        />
        <span className="art-label"><AudioLines size={18} /></span>
      </div>
    );
  }

  return (
    <div className={`ml-art ${palettes[index % palettes.length]}`}>
      <span className="art-sun" />
      <span className="art-ridge ridge-a" />
      <span className="art-ridge ridge-b" />
      <span className="art-ground" />
      <span className="art-label"><AudioLines size={18} /></span>
    </div>
  );
}


// Release test: verify automatic update download, installation, and relaunch.
function DesktopUpdatePrompt() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const downloadRequestedRef = useRef(false);
  const installStartedRef = useRef(false);

  const installDownloadedUpdate = useCallback(async () => {
    if (installStartedRef.current) return;
    installStartedRef.current = true;
    setBusy(true);
    setState(previous => previous ? {
      ...previous,
      status: 'installing',
      error: null,
    } : previous);

    try {
      const started = await window.musicLover.installUpdate();
      if (!started) {
        installStartedRef.current = false;
        setBusy(false);
        setState(previous => previous ? {
          ...previous,
          status: 'error',
          error: 'The update could not be started. Please try downloading it again.',
        } : previous);
      }
    } catch (error) {
      installStartedRef.current = false;
      setBusy(false);
      setState(previous => previous ? {
        ...previous,
        status: 'error',
        error: error?.message || 'The update could not be installed.',
      } : previous);
    }
  }, []);

  useEffect(() => {
    const api = window.musicLover;
    if (!api?.getUpdateState) return undefined;
    let active = true;

    api.getUpdateState().then(value => {
      if (active && value?.packaged) {
        setState(value);
        if (value.status === 'downloaded' && downloadRequestedRef.current) {
          installDownloadedUpdate();
        }
      }
    }).catch(() => {});

    const unsubscribe = api.onUpdateEvent?.(value => {
      if (!active) return;
      setState(value);
      if (['available', 'downloading', 'downloaded'].includes(value.status)) {
        setDismissed(false);
      }
      if (value.status === 'downloaded' && downloadRequestedRef.current) {
        installDownloadedUpdate();
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [installDownloadedUpdate]);

  const visible = Boolean(
    state?.packaged &&
    ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.status) &&
    !dismissed
  );
  if (!visible) return null;

  const downloading = state.status === 'downloading';
  const downloaded = state.status === 'downloaded';
  const installing = state.status === 'installing';
  const failed = state.status === 'error';
  const title = installing
    ? 'Installing update'
    : downloaded
      ? 'Update downloaded'
      : downloading
        ? 'Downloading update'
        : failed
          ? 'Update check unavailable'
          : 'A new version is available';
  const description = installing
    ? 'MusicLover Player is restarting. The new version will open automatically.'
    : downloaded
      ? 'Download complete. Preparing to install and restart MusicLover Player…'
      : downloading
        ? 'Your update is downloading. You can keep listening while it finishes.'
        : failed
          ? (state.error || 'Open the official releases page to download the latest version.')
          : 'Download the latest MusicLover Player update for your computer. It will install and restart automatically.';
  const downloadUpdate = async () => {
    if (busy || downloading || installing) return;
    setBusy(true);
    downloadRequestedRef.current = true;
    installStartedRef.current = false;
    try {
      await window.musicLover.downloadUpdate();
    } catch (error) {
      downloadRequestedRef.current = false;
      setState(previous => ({
        ...previous,
        status: 'error',
        error: error?.message || 'The update download failed.',
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-update-overlay" role="presentation">
      <section className="ml-update-dialog" role="dialog" aria-modal="true" aria-labelledby="ml-desktop-update-title">
        <div className="ml-update-icon"><Music2 size={25} /></div>
        <span className="ml-update-eyebrow">MUSICLOVER PLAYER</span>
        <h2 id="ml-desktop-update-title">{title}</h2>
        <p>{description}</p>
        {(downloading || downloaded) && <div className="ml-update-progress"><span style={{ width: `${state.percent || 0}%` }} /></div>}
        {state.availableVersion && <small>Version {state.availableVersion}</small>}
        <div className="ml-update-actions">
          {!installing && !downloaded && <button type="button" className="ml-update-later" onClick={() => setDismissed(true)}>Later</button>}
          {failed ? (
            <button type="button" className="ml-update-primary" onClick={() => window.musicLover.checkForUpdate()}>Try again</button>
          ) : (
            <button
              type="button"
              className="ml-update-primary"
              disabled={busy || downloading || downloaded || installing}
              onClick={downloadUpdate}
            >
              {installing
                ? 'Installing…'
                : downloaded
                  ? 'Preparing installation…'
                  : downloading
                    ? `Downloading ${state.percent || 0}%`
                    : busy
                      ? 'Starting download…'
                      : 'Download & install'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function App() {
  const audioRef = useRef(null);
  const seekRef = useRef(null);
  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);

  const [tracks, setTracks] = useState([]);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const attemptedCoverIdsRef = useRef(new Set());
  const inFlightCoverIdsRef = useRef(new Set());
  const isDecodingCoversRef = useRef(false);
  const unmountedRef = useRef(false);

  const coverObjectUrlsRef = useRef(new Map());
  const audioObjectUrlsRef = useRef(new Map());

  const [loading, setLoading] = useState(true);
  const [showStartupWave, setShowStartupWave] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Home');

  const [heroSlide, setHeroSlide] = useState(0);
  const heroSlides = [
    { title: 'Chill Vibes', subtitle: 'Relax. Listen. Repeat.' },
    { title: 'Night Drive', subtitle: 'Feel the night. Find your rhythm.' },
    { title: 'Deep Focus', subtitle: 'Less noise. More flow.' },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroSlide(currentSlide => (currentSlide + 1) % heroSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Show the branded waveform intro before revealing the music library.
  useEffect(() => {
    const timer = window.setTimeout(() => setShowStartupWave(false), 2300);
    return () => window.clearTimeout(timer);
  }, []);

  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('musiclover-player-favorites') || '[]'); }
    catch { return []; }
  });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [dark, setDark] = useState(true);

  const [playlists, setPlaylists] = useState(() => {
    try { return JSON.parse(localStorage.getItem('musiclover-player-playlists') || '[]'); }
    catch { return []; }
  });
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistName, setPlaylistName] = useState('');
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState(null);
  const [queueIds, setQueueIds] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [toast, setToast] = useState('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const [progress, setProgress] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  const favoritesStorageKey = 'musiclover-player-favorites';
  const playlistsStorageKey = 'musiclover-player-playlists';
  const currentTrackStorageKey = 'musiclover-player-current-track';

  const currentTrack = useMemo(
    () => (current ? tracks.find(t => String(t.id) === String(current.id)) || current : null),
    [tracks, current]
  );

  const loadTracks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (window.musicLover?.scanLibrary) {
        const result = await window.musicLover.scanLibrary();
        attemptedCoverIdsRef.current.clear();
        inFlightCoverIdsRef.current.clear();
        setTracks(result || []);
        try {
          const saved = JSON.parse(localStorage.getItem(currentTrackStorageKey) || 'null');
          const restored = (result || []).find(item => String(item.id) === String(saved?.id));
          if (restored) {
            setCurrent(restored);
            setCurrentTime(Number(saved?.currentTime) || 0);
            setQueueIds((result || []).map(item => item.id));
          }
        } catch {}
        if (!result?.length) {
          setError('Choose a music folder or add audio files to begin.');
        }
      } else {
        setError('Choose a music folder or add audio files to begin.');
      }
    } catch (err) {
      setError(err.message || 'Could not scan your music folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // Persistent queue worker that decodes every song without being cancelled
  // when setTracks updates individual song covers.
  const processCoverQueue = useCallback(async () => {
    if (isDecodingCoversRef.current || unmountedRef.current) return;
    isDecodingCoversRef.current = true;

    try {
      while (!unmountedRef.current) {
        const pending = tracksRef.current.filter(track => {
          const id = String(track?.id || '');
          return (
            id &&
            !track.coverUrl &&
            !attemptedCoverIdsRef.current.has(id) &&
            !inFlightCoverIdsRef.current.has(id)
          );
        });

        if (pending.length === 0) break;

        const batch = pending.slice(0, 3);
        for (const item of batch) {
          inFlightCoverIdsRef.current.add(String(item.id));
        }

        const decodedBatch = await Promise.all(
          batch.map(async track => {
            const id = String(track.id);
            try {
              const decoded = await decodeTrackCoverLive(track);
              if (unmountedRef.current) {
                if (decoded?.url && decoded?.isObjectUrl) URL.revokeObjectURL(decoded.url);
                return null;
              }
              attemptedCoverIdsRef.current.add(id);
              if (decoded?.url && decoded.isObjectUrl) {
                const previousUrl = coverObjectUrlsRef.current.get(id);
                if (previousUrl && previousUrl !== decoded.url) URL.revokeObjectURL(previousUrl);
                coverObjectUrlsRef.current.set(id, decoded.url);
              }
              return decoded ? { id, decoded } : null;
            } catch (decodeError) {
              attemptedCoverIdsRef.current.add(id);
              console.debug(`No cover decoded for ${track.filename || track.title}:`, decodeError?.message || decodeError);
              return null;
            } finally {
              inFlightCoverIdsRef.current.delete(id);
            }
          })
        );

        // Commit each batch once instead of triggering one full-library render per song.
        const updates = new Map(decodedBatch.filter(Boolean).map(({ id, decoded }) => [id, decoded]));
        if (updates.size && !unmountedRef.current) {
          setTracks(previous => previous.map(item => {
            const decoded = updates.get(String(item.id));
            if (!decoded) return item;
            return {
              ...item,
              coverUrl: decoded.url || item.coverUrl,
              coverKind: decoded.kind || item.coverKind,
              coverMimeType: decoded.mimeType || item.coverMimeType,
              title: (!item.title || item.title === item.filename) && decoded.tags?.title ? decoded.tags.title : item.title,
              artist: (!item.artist || item.artist === 'Unknown Artist') && decoded.tags?.artist ? decoded.tags.artist : item.artist,
              album: (!item.album || item.album === 'Unknown Album') && decoded.tags?.album ? decoded.tags.album : item.album,
              duration: !item.duration && decoded.tags?.duration ? decoded.tags.duration : item.duration,
            };
          }));
        }
      }
    } finally {
      isDecodingCoversRef.current = false;
    }
  }, []);

  useEffect(() => {
    const hasPending = tracks.some(track => {
      const id = String(track?.id || '');
      return (
        id &&
        !track.coverUrl &&
        !attemptedCoverIdsRef.current.has(id) &&
        !inFlightCoverIdsRef.current.has(id)
      );
    });
    if (hasPending) {
      processCoverQueue();
    }
  }, [tracks, processCoverQueue]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      for (const url of coverObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      coverObjectUrlsRef.current.clear();

      for (const url of audioObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      audioObjectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem(playlistsStorageKey, JSON.stringify(playlists));
  }, [playlists]);

  const lastTrackPersistRef = useRef({ id: null, at: 0 });
  useEffect(() => {
    if (!current?.id) return;
    const now = Date.now();
    const id = String(current.id);
    if (lastTrackPersistRef.current.id === id && now - lastTrackPersistRef.current.at < 5000) return;
    lastTrackPersistRef.current = { id, at: now };
    try {
      localStorage.setItem(currentTrackStorageKey, JSON.stringify({
        id: current.id, currentTime: audioRef.current?.currentTime || currentTime || 0, savedAt: now,
      }));
    } catch (storageError) { console.warn('Could not persist playback position:', storageError); }
  }, [current, currentTime]);

  useEffect(() => {
    if (!navigator.onLine) setToast('You are offline. Live lyrics are unavailable.');
    const updateNetwork = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (offline) {
        setToast('You are offline. Live lyrics are unavailable.');
      } else {
        setToast('Network connection restored.');
      }
    };
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  const filtered = useMemo(() => {
    let list =
      activeTab === 'Liked Songs'
        ? tracks.filter(track => favorites.includes(track.id))
        : tracks;

    if (query.trim()) {
      const search = query.toLowerCase().trim();

      list = list.filter(track =>
        `${track.title} ${track.artist} ${track.album || ''} ${track.filename}`
          .toLowerCase()
          .includes(search)
      );
    }

    return list;
  }, [tracks, activeTab, query, favorites]);

  const handleLyricsSeek = async seconds => {
    const audio = audioRef.current;

    if (!audio || !Number.isFinite(seconds) || seconds < 0) {
      return;
    }

    try {
      const targetTime = Number.isFinite(audio.duration)
        ? Math.min(seconds, audio.duration)
        : seconds;

      if (audio.readyState === 0 && !audio.src) return;
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
      setProgress(audio.duration ? (targetTime / audio.duration) * 100 : 0);

      if (audio.paused) {
        await audio.play();
      }

      setError('');
    } catch (seekError) {
      console.error('Lyrics seek failed:', seekError);
      setError('Unable to seek to the selected lyric.');
    }
  };

  const playTrack = async (track, orderedQueue = null) => {
    if (!track) return;
    const audio = audioRef.current;
    if (!audio) return;

    setCurrent(track);
    if (Array.isArray(orderedQueue) && orderedQueue.length) {
      setQueueIds(orderedQueue.map(item => item.id));
    } else {
      const activeOrder = filtered.length ? filtered : tracks;
      setQueueIds(activeOrder.some(item => item.id === track.id)
        ? activeOrder.map(item => item.id)
        : [track.id]);
    }
    setPlaying(false);
    setCurrentTime(0);
    setDuration(track.duration || 0);
    setProgress(0);
    setError('');

    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    try {
      let playbackUrl = track.audioUrl;
      if (!playbackUrl && track.file instanceof Blob) {
        playbackUrl = URL.createObjectURL(track.file);
        audioObjectUrlsRef.current.set(String(track.id), playbackUrl);
      } else if (!playbackUrl && window.musicLover?.getTrackUrl) {
        playbackUrl = await window.musicLover.getTrackUrl(track.id);
      }

      if (!playbackUrl) {
        throw new Error('Audio source is unavailable for this track.');
      }

      audio.src = playbackUrl;
      audio.load();
      await audio.play();
    } catch (err) {
      setPlaying(false);
      setError(err.message || 'Unable to play this audio file.');
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack && tracks.length) {
      await playTrack(tracks[0]);
      return;
    }

    if (audio.paused) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          setError('Unable to resume playback. Please try selecting the song again.');
        });
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const getPlaylistTracks = playlist =>
    playlist.trackIds
      .map(id => tracks.find(track => track.id === id))
      .filter(Boolean);

  const createPlaylist = event => {
    event?.preventDefault();

    const name = playlistName.trim();
    if (!name) return;

    const playlist = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      trackIds: [],
      createdAt: new Date().toISOString(),
    };

    setPlaylists(previous => [...previous, playlist]);
    setSelectedPlaylist(playlist.id);
    setPlaylistName('');
    setShowCreatePlaylist(false);
  };

  const addToPlaylist = (playlistId, track) => {
    setPlaylists(previous =>
      previous.map(playlist =>
        playlist.id === playlistId && !playlist.trackIds.includes(track.id)
          ? {
              ...playlist,
              trackIds: [...playlist.trackIds, track.id],
            }
          : playlist
      )
    );
  };

  const removeFromPlaylist = (playlistId, trackId) => {
    setPlaylists(previous =>
      previous.map(playlist =>
        playlist.id === playlistId
          ? {
              ...playlist,
              trackIds: playlist.trackIds.filter(id => id !== trackId),
            }
          : playlist
      )
    );
  };

  const deletePlaylist = playlistId => {
    setPlaylists(previous =>
      previous.filter(playlist => playlist.id !== playlistId)
    );

    if (selectedPlaylist === playlistId) {
      setSelectedPlaylist(null);
    }
  };

  const playPlaylist = playlist => {
    const playlistTracks = getPlaylistTracks(playlist);
    if (!playlistTracks.length) return;

    setSelectedPlaylist(playlist.id);
    setActiveTab('Playlists');
    setQueueIds(playlistTracks.map(track => track.id));
    playTrack(playlistTracks[0], playlistTracks);
  };

  const getQueueTracks = () => {
    const ordered = queueIds
      .map(id => tracks.find(track => String(track.id) === String(id)))
      .filter(Boolean);
    return ordered.length ? ordered : (filtered.length ? filtered : tracks);
  };

  const playNext = () => {
    const list = getQueueTracks();
    if (!list.length) return;
    if (shuffle) {
      const otherTracks = list.filter(track => track.id !== currentTrack?.id);
      const next = otherTracks[Math.floor(Math.random() * otherTracks.length)] || list[0];
      playTrack(next, list);
      return;
    }
    const index = list.findIndex(track => String(track.id) === String(currentTrack?.id));
    if (index >= 0 && index < list.length - 1) playTrack(list[index + 1], list);
    else if (repeat) playTrack(list[0], list);
    else setPlaying(false);
  };

  const playPrev = () => {
    const audio = audioRef.current;

    if (currentTime > 3 && audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
      setProgress(0);
      return;
    }

    const list = getQueueTracks();
    const index = list.findIndex(track => String(track.id) === String(currentTrack?.id));
    if (list.length) playTrack(list[(index - 1 + list.length) % list.length], list);
  };

  const handleBrowserFilesSelected = (fileList, replaceExisting = false) => {
    const selected = Array.from(fileList || []).filter(isSupportedBrowserAudioFile);
    if (!selected.length) {
      setError('No supported audio files found in your selection.');
      return;
    }

    const mapped = selected.map((file, idx) => {
      const ext = file.name.includes('.')
        ? file.name.split('.').pop().toUpperCase()
        : 'AUDIO';
      const baseTitle = file.name.replace(/\.[^/.]+$/, '');
      const id = `local-${file.name}-${file.size}-${file.lastModified}-${idx}`;
      return {
        id,
        title: baseTitle,
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: 0,
        extension: ext,
        filename: file.name,
        fileSize: file.size,
        coverUrl: null,
        file,
      };
    });

    if (replaceExisting) {
      attemptedCoverIdsRef.current.clear();
      inFlightCoverIdsRef.current.clear();
      setTracks(mapped);
    } else {
      setTracks(previous => {
        const existingIds = new Set(previous.map(item => item.id));
        const additions = mapped.filter(item => !existingIds.has(item.id));
        return [...previous, ...additions];
      });
    }
    setError('');
  };

  const chooseMusic = async () => {
    if (window.musicLover?.chooseFolder) {
      try {
        const result = await window.musicLover.chooseFolder();
        attemptedCoverIdsRef.current.clear();
        inFlightCoverIdsRef.current.clear();
        setTracks(result || []);
        setError(result?.length ? '' : 'No supported audio files found in that folder.');
      } catch (err) {
        setError(err.message || 'Could not open music folder.');
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const addMusicFiles = async () => {
    if (window.musicLover?.chooseFiles) {
      try {
        const result = await window.musicLover.chooseFiles();
        attemptedCoverIdsRef.current.clear();
        inFlightCoverIdsRef.current.clear();
        setTracks(result || []);
        setError(result?.length ? '' : 'No supported audio files selected.');
      } catch (err) {
        setError(err.message || 'Could not add audio files.');
      }
    } else {
      filesInputRef.current?.click();
    }
  };

  const toggleFavorite = trackId => {
    setFavorites(previous => previous.includes(trackId)
      ? previous.filter(id => id !== trackId)
      : [...previous, trackId]);
  };

  const renamePlaylist = playlist => {
    const nextName = window.prompt('Rename playlist', playlist.name);
    if (!nextName || !nextName.trim()) return;
    setPlaylists(previous =>
      previous.map(item =>
        item.id === playlist.id ? { ...item, name: nextName.trim() } : item
      )
    );
  };

  const nav = [
    ['Home', Home],
    ['Songs', Music2],
    ['Albums', Disc3],
    ['Artists', UserRound],
    ['Playlists', ListMusic],
    ['Liked Songs', Heart],
  ];

  const activePlaylist = playlists.find(
    playlist => playlist.id === selectedPlaylist
  );

  const playlistTracks = activePlaylist
    ? getPlaylistTracks(activePlaylist)
    : [];

  return (
    <div className={`ml-app ${dark ? '' : 'light-mode'}`}>
      {showStartupWave && (
        <div className="ml-startup-wave" role="status" aria-label="Starting MusicLover">
          <div className="ml-startup-brand"><AudioLines size={34}/><span>Music<span>Lover</span></span></div>
          <div className="ml-startup-bars" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ '--bar-index': index }} />)}
          </div>
          <p>Feel every beat.</p>
        </div>
      )}
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={e => {
          handleBrowserFilesSelected(e.target.files, true);
          e.target.value = '';
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".mp3,.m4a,.flac,.mkv,.mp4,.ogg,.opus,.wav,.aac,.webm,.aiff,.wma,audio/*"
        hidden
        onChange={e => {
          handleBrowserFilesSelected(e.target.files, false);
          e.target.value = '';
        }}
      />

      <aside className="ml-sidebar">
        <a
          className="ml-brand"
          href="#home"
          onClick={event => {
            event.preventDefault();
            setActiveTab('Home');
          }}
        >
          <AudioLines />
          <span>
            Music<span>Lover</span>
          </span>
        </a>

        <div className="ml-sidebar-scroll">
          <div className="ml-sidebar-library-actions">
            <button className="ml-sidebar-logout" onClick={chooseMusic}><Music2 size={17} />Choose Music Folder</button>
            <button className="ml-sidebar-logout" onClick={addMusicFiles}><ListMusic size={17} />Add Audio Files</button>
          </div>
          <nav className="ml-nav">
            {nav.slice(0, 6).map(([label, Icon]) => (
              <button
                key={label}
                className={activeTab === label ? 'active' : ''}
                onClick={() => setActiveTab(label)}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </nav>
        </div>

      </aside>

      <main className="ml-main">
        <header className="ml-topbar">
          <label className="ml-search">
            <Search size={20} />

            <input
              value={query}
              onChange={event => {
                setQuery(event.target.value);

                if (event.target.value) {
                  setActiveTab('Songs');
                }
              }}
              placeholder="Search songs, albums or artists…"
            />

            <kbd>⌘ K</kbd>

            {query && (
              <button onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
          </label>

          <div className="ml-top-actions">
            <button
              className="ml-icon-button"
              aria-label="Toggle theme"
              onClick={() => setDark(value => !value)}
            >
              <Moon size={20} />
            </button>
            <button
              className="ml-avatar"
              title="Add music folder"
              onClick={chooseMusic}
            >
              <Music2 size={17} />
            </button>
          </div>
        </header>

        <div className="ml-content">
          {activeTab === 'Playlists' ? (
            <section className="ml-section ml-playlists-page">
              <div className="ml-section-head">
                <div>
                  <h2>Your Playlists</h2>
                  <p></p>
                </div>

                <button
                  className="ml-create-playlist"
                  onClick={() => setShowCreatePlaylist(value => !value)}
                >
                  + Create Playlist
                </button>
              </div>

              {showCreatePlaylist && (
                <form className="ml-create-form" onSubmit={createPlaylist}>
                  <input
                    value={playlistName}
                    onChange={event => setPlaylistName(event.target.value)}
                    placeholder="Enter playlist name"
                    maxLength={60}
                    required
                  />

                  <button type="submit">Create</button>

                  <button
                    type="button"
                    onClick={() => setShowCreatePlaylist(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}

              {playlists.length > 0 ? (
                <div className="ml-playlist-grid">
                  {playlists.map(playlist => {
                    const pTracks = getPlaylistTracks(playlist);
                    const coverTrack = pTracks.find(t => t.coverUrl) || pTracks[0];
                    return (
                      <article className="ml-playlist-card" key={playlist.id}>
                        <button
                          className="ml-playlist-art"
                          onClick={() => setSelectedPlaylist(playlist.id)}
                          aria-label={`Open ${playlist.name}`}
                        >
                          {coverTrack?.coverUrl ? (
                            <img
                              src={coverTrack.coverUrl}
                              alt={`${playlist.name} cover`}
                              className="ml-playlist-cover-img"
                            />
                          ) : (
                            <ListMusic size={42} />
                          )}
                        </button>

                        <h3>{playlist.name}</h3>

                        <p>
                          {playlist.trackIds.length}{' '}
                          {playlist.trackIds.length === 1 ? 'song' : 'songs'}
                        </p>

                        <div className="ml-playlist-actions">
                          <button
                            onClick={() => setSelectedPlaylist(playlist.id)}
                          >
                            Open
                          </button>

                          <button
                            onClick={() => playPlaylist(playlist)}
                            disabled={!pTracks.length}
                          >
                            <Play size={15} />
                            Play
                          </button>

                          <button
                            onClick={() => renamePlaylist(playlist)}
                            aria-label={`Rename ${playlist.name}`}
                            title="Rename playlist"
                          >
                            Rename
                          </button>
                          <button
                            className="ml-delete-playlist"
                            onClick={() => deletePlaylist(playlist.id)}
                            aria-label={`Delete ${playlist.name}`}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="ml-state">
                  <ListMusic size={32} />
                  <b>No playlists yet</b>
                  <span />
                </div>
              )}

              {activePlaylist && (
                <div className="ml-selected-playlist">
                  <div className="ml-section-head">
                    <h2>{activePlaylist.name}</h2>

                    <button onClick={() => setSelectedPlaylist(null)}>
                      Close
                    </button>
                  </div>

                  <div className="ml-add-song-row">
                    <label htmlFor="playlist-track-select">Add a song</label>

                    <select
                      id="playlist-track-select"
                      defaultValue=""
                      onChange={event => {
                        const track = tracks.find(
                          item => item.id === event.target.value
                        );

                        if (track) {
                          addToPlaylist(activePlaylist.id, track);
                        }

                        event.target.value = '';
                      }}
                    >
                      <option value="" disabled>
                        Select a song
                      </option>

                      {tracks
                        .filter(
                          track => !activePlaylist.trackIds.includes(track.id)
                        )
                        .map(track => (
                          <option key={track.id} value={track.id}>
                            {track.title} —{' '}
                            {track.artist &&
                            track.artist !== 'MusicLover Library'
                              ? track.artist
                              : getTrackFormat(track)}
                          </option>
                        ))}
                    </select>

                    <button
                      className="ml-create-playlist"
                      onClick={() => playPlaylist(activePlaylist)}
                      disabled={!playlistTracks.length}
                    >
                      <Play size={15} />
                      Play playlist
                    </button>
                  </div>

                  {playlistTracks.map((track, index) => (
                    <div className="ml-song-row ml-playlist-song-row" key={track.id}>
                      <span>{index + 1}</span>

                      <Art track={track} index={index} />

                      <button
                        className="ml-song-title"
                        onClick={() => playTrack(track, playlistTracks)}
                      >
                        <b>{track.title}</b>
                        <small>
                          {track.artist && track.artist !== 'MusicLover Library'
                            ? track.artist
                            : getTrackFormat(track)}
                        </small>
                      </button>

                      <button
                        className="ml-row-play"
                        onClick={() => playTrack(track, playlistTracks)}
                        aria-label={`Play ${track.title}`}
                      >
                        <Play size={15} fill="currentColor" />
                      </button>

                      <button
                        className="ml-delete-playlist"
                        onClick={() =>
                          removeFromPlaylist(activePlaylist.id, track.id)
                        }
                        aria-label={`Remove ${track.title}`}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}

                  {!playlistTracks.length && (
                    <div className="ml-state">
                      <Music2 size={28} />
                      <b>This playlist is empty</b>
                      <span />
                    </div>
                  )}
                </div>
              )}
            </section>
          ) : (
            <>
              {activeTab === 'Home' && (
                <section className="ml-hero">
                  <div className="ml-hero-backdrop">
                    <span className="ml-moon" />
                    <i className="mountain m1" />
                    <i className="mountain m2" />
                    <i className="mountain m3" />
                  </div>

                  <div key={heroSlide} className="ml-hero-copy ml-hero-slide">
                    <span>PLAYLIST</span>
                    <h1>{heroSlides[heroSlide].title}</h1>
                    <p>{heroSlides[heroSlide].subtitle}</p>

                    <button
                      onClick={() => {
                        const track = filtered[0] || tracks[0];
                        if (track) playTrack(track);
                      }}
                      disabled={!tracks.length || loading}
                    >
                      <Play size={18} fill="currentColor" />
                      Play Now
                    </button>
                  </div>

                  <div
                    className="ml-hero-dots"
                    aria-label="Choose playlist slide"
                  >
                    {heroSlides.map((slide, index) => (
                      <button
                        key={slide.title}
                        type="button"
                        aria-label={`Show ${slide.title}`}
                        aria-current={heroSlide === index ? 'true' : undefined}
                        className={heroSlide === index ? 'active' : ''}
                        onClick={() => setHeroSlide(index)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {activeTab === 'Home' && (
                <LikedSongsSlider
                  tracks={tracks}
                  favorites={favorites}
                  current={currentTrack}
                  playing={playing}
                  onPlay={playTrack}
                />
              )}

              <section className="ml-section">
                <div className="ml-section-head">
                  <h2>
                    {activeTab === 'Liked Songs'
                      ? 'Liked Songs'
                      : activeTab === 'Albums'
                        ? 'Albums'
                        : activeTab === 'Artists'
                          ? 'Artists'
                          : activeTab === 'Songs'
                            ? 'All Songs'
                            : 'Recently Added'}
                  </h2>

                  <button
                    onClick={() =>
                      setActiveTab(activeTab === 'Home' ? 'Songs' : 'Home')
                    }
                  >
                    {activeTab === 'Home' ? 'View All' : 'Back Home'}
                    <ChevronRight size={16} />
                  </button>
                </div>

                {loading ? (
                  <div className="ml-state">
                    <LoaderCircle className="spin" />
                    Scanning your music library…
                  </div>
                ) : error && !tracks.length ? (
                  <div className="ml-state error">
                    <AlertCircle />
                    <b>Unable to load music</b>
                    <span>{error}</span>

                    <div className="ml-empty-actions">
                      <button onClick={chooseMusic}>
                        <Music2 size={15} />
                        Choose Music Folder
                      </button>
                      <button onClick={addMusicFiles}>
                        <ListMusic size={15} />
                        Add Audio Files
                      </button>
                    </div>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="ml-state">
                    <Music2 />
                    <b>No songs found</b>
                    <span>
                      Try a different search or add audio files or choose a
                      music folder.
                    </span>
                  </div>
                ) : (
                  <div className="ml-album-grid">
                    {filtered.map((track, index) => (
                      <article className="ml-album-card" key={track.id}>
                        <button
                          className="ml-cover-button"
                          onClick={() => playTrack(track)}
                          aria-label={`Play ${track.title}`}
                        >
                          <Art track={track} index={index} />
                          <span className="ml-cover-play">
                            <Play size={18} fill="currentColor" />
                          </span>
                        </button>

                        <div className="ml-album-meta">
                          <b title={track.title}>
                            {track.title || track.filename || 'Untitled Song'}
                          </b>

                          <span>
                            {track.artist &&
                            track.artist !== 'MusicLover Library'
                              ? track.artist
                              : getTrackFormat(track)}
                          </span>

                          <button
                            onClick={() => playTrack(track)}
                            aria-label={`Play ${track.title}`}
                          >
                            <Play size={14} fill="currentColor" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {activeTab === 'Home' && tracks.length > 0 && (
                <section className="ml-section ml-popular">
                  <div className="ml-section-head">
                    <h2>Popular Songs</h2>

                    <button onClick={() => setActiveTab('Songs')}>
                      View All
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div className="ml-song-table">
                    <div className="ml-song-head">
                      <span>#</span>
                      <span></span>
                      <span>Covers</span>
                      <span>Song</span>
                      <span>Artist</span>
                      <span>Duration</span>
                      <span>Play</span>
                      <span>Loved</span>
                      <span />
                    </div>

                    {tracks.map((track, index) => (
                      <div className="ml-song-row" key={track.id}>
                        <span>{index + 1}</span>

                        <Art track={track} index={index} />

                        <button
                          className="ml-song-title"
                          onClick={() => playTrack(track)}
                        >
                          <b>{track.title}</b>
                          <small>{getTrackFormat(track)}</small>
                        </button>

                        <span className="ml-song-artist">
                          {track.artist &&
                          track.artist !== 'MusicLover Library'
                            ? track.artist
                            : getTrackFormat(track)}
                        </span>

                        <span className="ml-song-duration">
                          {currentTrack?.id === track.id && duration
                            ? time(duration)
                            : track.duration
                              ? time(track.duration)
                              : '—'}
                        </span>

                        <button
                          className="ml-row-play"
                          onClick={() => playTrack(track)}
                          aria-label={`Play ${track.title}`}
                        >
                          <Play size={15} fill="currentColor" />
                        </button>

                        <button
                          className={`ml-row-heart ${
                            favorites.includes(track.id) ? 'liked' : ''
                          }`}
                          onClick={() =>
                            toggleFavorite(track.id)
                          }
                          aria-label="Like song"
                        >
                          <Heart
                            size={17}
                            fill={
                              favorites.includes(track.id)
                                ? 'currentColor'
                                : 'none'
                            }
                          />
                        </button>

                        <button
                          className="ml-add-to-playlist"
                          title="Add to playlist"
                          onClick={() => setPlaylistPickerTrack(track)}
                        >
                          <ListMusic size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        {currentTrack && lyricsVisible && !isOffline && (
          <LiveLyrics
            track={currentTrack}
            currentTime={currentTime}
            playing={playing}
            onSeek={handleLyricsSeek}
            onClose={() => setLyricsVisible(false)}
          />
        )}
        {playlistPickerTrack && (
          <div className="ml-modal-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) setPlaylistPickerTrack(null);
          }}>
            <section className="ml-modal-card" role="dialog" aria-modal="true" aria-label="Add to playlist">
              <div className="ml-modal-head">
                <div><h3>Add to playlist</h3><p>{playlistPickerTrack.title}</p></div>
                <button className="ml-modal-close" onClick={() => setPlaylistPickerTrack(null)} aria-label="Close"><X size={20}/></button>
              </div>
              {playlists.length ? playlists.map(playlist => (
                <button className="ml-playlist-picker-item" key={playlist.id} onClick={() => {
                  addToPlaylist(playlist.id, playlistPickerTrack);
                  setToast(`Added to ${playlist.name}`);
                  setPlaylistPickerTrack(null);
                }}>
                  <ListMusic size={19}/><span>{playlist.name}</span><small>{playlist.trackIds.length} songs</small>
                </button>
              )) : <p className="ml-modal-empty">You haven't created a playlist yet.</p>}
              <button className="ml-create-playlist ml-modal-create" onClick={() => {
                setPlaylistPickerTrack(null); setActiveTab('Playlists'); setShowCreatePlaylist(true);
              }}>+ Create new playlist</button>
            </section>
          </div>
        )}
        {showQueue && (
          <div className="ml-modal-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) setShowQueue(false);
          }}>
            <section className="ml-modal-card ml-queue-card" role="dialog" aria-modal="true" aria-label="Playback queue">
              <div className="ml-modal-head"><div><h3>Up next</h3><p>{getQueueTracks().length} songs in queue</p></div>
                <button className="ml-modal-close" onClick={() => setShowQueue(false)} aria-label="Close"><X size={20}/></button></div>
              {getQueueTracks().map((track, index) => (
                <button className={`ml-queue-item ${currentTrack?.id === track.id ? 'active' : ''}`} key={track.id} onClick={() => { playTrack(track, getQueueTracks()); setShowQueue(false); }}>
                  <span>{index + 1}</span><Art track={track} index={index}/><span className="ml-queue-copy"><b>{track.title}</b><small>{track.artist}</small></span>{currentTrack?.id === track.id ? <AudioLines size={18}/> : <Play size={16}/>}
                </button>
              ))}
            </section>
          </div>
        )}
        {toast && <div className="ml-toast" role="status">{toast}</div>}
      </main>

      <DesktopUpdatePrompt />

      <audio
        ref={audioRef}
        preload="metadata"
        controls={false}
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onLoadedMetadata={event => {
          const audio = event.currentTarget;
          const actualDuration = Number.isFinite(audio.duration)
            ? audio.duration
            : 0;

          setDuration(actualDuration);
          setCurrentTime(audio.currentTime || 0);
          setProgress(
            actualDuration ? (audio.currentTime / actualDuration) * 100 : 0
          );
        }}
        onDurationChange={event => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={event => {
          const audio = event.currentTarget;

          if (!isSeeking) {
            const position = audio.currentTime || 0;

            setCurrentTime(position);
            setProgress(
              audio.duration ? (position / audio.duration) * 100 : 0
            );
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (repeat && audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => setPlaying(false));
          } else {
            playNext();
          }
        }}
        onError={() => {
          if (currentTrack) {
            setError(
              'Unable to play this file. The format may not be supported by the desktop playback engine.'
            );
          }

          setPlaying(false);
        }}
      />

      <footer className="ml-player">
        <div className="ml-player-track">
          {currentTrack ? (
            <Art
              track={currentTrack}
              index={Math.max(
                0,
                tracks.findIndex(track => track.id === currentTrack.id)
              )}
            />
          ) : (
            <div className="ml-player-placeholder">
              <AudioLines />
            </div>
          )}

          <div>
            <b>{currentTrack?.title || 'Choose a song'}</b>
            <span>
              {currentTrack?.artist &&
              currentTrack.artist !== 'MusicLover Library'
                ? currentTrack.artist
                : getTrackFormat(currentTrack)}
            </span>
          </div>

          <button
            className={`ml-row-heart ${
              currentTrack && favorites.includes(currentTrack.id) ? 'liked' : ''
            }`}
            onClick={() => {
              if (!currentTrack) return;

              toggleFavorite(currentTrack.id);
            }}
            aria-label="Like current song"
          >
            <Heart
              size={19}
              fill={
                currentTrack && favorites.includes(currentTrack.id)
                  ? 'currentColor'
                  : 'none'
              }
            />
          </button>
        </div>

        <div className="ml-player-center">
          <div className="ml-player-controls">
            <button
              className={shuffle ? 'selected' : ''}
              onClick={() => setShuffle(value => !value)}
              aria-label="Shuffle"
            >
              <Shuffle size={17} />
            </button>

            <button onClick={playPrev} aria-label="Previous">
              <SkipBack size={19} fill="currentColor" />
            </button>

            <button
              className="ml-big-play"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>

            <button onClick={playNext} aria-label="Next">
              <SkipForward size={19} fill="currentColor" />
            </button>

            <button
              className={repeat ? 'selected' : ''}
              onClick={() => setRepeat(value => !value)}
              aria-label="Repeat"
            >
              <Repeat2 size={17} />
            </button>
            <button
              className={lyricsVisible ? 'selected' : ''}
              onClick={() => {
                if (!currentTrack) return;
                if (isOffline) {
                  setToast('You are offline. Live lyrics are unavailable.');
                  return;
                }
                setLyricsVisible(true);
              }}
              aria-label="Open lyrics"
              title="Open live lyrics"
              disabled={!currentTrack || isOffline}
            >
              <Captions size={19}/>
            </button>
            <button onClick={() => setShowQueue(true)} aria-label="Open queue" title="Playback queue">
              <ListMusic size={18}/>
            </button>
          </div>

          <div className="ml-seek-row">
            <span>{time(currentTime)}</span>

            <input
              ref={seekRef}
              type="range"
              min="0"
              max={duration || audioRef.current?.duration || 1}
              step="0.1"
              value={Math.min(currentTime, duration || 1)}
              onPointerDown={() => setIsSeeking(true)}
              onPointerUp={() => setIsSeeking(false)}
              onBlur={() => setIsSeeking(false)}
              onChange={event => {
                const value = Number(event.target.value);

                setCurrentTime(value);
                setProgress(duration ? (value / duration) * 100 : 0);

                if (audioRef.current) {
                  audioRef.current.currentTime = value;
                }
              }}
              style={{ '--progress': `${progress}%` }}
              aria-label="Song progress"
            />

            <span>{time(duration)}</span>
          </div>
        </div>

        <div className="ml-player-volume">
          <button
            onClick={() => setMuted(value => !value)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? (
              <VolumeX size={18} />
            ) : (
              <Volume2 size={18} />
            )}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={event => {
              setVolume(Number(event.target.value));
              setMuted(false);
            }}
            style={{
              '--progress': `${(muted ? 0 : volume) * 100}%`,
            }}
            aria-label="Volume"
          />
        </div>
      </footer>

      <nav className="ml-mobile-nav">
        {[
          ['Home', Home],
          ['Songs', Music2],
          ['Playlists', ListMusic],
          ['Liked Songs', Heart],
        ].map(([label, Icon]) => (
          <button
            key={label}
            className={activeTab === label ? 'active' : ''}
            onClick={() => setActiveTab(label)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
