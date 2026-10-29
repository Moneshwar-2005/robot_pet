/**
 * YouTube URL Parser & Video ID Validator for Kuro Music Reactions.
 *
 * Safe parsing for standard, short, embed, and music YouTube URLs.
 * Rejects malicious schemes, javascript:, file:, or unapproved parameters.
 */

export interface YouTubeTrackPreset {
  id: string;
  videoId: string;
  title: string;
  genre: string;
  bpmEstimate?: number;
  description: string;
}

export const YOUTUBE_PRESET_STATIONS: readonly YouTubeTrackPreset[] = [
  {
    id: 'lofi-girl',
    videoId: 'jfKfPfyJRdk',
    title: 'Lofi Girl — Synthwave Chill Beats',
    genre: 'Lofi / Chillwave',
    bpmEstimate: 85,
    description: 'Mellow synthwave and lofi grooves for deep study and coding.',
  },
  {
    id: 'cozy-coffee',
    videoId: '-5KAN9_CzSA',
    title: 'Cozy Coffee Shop & Rain Ambience',
    genre: 'Acoustic / Ambience',
    bpmEstimate: 70,
    description: 'Gentle rainy cafe piano ambience for focused reading.',
  },
  {
    id: 'peaceful-piano',
    videoId: '4xDzrJKXOOY',
    title: 'Peaceful Piano Work & Focus',
    genre: 'Classical Piano',
    bpmEstimate: 75,
    description: 'Tranquil classical piano melodies to maintain concentration.',
  },
  {
    id: 'space-ambient',
    videoId: 'n_v_m5XvDfc',
    title: 'Deep Space Cosmic Ambient',
    genre: 'Ambient Soundscape',
    bpmEstimate: 60,
    description: 'Slow cosmic synthesizer pads for calm reflection and night work.',
  },
];

/**
 * Extracts the 11-character YouTube video ID from a URL or raw ID string.
 * Returns null if invalid or unsupported.
 */
export function extractYouTubeVideoId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Bare 11-char ID check (alphanumeric, underscores, hyphens)
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();

    // Standard youtube.com or music.youtube.com
    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com') {
      // /watch?v=VIDEO_ID
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
      // /embed/VIDEO_ID or /v/VIDEO_ID or /live/VIDEO_ID
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'embed' || parts[0] === 'v' || parts[0] === 'live') && parts[1]) {
        const candidate = parts[1].slice(0, 11);
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    }

    // Shortened youtu.be/VIDEO_ID
    if (host === 'youtu.be') {
      const candidate = url.pathname.replace(/^\/+/, '').slice(0, 11);
      if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Not a valid URL format
  }

  return null;
}

/**
 * Generates an accessible, sandboxed iframe embed URL for YouTube.
 */
export function buildYouTubeEmbedUrl(videoId: string, options?: { autoplay?: boolean; mute?: boolean }): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
    autoplay: options?.autoplay ? '1' : '0',
    mute: options?.mute ? '1' : '0',
    controls: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
  });

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

