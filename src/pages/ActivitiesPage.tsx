import React, { useState, useEffect } from 'react';
import type { PetMood, PetStatus, PetMouthStyle, PetEyeStyle } from '../types';
import type { ClientPetSettings } from '../lib/adapters';
import { PetFacePreview } from '../components/pet/PetFacePreview';
import { YouTubeMusicPlayer } from '../components/activities/YouTubeMusicPlayer';
import type { DanceStyle, DanceIntensity } from '../components/pet/KuroAnimatedFace';
import {
  ALL_PET_MOODS,
  ALL_MOUTH_STYLES,
} from '../lib/pet/faceLifecycle';
import {
  Music,
  Sparkles,
  Eye,
  Dice5,
  PartyPopper,
  Flame,
  Wind,
  RotateCcw,
  Sliders,
  Radio,
} from 'lucide-react';

export type ActivityTab =
  | 'dance'
  | 'roulette'
  | 'peekaboo'
  | 'reaction_lab'
  | 'celebration'
  | 'focus_companion'
  | 'calm_mode';

interface ActivitiesPageProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange: (mood: PetMood) => void;
  petSettings: ClientPetSettings;
  onUpdatePetSettings: (newSettings: Partial<ClientPetSettings>) => Promise<boolean>;
}

export const ActivitiesPage: React.FC<ActivitiesPageProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  petSettings,
  onUpdatePetSettings: _onUpdatePetSettings,
}) => {
  const [activeTab, setActiveTab] = useState<ActivityTab>('dance');

  // Dance Party State
  const [isDancing, setIsDancing] = useState(false);
  const [danceStyle, setDanceStyle] = useState<DanceStyle>('sway');
  const [danceIntensity, setDanceIntensity] = useState<DanceIntensity>('normal');
  const [activeTrackTitle, setActiveTrackTitle] = useState('Lofi Girl — Synthwave Chill Beats');

  // Mood Roulette State
  const [isSpinning, setIsSpinning] = useState(false);
  const [rouletteDialogue, setRouletteDialogue] = useState<string | null>(null);

  // Peekaboo State
  const [peekabooState, setPeekabooState] = useState<'revealed' | 'hiding'>('revealed');
  const [peekabooText, setPeekabooText] = useState<string | null>(null);

  // Reaction Lab Overrides
  const [labMouthStyle, setLabMouthStyle] = useState<PetMouthStyle | null>(null);
  const [labEyeStyle, setLabEyeStyle] = useState<PetEyeStyle | null>(null);
  const [labCustomText, setLabCustomText] = useState('Testing Kuro visor phonemes!');
  const [isLabSpeaking, setIsLabSpeaking] = useState(false);

  // Celebration State
  const [celebrationActive, setCelebrationActive] = useState(false);

  // Calm Mode & Breathing Pacer State
  const [breathPhase, setBreathPhase] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');

  // Breathing pacer effect for Calm Mode
  useEffect(() => {
    if (activeTab !== 'calm_mode') return;

    let timer: number;
    const runBreathingCycle = () => {
      // 4s Inhale -> 4s Hold -> 4s Exhale
      setBreathPhase('Inhale');

      timer = window.setTimeout(() => {
        setBreathPhase('Hold');

        timer = window.setTimeout(() => {
          setBreathPhase('Exhale');

          timer = window.setTimeout(() => {
            runBreathingCycle();
          }, 4000);
        }, 4000);
      }, 4000);
    };

    runBreathingCycle();
    return () => clearTimeout(timer);
  }, [activeTab]);

  // Derived effective facial properties for face preview
  const effectiveMouthStyle =
    labMouthStyle ?? (activeTab === 'calm_mode' ? 'closed_smile' : undefined);
  const effectiveEyeStyle =
    peekabooState === 'hiding'
      ? 'blink'
      : labEyeStyle ?? (activeTab === 'calm_mode' ? 'sleepy_lids' : undefined);

  const effectiveSpeechText =
    peekabooText ?? (isLabSpeaking ? labCustomText : null);

  // Handle Mood Roulette Spin
  const handleSpinRoulette = () => {
    if (isSpinning) return;
    setIsSpinning(true);
    setRouletteDialogue(null);

    let counter = 0;
    const totalSteps = 18;
    const interval = setInterval(() => {
      const randomIdx = Math.floor(Math.random() * ALL_PET_MOODS.length);
      const intermediateMood = ALL_PET_MOODS[randomIdx].id;
      onMoodChange(intermediateMood);
      counter++;

      if (counter >= totalSteps) {
        clearInterval(interval);
        const finalMood = ALL_PET_MOODS[Math.floor(Math.random() * ALL_PET_MOODS.length)].id;
        onMoodChange(finalMood);
        setIsSpinning(false);

        const dialogues: Record<PetMood, string> = {
          idle: 'Resting ambient circuits! Ready when you are.',
          attentive: 'Visor focused and observing your workspace.',
          focused: 'Deep focus initiated! Let us get things done.',
          curious: 'Ooh, what fascinating problem are we solving?',
          thinking: 'Analyzing logical possibilities in RAM...',
          happy: 'Feeling joyful and energized today! ✨',
          excited: 'Whoa! High spirits! Let us make something amazing!',
          sleepy: 'Yaaawn... A cozy nap would feel wonderful.',
          playful: 'Tag, you are it! Hehe, having fun yet?',
          caring: 'Remember to stay hydrated and rest your eyes!',
          surprised: 'Oh! A surprise turn in our daily routine!',
          confused: 'Hmm? Wait, let me re-evaluate that context.',
          worried: 'Checking upcoming deadlines! Everything okay?',
          proud: 'Look at what we accomplished! Outstanding work!',
          listening: 'I am all digital ears, listening attentively.',
          speaking: 'Phonemes active on the 2.4-inch visor screen!',
          error: 'Self-diagnostics caught a minor hiccup, recovered!',
        };

        setRouletteDialogue(dialogues[finalMood] || 'Ready for productivity!');
      }
    }, 100);
  };

  // Handle Peekaboo Toggle
  const handleTogglePeekaboo = () => {
    if (peekabooState === 'revealed') {
      setPeekabooState('hiding');
      setPeekabooText('Where is Kuro?...');
      onMoodChange('sleepy');
    } else {
      setPeekabooState('revealed');
      setPeekabooText('Peekaboo! I see you! 🙈🎉');
      onMoodChange('excited');
      setTimeout(() => {
        setPeekabooText(null);
      }, 3500);
    }
  };

  // Handle Trigger Celebration
  const handleTriggerCelebration = () => {
    setCelebrationActive(true);
    onMoodChange('proud');
    setTimeout(() => {
      setCelebrationActive(false);
    }, 4500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles style={{ color: 'var(--accent-primary)' }} size={20} />
            <span>Kuro Playful Activities &amp; Music Reactions</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Engage with interactive games, music-reactive dancing, and relaxation tools for your screen robot companion.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Radio size={11} /> Screen-Only Physical Robot
          </span>
        </div>
      </div>

      {/* Activities Tab Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {[
          { id: 'dance', label: 'Dance Party', icon: Music },
          { id: 'roulette', label: 'Mood Roulette', icon: Dice5 },
          { id: 'peekaboo', label: 'Peekaboo', icon: Eye },
          { id: 'reaction_lab', label: 'Reaction Lab', icon: Sliders },
          { id: 'celebration', label: 'Celebration', icon: PartyPopper },
          { id: 'focus_companion', label: 'Focus Companion', icon: Flame },
          { id: 'calm_mode', label: 'Calm Breathing', icon: Wind },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(tab.id as ActivityTab)}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Split Layout: Left Visor Preview | Right Activity Controls */}
      <div className="dashboard-grid">
        {/* Left: Live Visor Display Preview */}
        <div className="col-5" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <PetFacePreview
            petStatus={{ ...petStatus, name: petSettings.petName }}
            currentMood={currentMood}
            onMoodChange={onMoodChange}
            eyeShape={petSettings.eyeShape}
            glowColor={petSettings.glowColor}
            mouthStyle={effectiveMouthStyle}
            eyeStyle={effectiveEyeStyle}
            interactive={true}
            speechText={effectiveSpeechText}
            isSpeaking={isLabSpeaking || Boolean(peekabooText)}
            isDancing={isDancing && activeTab === 'dance'}
            danceStyle={danceStyle}
            danceIntensity={danceIntensity}
          />

          {/* Activity State Card */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Active Companion State
              </span>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--accent-primary)' }}>
                Mood: {currentMood}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <div>Mode: <strong>{activeTab.replace('_', ' ').toUpperCase()}</strong></div>
              <div>Dancing: <strong>{isDancing && activeTab === 'dance' ? `Active (${danceStyle})` : 'Idle'}</strong></div>
              <div>Screen Hardware: <strong>2.4" TFT LCD (No Motors / Servos)</strong></div>
            </div>
          </div>
        </div>

        {/* Right: Dynamic Activity Workspaces */}
        <div className="col-7" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* TAB 1: DANCE PARTY */}
          {activeTab === 'dance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Dance Style & Intensity Card */}
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={16} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>Visual Dance Motion Controls</span>
                  </div>
                  <span className="badge badge-active">{isDancing ? 'Dancing Active' : 'Dance Paused'}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Dance Styles */}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                      Dance Animation Style:
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      {(
                        [
                          { id: 'sway', label: 'Groove Sway', sub: 'Side Tilt' },
                          { id: 'bounce', label: 'Robot Bounce', sub: 'Up & Down' },
                          { id: 'disco', label: 'Disco Pulse', sub: 'Glow Hue' },
                          { id: 'headbob', label: 'Head Bob', sub: 'Rhythmic Nod' },
                        ] as const
                      ).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`expression-btn ${danceStyle === s.id ? 'active' : ''}`}
                          onClick={() => setDanceStyle(s.id)}
                          style={{ padding: '6px 4px', textAlign: 'center' }}
                        >
                          <span style={{ fontWeight: 600, fontSize: '11px', display: 'block' }}>{s.label}</span>
                          <span style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>{s.sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dance Intensity */}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                      Movement Tempo &amp; Intensity:
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      {(['subtle', 'normal', 'energetic'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          className={`expression-btn ${danceIntensity === lvl ? 'active' : ''}`}
                          onClick={() => setDanceIntensity(lvl)}
                          style={{ padding: '6px', textTransform: 'capitalize', fontSize: '11.5px' }}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* YouTube Music Player Component */}
              <YouTubeMusicPlayer
                isPlaying={isDancing}
                onPlaybackChange={setIsDancing}
                activeStationTitle={activeTrackTitle}
                onStationChange={setActiveTrackTitle}
              />
            </div>
          )}

          {/* TAB 2: MOOD ROULETTE */}
          {activeTab === 'roulette' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Dice5 size={22} style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Kuro Mood Roulette</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Spin the wheel to randomize Kuro's expression and hear a unique thought!
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '24px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px',
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {isSpinning ? '🎲 Spinning through 17 mood states...' : 'Click spin to pick a mood:'}
                </div>

                <div
                  style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: 'var(--accent-primary)',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '1px',
                  }}
                >
                  {currentMood}
                </div>

                {rouletteDialogue && (
                  <div
                    style={{
                      padding: '10px 16px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '12.5px',
                      color: 'var(--text-primary)',
                      textAlign: 'center',
                      maxWidth: '85%',
                    }}
                  >
                    "{rouletteDialogue}"
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSpinRoulette}
                  disabled={isSpinning}
                  style={{ padding: '8px 24px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <RotateCcw size={14} style={{ animation: isSpinning ? 'spin 0.6s linear infinite' : 'none' }} />
                  <span>{isSpinning ? 'Spinning...' : 'Spin Mood Wheel'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: PEEKABOO */}
          {activeTab === 'peekaboo' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Eye size={22} style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Visor Peekaboo</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Play hide and seek with Kuro on the digital screen!
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '24px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {peekabooState === 'hiding' ? '🙈 Kuro closed eyes and hid!' : '👀 Kuro is watching happily!'}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleTogglePeekaboo}
                  style={{ padding: '10px 24px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Eye size={15} />
                  <span>{peekabooState === 'hiding' ? 'Peekaboo! Reveal Eyes!' : 'Hide Kuro Visor'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: REACTION LAB */}
          {activeTab === 'reaction_lab' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Sliders size={20} style={{ color: 'var(--accent-primary)' }} />
                  <div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 600, margin: 0 }}>Expression Reaction Lab</h3>
                    <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: 0 }}>
                      Quickly audition all 17 moods and 10 distinct mouth shapes
                    </p>
                  </div>
                </div>

                {(labMouthStyle || labEyeStyle) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setLabMouthStyle(null);
                      setLabEyeStyle(null);
                    }}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    Reset Overrides
                  </button>
                )}
              </div>

              {/* 17 Moods Grid */}
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                  Select Mood (17 States):
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {ALL_PET_MOODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`expression-btn ${currentMood === m.id ? 'active' : ''}`}
                      onClick={() => onMoodChange(m.id)}
                      style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    >
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 10 Mouth Shapes Grid */}
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                  Select Mouth Shape (10 Geometries):
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                  {ALL_MOUTH_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      className={`expression-btn ${labMouthStyle === style.id ? 'active' : ''}`}
                      onClick={() => setLabMouthStyle(style.id)}
                      style={{ padding: '5px 4px', fontSize: '10.5px', textAlign: 'center' }}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Speech Simulator Form */}
              <div style={{ display: 'flex', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                <input
                  type="text"
                  value={labCustomText}
                  onChange={(e) => setLabCustomText(e.target.value)}
                  placeholder="Test speech text..."
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsLabSpeaking(true)}
                  disabled={!labCustomText.trim() || isLabSpeaking}
                  style={{ padding: '6px 12px', fontSize: '11.5px' }}
                >
                  Speak
                </button>
                {isLabSpeaking && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsLabSpeaking(false)}
                    style={{ padding: '6px 10px', fontSize: '11.5px', color: 'var(--status-red)' }}
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: CELEBRATION */}
          {activeTab === 'celebration' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <PartyPopper size={22} style={{ color: 'var(--accent-secondary)' }} />
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Task Celebration Bursts</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Celebrate micro-wins and milestone completions with Kuro!
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '24px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px',
                }}
              >
                <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', textAlign: 'center' }}>
                  {celebrationActive ? '🎉 VICTORY! OUTSTANDING PROGRESS! 🎉' : 'Ready to celebrate your productivity achievements?'}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleTriggerCelebration}
                  style={{ padding: '10px 24px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <PartyPopper size={16} />
                  <span>Trigger Celebration Burst!</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: FOCUS COMPANION */}
          {activeTab === 'focus_companion' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Flame size={22} style={{ color: 'var(--status-amber)' }} />
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Focus Companion Mode</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Lock in with Kuro in dedicated deep-focus visual mode
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '20px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  During focus sessions, Kuro maintains a quiet, disciplined visor expression (Focused mood, minimal speech chatter)
                  to keep your concentration unbroken.
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onMoodChange('focused')}
                  style={{ alignSelf: 'flex-start', padding: '7px 16px', fontSize: '12px' }}
                >
                  Enter Focused Mode
                </button>
              </div>
            </div>
          )}

          {/* TAB 7: CALM BREATHING */}
          {activeTab === 'calm_mode' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Wind size={22} style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Calm Breathing Pacer</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Slow, reduced-motion breathing rhythm for relaxation and focus reset
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '28px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Breathing Rhythm Pacer
                </div>

                <div
                  style={{
                    fontSize: '26px',
                    fontWeight: 700,
                    color: 'var(--accent-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {breathPhase}
                </div>

                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '80%', margin: 0 }}>
                  Synchronize your breathing with Kuro. Reduced-motion mode is active with soft cyan idle visor glow.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
