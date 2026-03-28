import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/api';
import { useGym } from '../hooks/useGym';
import s from './MemberPortal.module.css';

interface Membership {
  id: number; plan_id: number; plan_name: string; type: string;
  start_date: string; end_date: string | null; remaining_sessions: number | null;
  status: string;
}
interface Checkin { checked_in_at: string; checkin_type: string; }

// ── Login Gate ─────────────────────────────────────────────────
function LoginGate({ onAuth }: { onAuth: (user: any, token: string) => void }) {
  const { gymSlug } = useGym();
  const [step,    setStep]    = useState<'phone' | 'otp'>('phone');
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState(['', '', '', '', '', '']);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  async function sendOtp() {
    if (!phone.trim()) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone: phone.trim() });
      setDevCode(data.devCode ?? null);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) { setError(e.response?.data?.error ?? 'Failed to send OTP.'); }
    finally { setLoading(false); }
  }

  async function verifyOtp(code: string) {
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/verify-otp', { phone: phone.trim(), code });
      if (data.newUser) {
        setError('No account found. Please register first.');
        setOtp(['','','','','','']);
        return;
      }
      onAuth(data.user, data.token);
    } catch (e: any) { setError(e.response?.data?.error ?? 'Invalid code.'); setOtp(['','','','','','']); }
    finally { setLoading(false); }
  }

  function handleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const n = [...otp];
      if (n[idx]) { n[idx] = ''; setOtp(n); }
      else if (idx > 0) { n[idx - 1] = ''; setOtp(n); otpRefs.current[idx - 1]?.focus(); }
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    const n = [...otp]; n[idx] = e.key; setOtp(n);
    if (idx < 5) otpRefs.current[idx + 1]?.focus();
    else verifyOtp(n.join(''));
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (d.length !== 6) return;
    setOtp(d.split('')); otpRefs.current[5]?.focus(); verifyOtp(d);
  }

  return (
    <div className={s.loginPage}>
      <div className={s.loginCard}>
        <p className={s.loginTitle}>Member Portal</p>
        <p className={s.loginSub}>GymMind · {gymSlug}</p>

        {step === 'phone' && <>
          <label htmlFor="member-phone" className={s.label}>Your phone number</label>
          <input
            id="member-phone"
            ref={phoneRef}
            type="tel"
            placeholder="07XX XXX XXX"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendOtp()}
            className={s.input}
          />
          {error && <p className={s.error}>{error}</p>}
          <button
            type="button"
            className={`${s.btn} ${(!phone.trim() || loading) ? s.btnDisabled : ''}`}
            onClick={sendOtp}
            disabled={!phone.trim() || loading}
          >
            {loading ? 'Sending…' : 'Send Code →'}
          </button>
          <p className={s.registerHint}>
            Not registered? <a href={`/${gymSlug}/claim`} className={s.registerLink}>Create account</a>
          </p>
        </>}

        {step === 'otp' && <>
          <label className={s.label}>Code sent to {phone}</label>
          <div className={s.otpGrid} onPaste={handleOtpPaste}>
            {otp.map((d, i) => (
              <input
                key={i}
                ref={el => { otpRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                aria-label={`OTP digit ${i + 1}`}
                onChange={() => {}}
                onKeyDown={e => handleOtpKey(i, e)}
                className={`${s.otpCell} ${d ? s.otpCellFilled : ''}`}
              />
            ))}
          </div>
          {devCode && <p className={s.devBadge}>DEV code: {devCode}</p>}
          {error && <p className={s.error}>{error}</p>}
          <button
            type="button"
            className={`${s.btn} ${(!otp.every(d => d) || loading) ? s.btnDisabled : ''}`}
            onClick={() => verifyOtp(otp.join(''))}
            disabled={!otp.every(d => d) || loading}
          >
            {loading ? 'Logging in…' : 'Login →'}
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost}`}
            onClick={() => { setStep('phone'); setOtp(['','','','','','']); setError(''); }}
          >
            ← Change number
          </button>
        </>}
      </div>
    </div>
  );
}

// ── Portal ─────────────────────────────────────────────────────
export default function MemberPortal() {
  const { gymSlug, user, setAuth, clearAuth } = useGym();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get('userId');

  const [viewedUser, setViewedUser] = useState<any>(null);
  const [membership, setMembership] = useState<Membership | null | 'loading'>('loading');
  const [checkins,   setCheckins]   = useState<Checkin[]>([]);

  // Fetch member detail once logged in
  useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        const url = targetUserId ? `/users/${targetUserId}` : '/me';
        const { data } = await api.get(url);
        if (targetUserId) setViewedUser(data.user);
        setMembership(data.membership ?? null);
        setCheckins(data.recentCheckins ?? []);
      } catch { setMembership(null); }
    }
    load();
  }, [user, targetUserId]);

  if (!user) return <LoginGate onAuth={(u, t) => setAuth(u, t)} />;

  // ── Progress bar calculation ───────────────────────────────────
  function getProgress(): { pct: number; label: string; low: boolean } | null {
    if (!membership || membership === 'loading') return null;
    if (membership.type === 'time_based' && membership.end_date) {
      const start = new Date(membership.start_date).getTime();
      const end   = new Date(membership.end_date).getTime();
      const now   = Date.now();
      const total = end - start;
      const used  = now - start;
      const pct   = Math.max(0, Math.min(100, Math.round((1 - used / total) * 100)));
      const daysLeft = Math.ceil((end - now) / 86400000);
      return { pct, label: `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`, low: pct < 20 };
    }
    if (membership.type === 'session_based') {
      // We don't know original sessions easily, show remaining count
      const rem = membership.remaining_sessions ?? 0;
      return { pct: Math.min(100, rem * 10), label: `${rem} session${rem !== 1 ? 's' : ''} remaining`, low: rem <= 2 };
    }
    return null;
  }

  const progress = getProgress();

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function typeClass(type: string) {
    if (type === 'institutional') return s.typeInstitutional;
    if (type === 'dependent')     return s.typeDependent;
    return s.typeIndividual;
  }

  const displayUser = viewedUser ?? user;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <span className={s.logoText}>GymMind · {gymSlug}</span>
        {targetUserId
          ? <button type="button" className={s.logoutBtn} onClick={() => window.history.back()}>← Back</button>
          : <button type="button" className={s.logoutBtn} onClick={clearAuth}>Logout</button>
        }
      </header>

      <main className={s.body}>

        {/* Profile */}
        <div className={s.profileCard}>
          <div className={s.avatar}>{displayUser.name.charAt(0).toUpperCase()}</div>
          <div>
            <p className={s.profileName}>{displayUser.name}</p>
            <p className={s.profilePhone}>{displayUser.phone}</p>
            <span className={s.profileRole}>{displayUser.role.replace('_', ' ')}</span>
          </div>
        </div>

        {/* Membership */}
        <div className={s.membershipCard}>
          <div className={s.cardHeader}>
            <p className={s.cardTitle}>Membership</p>
            {membership && membership !== 'loading' && (
              <span className={membership.status === 'active' ? s.statusBadgeActive : s.statusBadgeExpired}>
                {membership.status}
              </span>
            )}
          </div>

          {membership === 'loading' && <p className={s.membershipLoading}>Loading…</p>}

          {membership === null && (
            <>
              <p className={s.noMembership}>No active membership</p>
              <button type="button" className={s.renewBtn} onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                Contact Reception to Enroll
              </button>
            </>
          )}

          {membership && membership !== 'loading' && (
            <>
              <p className={s.planName}>{membership.plan_name}</p>
              <span className={s.planType}>{membership.type.replace('_', ' ')}</span>

              {progress && (
                <div className={s.progressWrap}>
                  <div className={s.progressLabel}>
                    <span>{progress.label}</span>
                    <span>{progress.pct}%</span>
                  </div>
                  <div className={s.progressTrack}>
                    <div
                      className={`${s.progressFill} ${progress.low ? s.progressFillLow : ''}`}
                      style={{ '--progress': `${progress.pct}%` } as React.CSSProperties}
                    />
                  </div>
                </div>
              )}

              {membership.end_date && (
                <p className={s.expiresText}>
                  Expires: {new Date(membership.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}

              <button type="button" className={s.renewBtn}>
                Renew Membership
              </button>
            </>
          )}
        </div>

        {/* Check-in history */}
        <div className={s.historyCard}>
          <p className={s.historyTitle}>Recent Check-ins</p>
          {checkins.length === 0
            ? <p className={s.historyEmpty}>No check-ins recorded yet.</p>
            : checkins.map((c, i) => (
              <div key={i} className={s.historyItem}>
                <span className={s.historyDate}>{formatDate(c.checked_in_at)}</span>
                <span className={`${s.historyType} ${typeClass(c.checkin_type)}`}>
                  {c.checkin_type}
                </span>
              </div>
            ))
          }
        </div>

      </main>
    </div>
  );
}
