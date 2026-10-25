import React, { useState, useEffect, useCallback } from 'react';
import { X, LogIn, UserPlus, Mail, Lock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/useAuth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
}) => {
  const { signIn, signUp, isConfigured } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    onClose();
  }, [isSubmitting, onClose]);

  // Handle ESC key to dismiss modal safely
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, handleClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (!isConfigured) {
      setErrorMsg('Supabase is not configured. Local mock mode is active.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        const { error } = await signIn(trimmedEmail, password);
        if (error) {
          setErrorMsg(error.message || 'Failed to sign in. Please verify your credentials.');
        } else {
          handleClose();
        }
      } else {
        const { error, emailConfirmationRequired } = await signUp(trimmedEmail, password);
        if (error) {
          setErrorMsg(error.message || 'Failed to create account. Please try again.');
        } else if (emailConfirmationRequired) {
          setSuccessMsg(
            'Account created! Please check your email inbox to confirm your address before signing in.'
          );
        } else {
          handleClose();
        }
      }
    } catch {
      setErrorMsg('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (newMode: 'login' | 'signup') => {
    setMode(newMode);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div
      className="mobile-overlay mobile-open"
      style={{
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backdropFilter: 'blur(6px)',
        backgroundColor: 'rgba(5, 8, 14, 0.75)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          handleClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '24px',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border-strong)',
          backgroundColor: 'var(--bg-card)',
          position: 'relative',
        }}
      >
        {/* Header with Title & Close button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="brand-icon-wrap" style={{ width: '32px', height: '32px' }}>
              {mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
            </div>
            <h2
              id="auth-modal-title"
              style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              {mode === 'login' ? 'Sign In to Kuro' : 'Create Kuro Account'}
            </h2>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            style={{ padding: '6px', borderRadius: 'var(--radius-sm)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-input)',
            padding: '3px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '16px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            className={`expression-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
            disabled={isSubmitting}
            style={{ flex: 1, padding: '7px 0', fontSize: '13px' }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`expression-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => switchMode('signup')}
            disabled={isSubmitting}
            style={{ flex: 1, padding: '7px 0', fontSize: '13px' }}
          >
            Sign Up
          </button>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 12px',
              backgroundColor: 'var(--status-red-bg)',
              border: '1px solid var(--status-red)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '14px',
              fontSize: '12.5px',
              color: 'var(--text-primary)',
            }}
            role="alert"
          >
            <AlertCircle size={16} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Notification */}
        {successMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 12px',
              backgroundColor: 'var(--status-green-bg)',
              border: '1px solid var(--status-green)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '14px',
              fontSize: '12.5px',
              color: 'var(--text-primary)',
            }}
            role="status"
          >
            <CheckCircle2 size={16} style={{ color: 'var(--status-green)', flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Auth Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div>
            <label
              htmlFor="auth-email-input"
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: '5px',
              }}
            >
              Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
                size={15}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '12px',
                  color: 'var(--text-muted)',
                }}
                aria-hidden="true"
              />
              <input
                id="auth-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 34px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-password-input"
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: '5px',
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={15}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '12px',
                  color: 'var(--text-muted)',
                }}
                aria-hidden="true"
              />
              <input
                id="auth-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 34px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                }}
              />
            </div>
            {mode === 'signup' && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                Must be at least 6 characters
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '10px',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span>{mode === 'login' ? 'Signing in...' : 'Creating account...'}</span>
              </>
            ) : (
              <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
            )}
          </button>
        </form>

        <div
          style={{
            marginTop: '16px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-muted)',
          }}
        >
          {mode === 'login' ? (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                disabled={isSubmitting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Sign up
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                disabled={isSubmitting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Sign in
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
