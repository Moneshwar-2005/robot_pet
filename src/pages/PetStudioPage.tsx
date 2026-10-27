import React, { useState } from 'react';
import type { PetStatus, PetMood, PetMouthStyle, PetEyeStyle, ReactionFrequency } from '../types';
import type { ClientPetSettings } from '../lib/adapters';
import { defaultPetSettings } from '../hooks/usePetSettings';
import { PetFacePreview } from '../components/pet/PetFacePreview';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import {
  ALL_MOUTH_STYLES,
  DEFAULT_DOCUMENTED_PET_SETTINGS,
  getMoodDefaultMouthStyle,
  getMoodDefaultEyeStyle,
} from '../lib/pet/faceLifecycle';
import {
  Cpu,
  Sliders,
  Eye,
  Check,
  RefreshCw,
  AlertCircle,
  Loader2,
  RotateCcw,
  MessageSquare,
  Play,
  Square,
  Info,
  Smile,
  Bot,
  Globe,
  Pause,
  Plus,
  Trash2,
} from 'lucide-react';

const ALL_EYE_STYLES: readonly { id: PetEyeStyle; label: string; icon: string }[] = [
  { id: 'standard', label: 'Standard Visor', icon: '👀' },
  { id: 'blink', label: 'Blink', icon: '😑' },
  { id: 'squint', label: 'Squint', icon: '🧐' },
  { id: 'happy_curved', label: 'Happy Curved', icon: '😄' },
  { id: 'curious_widened', label: 'Curious Widened', icon: '😳' },
  { id: 'sleepy_lids', label: 'Sleepy Lids', icon: '😴' },
  { id: 'asymmetrical_wink', label: 'Playful Wink', icon: '😉' },
  { id: 'gaze_drift', label: 'Gaze Drift', icon: '🙄' },
];

interface PetStudioPageProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange: (mood: PetMood) => void;
  petSettings: ClientPetSettings;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onUpdatePetSettings: (newSettings: Partial<ClientPetSettings>) => Promise<boolean>;
  onResetPetSettings?: () => Promise<boolean | void> | void;
  onRetry?: () => void;
  autonomousMouthStyle?: PetMouthStyle;
  autonomousEyeStyle?: PetEyeStyle;
  autonomousSpeechText?: string | null;
  autonomousIsSpeaking?: boolean;
  isAutonomousPaused?: boolean;
  onPauseAutonomy?: (minutes?: number) => Promise<boolean>;
  onResumeAutonomy?: () => Promise<boolean>;
}

export const PetStudioPage: React.FC<PetStudioPageProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  petSettings,
  loading = false,
  saving = false,
  error = null,
  onUpdatePetSettings,
  onResetPetSettings,
  onRetry,
  autonomousMouthStyle,
  autonomousEyeStyle,
  autonomousSpeechText,
  autonomousIsSpeaking,
  isAutonomousPaused = false,
  onPauseAutonomy,
  onResumeAutonomy,
}) => {
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Expression testing state (manual override preview in studio)
  const [selectedMouthStyle, setSelectedMouthStyle] = useState<PetMouthStyle | null>(null);
  const [selectedEyeStyle, setSelectedEyeStyle] = useState<PetEyeStyle | null>(null);

  // Speech preview state
  const [speechPhrase, setSpeechPhrase] = useState('Hi, I am Kuro! Ready to focus?');
  const [activeSpeechText, setActiveSpeechText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Excluded domain input
  const [customDomainInput, setCustomDomainInput] = useState('');

  const displayedPetName = nameInput ?? petSettings.petName;

  // Determine effective mouth & eye style
  const effectiveMouthStyle = selectedMouthStyle ?? autonomousMouthStyle ?? getMoodDefaultMouthStyle(currentMood);
  const effectiveEyeStyle = selectedEyeStyle ?? autonomousEyeStyle ?? getMoodDefaultEyeStyle(currentMood);
  const effectiveSpeechText = activeSpeechText ?? autonomousSpeechText ?? null;
  const effectiveIsSpeaking = isSpeaking || Boolean(autonomousIsSpeaking);

  const triggerSuccessBadge = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleNameBlur = () => {
    if (nameInput !== null && nameInput.trim() && nameInput.trim() !== petSettings.petName) {
      void onUpdatePetSettings({ petName: nameInput.trim() }).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    }
    setNameInput(null);
  };

  const handleShapeChange = (shape: 'curved' | 'round' | 'pixel') => {
    void onUpdatePetSettings({ eyeShape: shape }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleColorChange = (color: 'cyan' | 'emerald' | 'amber' | 'violet') => {
    void onUpdatePetSettings({ glowColor: color }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handlePlayfulnessChange = (val: number) => {
    void onUpdatePetSettings({ playfulness: val }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleFocusDisciplineChange = (val: number) => {
    void onUpdatePetSettings({ focusDiscipline: val }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleSpeakPreview = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!speechPhrase.trim()) return;

    setActiveSpeechText(speechPhrase.trim());
    setIsSpeaking(true);
    onMoodChange('speaking');
  };

  const handleStopSpeech = () => {
    setActiveSpeechText(null);
    setIsSpeaking(false);
    if (currentMood === 'speaking') {
      onMoodChange('attentive');
    }
  };

  const handleSpeechEnd = () => {
    setActiveSpeechText(null);
    setIsSpeaking(false);
    if (currentMood === 'speaking') {
      onMoodChange('attentive');
    }
  };

  const handleMoodSelect = (mood: PetMood) => {
    onMoodChange(mood);
    // Reset manual overrides so mood defaults apply cleanly
    setSelectedMouthStyle(null);
    setSelectedEyeStyle(null);
  };

  // Autonomous Engine controls
  const isAutonomyActive = petSettings.autonomousEnabled !== false;
  const isPaused = isAutonomousPaused || Boolean(petSettings.pausedUntil && currentTime < petSettings.pausedUntil);

  const handleToggleAutonomy = () => {
    void onUpdatePetSettings({ autonomousEnabled: !isAutonomyActive }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleReactionFrequencyChange = (freq: ReactionFrequency) => {
    void onUpdatePetSettings({ reactionFrequency: freq }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handlePauseAutonomy = (minutes = 30) => {
    if (onPauseAutonomy) {
      void onPauseAutonomy(minutes).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    } else {
      const pausedUntil = Date.now() + minutes * 60 * 1000;
      void onUpdatePetSettings({ pausedUntil }).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    }
  };

  const handleResumeAutonomy = () => {
    if (onResumeAutonomy) {
      void onResumeAutonomy().then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    } else {
      void onUpdatePetSettings({ pausedUntil: null }).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    }
  };

  const handleToggleBrowserAwareness = () => {
    const current = Boolean(petSettings.browserAwarenessEnabled);
    void onUpdatePetSettings({ browserAwarenessEnabled: !current }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const currentExcludedDomains = petSettings.excludedDomains || DEFAULT_DOCUMENTED_PET_SETTINGS.excludedDomains;

  const handleAddExcludedDomain = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDomainInput.trim()) return;
    const cleanDomain = customDomainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!currentExcludedDomains.includes(cleanDomain)) {
      void onUpdatePetSettings({ excludedDomains: [...currentExcludedDomains, cleanDomain] }).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    }
    setCustomDomainInput('');
  };

  const handleRemoveExcludedDomain = (domain: string) => {
    void onUpdatePetSettings({ excludedDomains: currentExcludedDomains.filter((d) => d !== domain) }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      if (onResetPetSettings) {
        await onResetPetSettings();
      } else {
        await onUpdatePetSettings(defaultPetSettings);
      }
      onMoodChange('attentive');
      setSelectedMouthStyle(null);
      setSelectedEyeStyle(null);
      setShowResetConfirm(false);
      triggerSuccessBadge();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 7.4: Autonomous Pet &amp; Expressive Face"
        title="Digital Avatar &amp; Autonomous Pet Studio"
        description="Configure Kuro's expressive 2.4-inch visor, mouth animations, eye variations, and privacy-respecting autonomous behavior rules."
      />

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        {/* Left Column: Interactive Face Visor Preview & Expression Style Tester */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <PetFacePreview
            petStatus={{ ...petStatus, name: petSettings.petName }}
            currentMood={currentMood}
            onMoodChange={handleMoodSelect}
            eyeShape={petSettings.eyeShape}
            glowColor={petSettings.glowColor}
            mouthStyle={effectiveMouthStyle}
            eyeStyle={effectiveEyeStyle}
            interactive={true}
            speechText={effectiveSpeechText}
            isSpeaking={effectiveIsSpeaking}
            onSpeechEnd={handleSpeechEnd}
            onCancelSpeech={handleStopSpeech}
            showSpeechControls={false}
          />

          {/* Mouth & Expression Style Tester Card (Phase 7.4) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Smile className="card-icon" style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 className="card-title">Mouth &amp; Expression Tester</h3>
                  <p className="card-subtitle">Test 10 distinct mouth shapes and 8 expressive eye variations</p>
                </div>
              </div>
              {(selectedMouthStyle || selectedEyeStyle) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedMouthStyle(null);
                    setSelectedEyeStyle(null);
                  }}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  title="Reset to mood defaults"
                >
                  Reset To Mood
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Mouth Shapes */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Mouth Styles (10 Shapes)
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Active: {effectiveMouthStyle}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                  {ALL_MOUTH_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      className={`expression-btn ${effectiveMouthStyle === style.id ? 'active' : ''}`}
                      onClick={() => setSelectedMouthStyle(style.id)}
                      title={style.description}
                      style={{
                        padding: '6px 4px',
                        fontSize: '11px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>{style.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Eye Variations */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Eye Variations (8 Styles)
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Active: {effectiveEyeStyle}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {ALL_EYE_STYLES.map((eye) => (
                    <button
                      key={eye.id}
                      type="button"
                      className={`expression-btn ${effectiveEyeStyle === eye.id ? 'active' : ''}`}
                      onClick={() => setSelectedEyeStyle(eye.id)}
                      style={{
                        padding: '6px 4px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>{eye.icon}</span>
                      <span style={{ fontSize: '11px' }}>{eye.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                <Info size={12} />
                <span>320x240 TFT LCD target compatible. Respects prefers-reduced-motion when user system accessibility is enabled.</span>
              </div>
            </div>
          </div>

          {/* Speech Preview & Simulator Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <MessageSquare className="card-icon" style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 className="card-title">Visual Speech Simulator</h3>
                  <p className="card-subtitle">Screen-only visual speech text &amp; mouth animation</p>
                </div>
              </div>
              <span className="badge badge-active">Screen Only (No Speaker)</span>
            </div>

            <form onSubmit={handleSpeakPreview} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label
                  htmlFor="speechPhraseInput"
                  style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}
                >
                  Speech Phrase to Preview
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="speechPhraseInput"
                    type="text"
                    value={speechPhrase}
                    onChange={(e) => setSpeechPhrase(e.target.value)}
                    placeholder='Type phrase (e.g. "Hi, ready to focus?")...'
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!speechPhrase.trim() || isSpeaking}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                    title="Animate mouth and speak text on face visor"
                  >
                    <Play size={13} />
                    <span>Speak Preview</span>
                  </button>

                  {isSpeaking && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleStopSpeech}
                      style={{ color: 'var(--status-red)', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                      title="Stop speaking animation immediately"
                      aria-label="Stop speaking animation"
                    >
                      <Square size={13} />
                      <span>Stop</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Preset quick test chips */}
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  Quick Speech Presets:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    'Hi!',
                    'Ready for a 25-minute deep focus sprint?',
                    'Don’t forget to stay hydrated and take eye breaks!',
                    'All scheduled tasks completed. Outstanding work!',
                  ].map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setSpeechPhrase(phrase);
                        setActiveSpeechText(phrase);
                        setIsSpeaking(true);
                        onMoodChange('speaking');
                      }}
                      style={{ padding: '3px 9px', fontSize: '11px', borderRadius: 'var(--radius-pill)' }}
                    >
                      {phrase.length > 25 ? `${phrase.slice(0, 24)}...` : phrase}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                <Info size={12} />
                <span>Kuro has no physical speakers or audio hardware. Speech is visually rendered through mouth phoneme animation and on-screen text.</span>
              </div>
            </form>
          </div>

          {/* Physical Hardware Mapping Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Cpu className="card-icon" />
                <div>
                  <h3 className="card-title">Physical Hardware Mapping</h3>
                  <p className="card-subtitle">Approved Phase 7 hardware specification</p>
                </div>
              </div>
              <span className="badge badge-planned">Planned (Phase 7)</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Microcontroller</span>
                <span className="mono">ESP32-S3 Dual-Core (Phase 7)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Visor Display Protocol</span>
                <span className="mono">2.4" TFT LCD Display (320x240 SPI)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Physical Actuation</span>
                <span className="mono">None (Screen-Only Enclosure, Fixed Visor)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Audio Output</span>
                <span className="mono">None (Screen-Only, Visual Speech Phonemes)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Autonomous Pet Settings & Avatar Customization */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Autonomous Pet Behaviour Engine Card (Phase 7.4) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Bot className="card-icon" style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h3 className="card-title">Autonomous Digital Pet Engine</h3>
                  <p className="card-subtitle">Context-aware 5-second evaluation &amp; deterministic reactions</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className={`btn ${isAutonomyActive ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={handleToggleAutonomy}
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                >
                  {isAutonomyActive ? 'Autonomy Enabled' : 'Autonomy Paused'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Autonomy Active status & temporary pause */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'var(--bg-card-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>
                    {isPaused ? 'Reactions Temporarily Paused' : isAutonomyActive ? 'Autonomous Engine Active' : 'Autonomy Disabled'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {isPaused && petSettings.pausedUntil
                      ? `Paused until ${new Date(petSettings.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'Evaluates focus, reminders, tasks, and permitted tabs on a 5s cadence'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {isPaused ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleResumeAutonomy}
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                    >
                      Resume Now
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handlePauseAutonomy(30)}
                      disabled={!isAutonomyActive}
                      style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Pause size={12} />
                      <span>Pause 30m</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Reaction Frequency */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Reaction Frequency &amp; Message Cooldown
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {(
                    [
                      { id: 'quiet', label: 'Quiet', sub: '180s cooldown' },
                      { id: 'balanced', label: 'Balanced', sub: '60s cooldown' },
                      { id: 'expressive', label: 'Expressive', sub: '30s cooldown' },
                    ] as const
                  ).map((item) => {
                    const isSelected = (petSettings.reactionFrequency || 'balanced') === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={loading || saving || !isAutonomyActive}
                        className={`expression-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => handleReactionFrequencyChange(item.id)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 4px' }}
                      >
                        <span style={{ fontWeight: 600, fontSize: '12px' }}>{item.label}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{item.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Browser Tab Context Awareness (Opt-in) */}
              <div
                style={{
                  padding: '12px',
                  background: 'var(--bg-card-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Globe size={16} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Browser Tab Context Awareness</span>
                  </div>
                  <button
                    type="button"
                    className={`btn ${petSettings.browserAwarenessEnabled ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={handleToggleBrowserAwareness}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    {petSettings.browserAwarenessEnabled ? 'Enabled (Opt-in)' : 'Disabled'}
                  </button>
                </div>

                <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                  Extracts ONLY the active tab hostname and sanitized window title via the Chrome Extension to react to coding, docs, or study.
                  Zero access to DOM, passwords, forms, or browsing history. Localhost and banking/auth domains are strictly excluded.
                </p>

                {/* Excluded Domains */}
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    Excluded Privacy Domains ({currentExcludedDomains.length}):
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {currentExcludedDomains.map((dom) => (
                      <span
                        key={dom}
                        style={{
                          fontSize: '10.5px',
                          padding: '2px 6px',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-pill)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {dom}
                        {!['localhost', '127.0.0.1'].includes(dom) && (
                          <button
                            type="button"
                            onClick={() => handleRemoveExcludedDomain(dom)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              color: 'var(--status-red)',
                              display: 'inline-flex',
                            }}
                            title={`Remove ${dom} exclusion`}
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>

                  <form onSubmit={handleAddExcludedDomain} style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add excluded domain (e.g. intranet.org)..."
                      value={customDomainInput}
                      onChange={(e) => setCustomDomainInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: '11.5px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!customDomainInput.trim()}
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Plus size={11} />
                      <span>Exclude</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          {/* Visor Display Aesthetics */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Eye className="card-icon" />
                <div>
                  <h3 className="card-title">Visor Display Aesthetics</h3>
                  <p className="card-subtitle">Custom eye geometry &amp; palette styles</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {saving && (
                  <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving...
                  </span>
                )}
                {saveSuccess && (
                  <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={11} /> Saved
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label
                  htmlFor="companionNameInput"
                  style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}
                >
                  Companion Name
                </label>
                <input
                  id="companionNameInput"
                  type="text"
                  value={displayedPetName}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleNameBlur}
                  placeholder="Companion Name..."
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Eye Shape Geometry
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['curved', 'round', 'pixel'] as const).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      disabled={loading || saving}
                      className={`expression-btn ${petSettings.eyeShape === shape ? 'active' : ''}`}
                      onClick={() => handleShapeChange(shape)}
                      style={{ textTransform: 'capitalize' }}
                      aria-pressed={petSettings.eyeShape === shape}
                    >
                      {shape === 'curved' ? 'Curved Visor' : shape === 'round' ? 'Circular Dome' : 'Retro Pixel'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Screen Glow Palette
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['cyan', 'emerald', 'amber', 'violet'] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      disabled={loading || saving}
                      className={`expression-btn ${petSettings.glowColor === color ? 'active' : ''}`}
                      onClick={() => handleColorChange(color)}
                      style={{ textTransform: 'capitalize' }}
                      aria-pressed={petSettings.glowColor === color}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Personality Tuning Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Sliders className="card-icon" />
                <div>
                  <h3 className="card-title">Companion Personality Tuning</h3>
                  <p className="card-subtitle">Behavior weighting &amp; attention parameters</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <label htmlFor="focusDisciplineSlider" style={{ fontWeight: 500 }}>Focus Discipline</label>
                  <span className="mono">{petSettings.focusDiscipline}%</span>
                </div>
                <input
                  id="focusDisciplineSlider"
                  type="range"
                  min="0"
                  max="100"
                  disabled={loading || saving}
                  value={petSettings.focusDiscipline}
                  onChange={(e) => handleFocusDisciplineChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                  aria-label="Focus discipline percentage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={petSettings.focusDiscipline}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Higher values reduce playful interruptions during active deep work blocks.
                </span>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <label htmlFor="playfulnessSlider" style={{ fontWeight: 500 }}>Playfulness &amp; Reactivity</label>
                  <span className="mono">{petSettings.playfulness}%</span>
                </div>
                <input
                  id="playfulnessSlider"
                  type="range"
                  min="0"
                  max="100"
                  disabled={loading || saving}
                  value={petSettings.playfulness}
                  onChange={(e) => handlePlayfulnessChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                  aria-label="Playfulness and reactivity percentage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={petSettings.playfulness}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Controls how eagerly Kuro celebrates task completions and offers wellness prompts.
                </span>
              </div>
            </div>
          </div>

          {/* Reset to Documented Defaults Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <RotateCcw className="card-icon" />
                <div>
                  <h3 className="card-title">Restore Documented Defaults</h3>
                  <p className="card-subtitle">Reset companion name, eye shape, glow color, and parameters</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Restores Kuro's default avatar settings (Curved Visor, Cyan Glow, 70% Playfulness, 85% Focus Discipline, Balanced Autonomy).
              </p>

              {!showResetConfirm ? (
                <div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowResetConfirm(true)}
                    disabled={loading || saving}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RotateCcw size={13} />
                    <span>Reset to Defaults</span>
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--status-red)' }}>
                    Are you sure you want to restore default companion settings?
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleResetToDefaults}
                      disabled={isResetting}
                      style={{ padding: '6px 14px', fontSize: '12px', backgroundColor: 'var(--status-red)', color: '#ffffff' }}
                    >
                      {isResetting ? 'Resetting...' : 'Yes, Confirm Reset'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowResetConfirm(false)}
                      disabled={isResetting}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
