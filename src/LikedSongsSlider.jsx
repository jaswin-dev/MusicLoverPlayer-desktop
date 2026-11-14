import { useEffect, useState } from 'react';
import {
  Heart,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Music2,
} from 'lucide-react';

export default function LikedSongsSlider({
  tracks = [],
  favorites = [],
  current,
  playing,
  onPlay,
}) {
  const likedTracks = tracks.filter(track => favorites.includes(track.id));
  const [index, setIndex] = useState(0);
  const [failedUrl, setFailedUrl] = useState(null);

  useEffect(() => {
    setIndex(0);
  }, [likedTracks.length]);

  const safeIndex = likedTracks.length ? index % likedTracks.length : 0;
  const track = likedTracks[safeIndex];

  if (likedTracks.length === 0) {
    return (
      <section className="liked-slider">
        <div className="liked-slider-heading">
          <div>
            <span className="liked-eyebrow"><Heart size={14} /> YOUR COLLECTION</span>
            <h2>Liked Songs</h2>
            <p>Your favourite music, all in one place.</p>
          </div>
        </div>
        <div className="liked-empty">
          <Heart size={32} />
          <b>No liked songs yet</b>
          <span>Tap the heart on a song to add it here.</span>
        </div>
      </section>
    );
  }

  const isCurrent = current?.id === track.id;
  const coverUrl = track?.coverUrl;
  const showCover = Boolean(coverUrl && failedUrl !== coverUrl);

  const move = direction => {
    setIndex(previous => (previous + direction + likedTracks.length) % likedTracks.length);
  };

  return (
    <section className="liked-slider">
      <div className="liked-slider-heading">
        <div>
          <span className="liked-eyebrow"></span>
          <h2>Liked Songs</h2>
          <p>{likedTracks.length} favourite {likedTracks.length === 1 ? 'track' : 'tracks'}</p>
        </div>
        {likedTracks.length > 1 && (
          <div className="liked-arrows">
            <button onClick={() => move(-1)} aria-label="Previous liked song"><ChevronLeft size={20} /></button>
            <button onClick={() => move(1)} aria-label="Next liked song"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>

      <div className="liked-slide" key={track.id}>
        <div className="liked-art">
          {showCover ? (
            <img
              className="liked-art-img"
              src={coverUrl}
              alt={`${track.title || 'Song'} album cover`}
              onError={() => setFailedUrl(coverUrl)}
            />
          ) : (
            <div className="liked-art-circle"><Music2 size={46} /></div>
          )}
          <Heart className="liked-art-heart" size={26} fill="currentColor" />
        </div>
        <div className="liked-info">
          <span className="liked-track-label"><Heart size={14} fill="currentColor" /> YOUR FAVOURITE</span>
          <h3>{track.title || track.filename || 'Untitled song'}</h3>
          <p>{track.artist || 'Unknown artist'}</p>
          <div className="liked-actions">
            <button className="liked-play-button" onClick={() => onPlay?.(track)}>
              {isCurrent && playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
              {isCurrent && playing ? 'Playing' : 'Play song'}
            </button>
            <span>{String(safeIndex + 1).padStart(2, '0')} / {String(likedTracks.length).padStart(2, '0')}</span>
          </div>
        </div>
      </div>

      {likedTracks.length > 1 && (
        <div className="liked-dots">
          {likedTracks.slice(0, 10).map((item, dotIndex) => (
            <button
              key={item.id}
              className={dotIndex === safeIndex ? 'active' : ''}
              onClick={() => setIndex(dotIndex)}
              aria-label={`Show ${item.title || item.filename || 'liked song'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
