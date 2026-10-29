import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Layers,
  Save,
  RotateCcw,
  Cloud,
  Server,
  Lock,
} from 'lucide-react';
import {
  type CloudServiceType,
  CLOUD_MODELS,
  getStoredCloudConfig,
  saveStoredCloudConfig,
  clearStoredCloudConfig,
  fetchCloudBackendStatus,
  type CloudBackendStatus,
} from '../../lib/ai/cloudProvider';
import type { AIConnectionState } from '../../lib/ai/types';

interface CloudAISetupPanelProps {
  connectionState: AIConnectionState;
  connectionError?: string | null;
  onRefresh: () => void;
  onSwitchToOllama: () => void;
}

export const CloudAISetupPanel: React.FC<CloudAISetupPanelProps> = ({
  connectionState,
  connectionError,
  onRefresh,
  onSwitchToOllama,
}) => {
  const [config, setConfig] = useState(() => getStoredCloudConfig());
  const [consentChecked, setConsentChecked] = useState(config.userConsent);
  const [selectedService, setSelectedService] = useState<CloudServiceType>(config.serviceType);
  const [selectedModel, setSelectedModel] = useState<string>(config.selectedModel);
  const [backendStatus, setBackendStatus] = useState<CloudBackendStatus>({
    configured: false,
    providers: { gemini: false, openai: false },
  });
  const [isCheckingBackend, setIsCheckingBackend] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCloudBackendStatus()
      .then((status) => {
        if (!cancelled) setBackendStatus(status);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingBackend(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBackend = useCallback(async () => {
    setIsCheckingBackend(true);
    try {
      const status = await fetchCloudBackendStatus();
      setBackendStatus(status);
    } finally {
      setIsCheckingBackend(false);
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveStoredCloudConfig({
      serviceType: selectedService,
      userConsent: consentChecked,
      selectedModel,
    });
    setConfig(getStoredCloudConfig());
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
    onRefresh();
  };

  const handleRevokeConsent = () => {
    clearStoredCloudConfig();
    setConsentChecked(false);
    setConfig(getStoredCloudConfig());
    onRefresh();
  };

  const isConfiguredAndConsented = Boolean(config.userConsent && backendStatus.configured);

  return (
    <div
      style={{
        padding: '16px 20px',
        backgroundColor: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Header and status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Cloud size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
              Optional Cloud AI Gateway (Server-Side Proxy)
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              Hosted models (Google Gemini / OpenAI). Zero API keys stored in browser for security.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isConfiguredAndConsented && connectionState === 'connected' ? (
            <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={11} /> Cloud AI Active ({selectedModel})
            </span>
          ) : (
            <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={11} />
              {!consentChecked ? 'Consent Required' : 'Backend Setup Required'}
            </span>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSwitchToOllama}
            style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Switch back to Local Ollama"
          >
            <Layers size={12} />
            <span>Switch to Local Ollama</span>
          </button>
        </div>
      </div>

      {/* Backend Status Card */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: backendStatus.configured
            ? 'rgba(16, 185, 129, 0.08)'
            : 'rgba(239, 68, 68, 0.08)',
          border: `1px solid ${
            backendStatus.configured ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
          }`,
          fontSize: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              color: backendStatus.configured ? 'var(--status-green)' : 'var(--status-red)',
            }}
          >
            <Server size={14} />
            <span>
              {isCheckingBackend
                ? 'Checking Server Backend...'
                : backendStatus.configured
                ? 'Server Backend Configured'
                : 'Backend Setup Required'}
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void refreshBackend();
              onRefresh();
            }}
            style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <RotateCcw size={10} />
            <span>Check Backend</span>
          </button>
        </div>

        {backendStatus.configured ? (
          <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            Server proxy is active with credentials detected:
            {backendStatus.providers.gemini ? ' Google Gemini (Active)' : ''}
            {backendStatus.providers.openai ? ' OpenAI (Active)' : ''}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            <p style={{ margin: 0 }}>
              Neither <code>GEMINI_API_KEY</code> nor <code>OPENAI_API_KEY</code> is set in the server environment.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--status-amber)' }}>
              <Lock size={12} />
              <span>For security, Kuro does not accept or store API keys in browser storage.</span>
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
              To enable Cloud AI, set <code>GEMINI_API_KEY=...</code> or <code>OPENAI_API_KEY=...</code> in your server environment variables (or <code>.env.local</code> on the host server) and restart Kuro.
            </p>
          </div>
        )}
      </div>

      {/* Privacy Disclosure Notice */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          fontSize: '12px',
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--status-amber)' }}>
          <ShieldAlert size={15} />
          <span>Privacy &amp; Data Transmission Notice</span>
        </div>
        <p style={{ margin: 0, lineHeight: 1.4, color: 'var(--text-secondary)', fontSize: '11.5px' }}>
          Kuro is strictly local-first by default. When Cloud AI is explicitly enabled and selected, chat queries and bounded
          conversation context are routed through your Kuro server proxy to external AI endpoints (Google Gemini or OpenAI).
          Personal tasks, memories, or browsing data are never transmitted automatically.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', paddingTop: '4px' }}>
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: '11.5px', fontWeight: 500 }}>
            I understand and consent to transmitting chat queries to external cloud AI APIs via the server proxy.
          </span>
        </label>
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {/* Provider / Service Type */}
          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
              Cloud Provider Service
            </label>
            <select
              value={selectedService}
              onChange={(e) => {
                const s = e.target.value as CloudServiceType;
                setSelectedService(s);
                setSelectedModel(s === 'gemini' ? 'gemini-3.8-flash' : 'gpt-4o-mini');
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
              }}
            >
              <option value="gemini">Google Gemini (Recommended)</option>
              <option value="openai">OpenAI API</option>
            </select>
          </div>

          {/* Model Selection */}
          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
              Model Tier
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
              }}
            >
              {CLOUD_MODELS.filter((m) =>
                selectedService === 'gemini' ? m.id.startsWith('gemini') : m.id.startsWith('gpt')
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!consentChecked}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Save size={13} />
              <span>{saveSuccess ? 'Settings Saved' : 'Save Cloud Settings'}</span>
            </button>

            {config.userConsent && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRevokeConsent}
                style={{
                  padding: '7px 12px',
                  fontSize: '12px',
                  color: 'var(--status-red)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title="Revoke consent and disable Cloud AI"
              >
                <span>Revoke Consent</span>
              </button>
            )}
          </div>
        </div>

        {connectionError && (
          <div style={{ fontSize: '11.5px', color: 'var(--status-red)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={13} />
            <span>{connectionError}</span>
          </div>
        )}
      </form>
    </div>
  );
};
