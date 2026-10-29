import React, { useState, useEffect, useRef } from 'react';
import {
  Music,
  Play,
  Square,
  Info,
  Search,
  Check,
} from 'lucide-react';
import {
  YOUTUBE_PRESET_STATIONS,
  extractYouTubeVideoId,
  buildYouTubeEmbedUrl,
  type YouTubeTrackPreset,
} from '../../lib/integrations/youtubeHelper';

interface YouTubeMusicPlayerProps {
  isPlaying: boolean;
  onPlaybackChange: (playing: boolean) => void;
  activeStationTitle?: string;
  onStationChange?: (title: string) => void;
}

export const YouTubeMusicPlayer: React.FC<YouTubeMusicPlayerProps> = ({
  isPlaying,
  onPlaybackChange,
  activeStationTitle,
  onStationChange,
}) => {
  const [selectedStation, setSelectedStation] = useState<YouTubeTrackPreset>(YOUTUBE_PRESET_STATIONS[0]);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string>(selectedStation.videoId);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Synchronize initial station title
  useEffect(() => {
    if (onStationChange && !activeStationTitle) {
      onStationChange(selectedStation.title);
    }
  }, [selectedStation, onStationChange, activeStationTitle]);

  const handleSelectPreset = (station: YouTubeTrackPreset) => {
    setSelectedStation(station);
    setActiveVideoId(station.videoId);
    setCustomError(null);
    if (onStationChange) {
      onStationChange(station.title);
    }
  };

  const handleLoadCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);
    const parsedId = extractYouTubeVideoId(customUrlInput);
    if (!parsedId) {
      setCustomError('Please enter a valid YouTube URL (e.g. https://www.youtube.com/watch?v=...) or 11-character video ID.');
      return;
    }

    setActiveVideoId(parsedId);
    const customTitle = `Custom Track (${parsedId})`;
    setSelectedStation({
      id: 'custom',
      videoId: parsedId,
      title: customTitle,
      genre: 'User Provided',
      description: 'Custom YouTube stream loaded into Kuro visual companion.',
    });
    if (onStationChange) {
      onStationChange(customTitle);
    }
    setCustomUrlInput('');
  };

  const togglePlayback = () => {
    const nextState = !isPlaying;
    onPlaybackChange(nextState);

    // Try posting postMessage to YouTube iframe API if supported
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        const command = nextState
          ? JSON.stringify({ event: 'command', func: 'playVideo', args: '' })
          : JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' });
        iframeRef.current.contentWindow.postMessage(command, '*');
      } catch {
        // Cross-origin message safety fallback
      }
    }
  };

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '18px 20px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(236, 72, 153, 0.12)',
              color: 'var(--accent-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Music size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>YouTube Music &amp; Ambient Beats</span>
              <span className="badge badge-active" style={{ fontSize: '10px' }}>
                Screen Reactive
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              Stream focus beats and watch Kuro dance visually on screen.
            </div>
          </div>
        </div>

        {/* Playback / Dance State Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${isPlaying ? 'btn-primary' : 'btn-secondary'}`}
            onClick={togglePlayback}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isPlaying ? (
              <>
                <Square size={12} />
                <span>Pause &amp; Stop Dance</span>
              </>
            ) : (
              <>
                <Play size={12} />
                <span>Play &amp; Start Dance</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preset Stations Selector */}
      <div>
        <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
          Curated Productivity &amp; Study Stations:
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          {YOUTUBE_PRESET_STATIONS.map((station) => {
            const isSelected = activeVideoId === station.videoId;
            return (
              <button
                key={station.id}
                type="button"
                className={`expression-btn ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelectPreset(station)}
                style={{
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  gap: '3px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {station.title}
                  </span>
                  {isSelected && <Check size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />}
                </div>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  {station.genre}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom URL Input Form */}
      <form onSubmit={handleLoadCustomUrl} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Or Load Custom YouTube URL / Video ID:
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={customUrlInput}
            onChange={(e) => setCustomUrlInput(e.target.value)}
            placeholder="Paste YouTube URL (e.g. https://www.youtube.com/watch?v=...)"
            style={{
              flex: 1,
              padding: '7px 12px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '12px',
            }}
          />
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!customUrlInput.trim()}
            style={{ padding: '7px 14px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <Search size={13} />
            <span>Load Video</span>
          </button>
        </div>
        {customError && (
          <span style={{ fontSize: '11px', color: 'var(--status-red)' }}>{customError}</span>
        )}
      </form>

      {/* Embedded YouTube Player Frame */}
      <div
        style={{
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          backgroundColor: '#000',
          border: '1px solid var(--border-subtle)',
          aspectRatio: '16 / 9',
          maxHeight: '260px',
          width: '100%',
          position: 'relative',
        }}
      >
        <iframe
          ref={iframeRef}
          src={buildYouTubeEmbedUrl(activeVideoId, { autoplay: isPlaying, mute: false })}
          title={`YouTube Player: ${selectedStation.title}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      </div>

      {/* Screen-Only Robot Hardware Disclaimer */}
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-card-subtle)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <Info size={14} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent-primary)' }} />
        <span>
          <strong>Screen-Only Companion Guarantee:</strong> Audio plays through your computer or browser speakers.
          Kuro has zero physical speakers, motor servos, or moving parts. Dancing is an animated visual visor effect
          displayed on Kuro's screen.
        </span>
      </div>
    </div>
  );
};
