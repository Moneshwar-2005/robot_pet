import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu,
  RefreshCw,
  Link2,
  Unlink,
  Send,
  CheckCircle2,
  AlertCircle,
  Radio,
  Sliders,
} from 'lucide-react';
import {
  fetchDeviceStatus,
  requestPairingPin,
  confirmDevicePairing,
  unpairDevice,
  sendDeviceCommand,
  type DeviceStatusResponse,
  type DeviceCommandResponse,
} from '../../lib/device/deviceService';
import type { PetMood } from '../../types';

interface HardwareDeviceCardProps {
  currentMood: PetMood;
  activePalette?: string;
  activeEyeShape?: string;
}

export const HardwareDeviceCard: React.FC<HardwareDeviceCardProps> = ({
  currentMood,
  activePalette = 'cyan',
  activeEyeShape = 'curved',
}) => {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Pairing State
  const [isPairingMode, setIsPairingMode] = useState<boolean>(false);
  const [pairingPin, setPairingPin] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [deviceIpInput, setDeviceIpInput] = useState<string>('192.168.1.155');
  const [useSimulation, setUseSimulation] = useState<boolean>(true);
  const [pinExpirySec, setPinExpirySec] = useState<number>(0);

  // Speech transmission state
  const [customSpeechText, setCustomSpeechText] = useState<string>('');
  const [lastAckInfo, setLastAckInfo] = useState<string | null>(null);
  const [pingLatencyMs, setPingLatencyMs] = useState<number | null>(null);

  const loadStatus = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      setErrorMsg(null);
      const status = await fetchDeviceStatus();
      setDeviceStatus(status);
    } catch {
      // Offline or network error
      setDeviceStatus(null);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchDeviceStatus()
      .then((status) => {
        if (isMounted) setDeviceStatus(status);
      })
      .catch(() => {
        if (isMounted) setDeviceStatus(null);
      });

    // Poll status every 10 seconds
    const interval = setInterval(() => {
      void loadStatus(false);
    }, 10_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [loadStatus]);

  // Countdown timer for pairing PIN
  useEffect(() => {
    if (pinExpirySec <= 0) return;
    const timer = setInterval(() => {
      setPinExpirySec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [pinExpirySec]);

  const handleStartPairing = async () => {
    try {
      setActionLoading(true);
      setErrorMsg(null);
      const challenge = await requestPairingPin();
      setPairingPin(challenge.pin);
      setPinInput(challenge.pin); // Pre-fill for convenience
      setPinExpirySec(challenge.expiresInSec || 300);
      setIsPairingMode(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to request pairing PIN.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmPairing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) {
      setErrorMsg('Please enter a 6-digit pairing PIN.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMsg(null);
      const res = await confirmDevicePairing(pinInput.trim(), {
        deviceId: useSimulation ? 'kuro-sim-01' : 'kuro-esp32s3-robot',
        deviceName: useSimulation ? 'Kuro Virtual Robot' : 'Office Physical Visor',
        deviceIp: useSimulation ? '127.0.0.1' : deviceIpInput.trim(),
        isSimulated: useSimulation,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Pairing failed. Check PIN and try again.');
        return;
      }

      setSuccessMsg(
        useSimulation
          ? 'Paired with Virtual Robot Adapter (Simulation mode).'
          : 'Successfully paired with physical ESP32-S3 robot companion!'
      );
      setIsPairingMode(false);
      void loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error confirming pairing.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnpair = async () => {
    if (!confirm('Are you sure you want to unpair this robot companion?')) return;
    try {
      setActionLoading(true);
      setErrorMsg(null);
      await unpairDevice();
      setSuccessMsg('Robot companion unpaired successfully.');
      void loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to unpair.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendCommand = async (
    cmdPayload: Parameters<typeof sendDeviceCommand>[0],
    actionLabel: string
  ) => {
    try {
      setActionLoading(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const startTime = performance.now();
      const res: DeviceCommandResponse = await sendDeviceCommand(cmdPayload);
      const elapsed = Math.round(performance.now() - startTime);

      if (!res.success) {
        setErrorMsg(res.error || `Failed to execute ${actionLabel}.`);
        return;
      }

      if (cmdPayload.cmd === 'ping') {
        setPingLatencyMs(elapsed);
        setSuccessMsg(
          res.isSimulated
            ? `Virtual robot pong received (simulated loopback, ${elapsed}ms).`
            : `Physical robot pong received (${elapsed}ms).`
        );
      } else {
        setSuccessMsg(
          res.isSimulated
            ? `${actionLabel} processed by virtual adapter (simulation).`
            : res.deliveredDirectly
              ? `${actionLabel} delivered directly to physical robot!`
              : `${actionLabel} queued for physical robot (awaiting next poll).`
        );
      }

      if (res.reqId) {
        setLastAckInfo(
          `Ack: ${res.reqId} (${res.deliveredDirectly ? 'Direct LAN Push' : res.isSimulated ? 'Simulated Loopback' : 'Queued for Poll'})`
        );
      }

      void loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Error sending ${actionLabel}.`);
    } finally {
      setActionLoading(false);
    }
  };

  const isPaired = Boolean(deviceStatus?.paired);
  const isOnline = Boolean(deviceStatus?.connected);
  const isSimulated = Boolean(deviceStatus?.isSimulated || deviceStatus?.device?.isSimulated);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <Cpu className="card-icon" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h3 className="card-title">Physical Robot Companion (ESP32-S3)</h3>
            <p className="card-subtitle">
              Protocol v1.0 Hardware Visor Gateway &amp; Pairing Hub
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isPaired ? (
            <span
              className={`badge ${
                isOnline
                  ? isSimulated
                    ? 'badge-planned'
                    : 'badge-active'
                  : deviceStatus?.connectionState === 'awaiting_device'
                    ? 'badge-warning'
                    : 'badge-destructive'
              }`}
            >
              {isOnline
                ? isSimulated
                  ? '🔵 Simulated Robot'
                  : '🟢 Visor Online'
                : deviceStatus?.connectionState === 'awaiting_device'
                  ? '⏳ Awaiting Robot Connection'
                  : '🔴 Offline'}
            </span>
          ) : (
            <span className="badge badge-secondary">⚪ Unpaired</span>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void loadStatus()}
            disabled={loading || actionLoading}
            style={{ padding: '6px 10px', fontSize: '12px' }}
            title="Refresh Robot Status"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} style={{ width: '13px', height: '13px' }} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
        {/* Feedback alerts */}
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--status-danger)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--status-danger)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid var(--status-success)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--status-success)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircle2 style={{ width: '16px', height: '16px', flexShrink: 0 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span>{successMsg}</span>
              {lastAckInfo && <span className="mono" style={{ fontSize: '11px', opacity: 0.8 }}>{lastAckInfo}</span>}
            </div>
          </div>
        )}

        {/* Pairing Flow Mode */}
        {isPairingMode ? (
          <form
            onSubmit={handleConfirmPairing}
            style={{
              padding: '16px',
              background: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>Pairing Authorization</span>
              <span className="mono" style={{ color: pinExpirySec < 60 ? 'var(--status-danger)' : 'var(--text-secondary)' }}>
                PIN expires in: {Math.floor(pinExpirySec / 60)}:{(pinExpirySec % 60).toString().padStart(2, '0')}
              </span>
            </div>

            <div
              style={{
                textAlign: 'center',
                padding: '12px',
                background: 'var(--bg-base)',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--accent-primary)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                One-Time Pairing PIN
              </div>
              <div className="mono" style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '6px', color: 'var(--accent-primary)' }}>
                {pairingPin || '------'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Type this PIN on your robot terminal or confirm it below.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500 }}>Confirm PIN</label>
              <input
                type="text"
                className="input mono"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="6-digit PIN"
                style={{ textAlign: 'center', fontSize: '16px', letterSpacing: '3px' }}
                required
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500 }}>Robot Host IP / Network Address</label>
              <input
                type="text"
                className="input mono"
                value={deviceIpInput}
                onChange={(e) => setDeviceIpInput(e.target.value)}
                placeholder="192.168.1.155 or kuro-robot.local"
                disabled={useSimulation}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="simCheckbox"
                checked={useSimulation}
                onChange={(e) => setUseSimulation(e.target.checked)}
              />
              <label htmlFor="simCheckbox" style={{ fontSize: '12px', cursor: 'pointer' }}>
                Use Virtual Robot Adapter (Simulated mode for testing without physical board)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={actionLoading || !pinInput.trim()}
                style={{ flex: 1 }}
              >
                <Link2 style={{ width: '14px', height: '14px' }} />
                Confirm &amp; Bind Robot
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsPairingMode(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : isPaired ? (
          /* Active Paired Device View */
          <>
            {/* Telemetry Metrics Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
              }}
            >
              <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Target Visor</span>
                <span className="mono" style={{ fontWeight: 600 }}>2.4" TFT (320x240)</span>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Firmware &amp; Proto</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  v{deviceStatus?.device?.telemetry?.version || '0.1.0'} (P{deviceStatus?.proto || '1.0'})
                </span>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Connection / IP</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {deviceStatus?.device?.deviceIp || '127.0.0.1'}
                </span>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Last Heartbeat</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {deviceStatus && deviceStatus.lastHeartbeatSecAgo !== null ? `${deviceStatus.lastHeartbeatSecAgo}s ago` : 'None'}
                </span>
              </div>
            </div>

            {/* Quick Interactive Command Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Hardware Expression Sync
              </span>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    handleSendCommand(
                      { cmd: 'set_mood', mood: currentMood, palette: activePalette },
                      `Sync Mood '${currentMood}'`
                    )
                  }
                  disabled={actionLoading}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  <Send style={{ width: '13px', height: '13px' }} />
                  Push Active Mood ({currentMood})
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    handleSendCommand(
                      { cmd: 'set_palette', palette: activePalette },
                      `Set Palette (${activePalette})`
                    )
                  }
                  disabled={actionLoading}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  <Sliders style={{ width: '13px', height: '13px' }} />
                  Push Palette ({activePalette})
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    handleSendCommand(
                      { cmd: 'set_eye_shape', shape: activeEyeShape },
                      `Set Eye Shape (${activeEyeShape})`
                    )
                  }
                  disabled={actionLoading}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Push Eyes ({activeEyeShape})
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleSendCommand({ cmd: 'ping', ts: Date.now() }, 'Ping')}
                  disabled={actionLoading}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  <Radio style={{ width: '13px', height: '13px' }} />
                  Ping Robot {pingLatencyMs ? `(${pingLatencyMs}ms)` : ''}
                </button>
              </div>
            </div>

            {/* Speech Ribbon Transmission */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Transmit Subtitle Speech to Visor Screen
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Focus sprint starting! Stay hydrated."
                  value={customSpeechText}
                  onChange={(e) => setCustomSpeechText(e.target.value)}
                  maxLength={120}
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!customSpeechText.trim()) return;
                    void handleSendCommand(
                      { cmd: 'speak', speech: customSpeechText.trim() },
                      'Subtitle Speech'
                    );
                    setCustomSpeechText('');
                  }}
                  disabled={actionLoading || !customSpeechText.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <Send style={{ width: '13px', height: '13px' }} />
                  Speak on Visor
                </button>
              </div>
            </div>

            {/* Unpair and Mode Info */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-color)',
                marginTop: '4px',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {isSimulated ? (
                  <span>Using Virtual Robot Loopback Adapter (Simulated mode).</span>
                ) : (
                  <span>Connected via Local Subnet Direct Gateway Transport.</span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-destructive"
                onClick={handleUnpair}
                disabled={actionLoading}
                style={{ padding: '4px 10px', fontSize: '11px' }}
              >
                <Unlink style={{ width: '12px', height: '12px' }} />
                Unpair Robot
              </button>
            </div>
          </>
        ) : (
          /* Unpaired State View */
          <div
            style={{
              padding: '16px',
              background: 'var(--bg-card-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '12px',
            }}
          >
            <Cpu style={{ width: '32px', height: '32px', color: 'var(--text-muted)' }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>No Physical Robot Paired</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '360px' }}>
                Pair Kuro with your ESP32-S3 hardware companion or launch the virtual robot simulator to mirror pet expressions, speech ribbons, and moods on your desk.
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartPairing}
              disabled={actionLoading}
              style={{ padding: '8px 16px', fontSize: '13px' }}
            >
              <Link2 style={{ width: '15px', height: '15px' }} />
              Pair Robot Companion
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
