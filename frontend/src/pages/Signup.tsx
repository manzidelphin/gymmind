import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { publicApi } from '../api/api';
import GymMindLogo from '../components/GymMindLogo';
import PhoneInput, { isPhoneValid } from '../components/PhoneInput';
import { useToast } from '../context/ToastContext';
import s from './Signup.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

// ── Component ─────────────────────────────────────────────────────────────────

export default function Signup() {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 1 — gym info
  const [gymName, setGymName]   = useState('');
  const [slug, setSlug]         = useState('');
  const [slugState, setSlugState] = useState<SlugState>('idle');
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2 — owner info
  const [ownerName, setOwnerName]   = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [email, setEmail]           = useState('');

  // Step 3 — OTP
  const [otp, setOtp]         = useState(['', '', '', '', '', '']);
  const [devCode, setDevCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Step 4 — result
  const [createdSlug, setCreatedSlug] = useState('');

  // ── Slug check ──────────────────────────────────────────────────────────────

  const checkSlug = useCallback((value: string) => {
    if (!value) { setSlugState('idle'); return; }
    if (!/^[a-z0-9-]{3,50}$/.test(value)) { setSlugState('invalid'); return; }
    setSlugState('checking');
    publicApi.get(`/signup/check-slug?slug=${encodeURIComponent(value)}`)
      .then(r => setSlugState(r.data.available ? 'available' : 'taken'))
      .catch(() => setSlugState('idle'));
  }, []);

  useEffect(() => {
    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
    slugDebounceRef.current = setTimeout(() => checkSlug(slug), 500);
    return () => { if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current); };
  }, [slug, checkSlug]);

  // Auto-generate slug when gym name changes (only if user hasn't manually edited)
  const [slugManual, setSlugManual] = useState(false);
  useEffect(() => {
    if (!slugManual) setSlug(slugify(gymName));
  }, [gymName, slugManual]);

  // ── Resend cooldown ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // ── OTP handlers ───────────────────────────────────────────────────────────

  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(''));
      otpRefs.current[5]?.focus();
      e.preventDefault();
    }
  }

  // ── Send OTP ────────────────────────────────────────────────────────────────

  async function sendOtp() {
    setLoading(true);
    setError('');
    try {
      const r = await publicApi.post('/signup/send-otp', { phone: ownerPhone });
      if (r.data.devCode) setDevCode(r.data.devCode);
      setResendCooldown(60);
      setStep(3);
      toast.info('Code sent', 'Check your phone for the code');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Failed to send OTP. Check the phone number.';
      setError(msg);
      toast.error('Signup failed', msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Create gym ──────────────────────────────────────────────────────────────

  async function createGym() {
    setLoading(true);
    setError('');
    try {
      const code = otp.join('');
      const r = await publicApi.post('/signup/create-gym', {
        gymName,
        slug,
        ownerName,
        ownerPhone,
        momoNumber: momoNumber || undefined,
        email: email.trim() || undefined,
        otp: code,
      });
      // Store credentials so GymContext initialises correctly on navigation
      localStorage.setItem('token',   r.data.token);
      localStorage.setItem('gymSlug', r.data.gym.slug);
      localStorage.setItem('user',    JSON.stringify(r.data.user));
      setCreatedSlug(r.data.gym.slug);
      setStep(4);
      toast.success('Gym created!', `${gymName} is now live on GymMind`);
    } catch (e: any) {
      const err = e.response?.data?.error;
      const msg = typeof err === 'string' ? err : 'Something went wrong. Please try again.';
      setError(msg);
      toast.error('Signup failed', msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Progress dots ───────────────────────────────────────────────────────────

  function dotClass(dotStep: number) {
    if (dotStep < step) return `${s.dot} ${s.dotDone}`;
    if (dotStep === step) return `${s.dot} ${s.dotActive}`;
    return s.dot;
  }

  // ── Step 1 validation ──────────────────────────────────────────────────────

  const step1Valid =
    gymName.trim().length >= 2 &&
    /^[a-z0-9-]{3,50}$/.test(slug) &&
    slugState !== 'invalid' &&
    slugState !== 'taken';

  // ── Step 2 validation ──────────────────────────────────────────────────────

  const step2Valid =
    ownerName.trim().length >= 1 &&
    isPhoneValid(ownerPhone);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={s.page}>
      <div className={s.card}>

        {/* Logo */}
        <div className={s.logoWrap}>
          <GymMindLogo size={52} variant="color" />
        </div>

        {/* Progress (steps 1–3 only) */}
        {step < 4 && (
          <div className={s.progress}>
            <div className={dotClass(1)} />
            <div className={dotClass(2)} />
            <div className={dotClass(3)} />
          </div>
        )}

        {/* ── STEP 1: Gym info ── */}
        {step === 1 && (
          <>
            <div className={s.stepHeading}>Set up your gym</div>
            <div className={s.stepSub}>Choose a name and a unique URL for your gym.</div>

            {error && <div className={s.error}>{error}</div>}

            <label className={s.label}>Gym name</label>
            <input
              className={s.input}
              type="text"
              placeholder="e.g. Kigali Fitness"
              value={gymName}
              onChange={e => setGymName(e.target.value)}
              autoFocus
            />

            <label className={s.label}>Gym URL / Slug</label>
            <div className={s.slugRow}>
              <input
                className={`${s.input} ${slugState === 'taken' || slugState === 'invalid' ? s.inputError : ''}`}
                type="text"
                placeholder="kigali-fitness"
                value={slug}
                onChange={e => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  setSlug(val);
                  setSlugManual(true);
                }}
              />
              {slugState === 'checking' && <span className={`${s.slugStatus} ${s.slugChecking}`}>Checking…</span>}
              {slugState === 'available' && <span className={`${s.slugStatus} ${s.slugAvailable}`}>✓ Available</span>}
              {slugState === 'taken' && <span className={`${s.slugStatus} ${s.slugTaken}`}>✗ Taken</span>}
              {slugState === 'invalid' && <span className={`${s.slugStatus} ${s.slugTaken}`}>✗ Invalid</span>}
            </div>
            <div className={s.slugHint}>
              Members will check in at: <code>gymmind.app/<strong>{slug || 'your-gym'}</strong>/checkin</code>
            </div>

            <button
              className={s.btnPrimary}
              disabled={!step1Valid}
              onClick={() => { setError(''); setStep(2); }}
            >
              Continue
            </button>
          </>
        )}

        {/* ── STEP 2: Owner info ── */}
        {step === 2 && (
          <>
            <div className={s.stepHeading}>Your account</div>
            <div className={s.stepSub}>You'll be the gym owner and can invite managers later.</div>

            {error && <div className={s.error}>{error}</div>}

            <label className={s.label}>Your name</label>
            <input
              className={s.input}
              type="text"
              placeholder="Jean-Paul Habimana"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              autoFocus
            />

            <label className={s.label}>Phone number (MTN / Airtel)</label>
            <PhoneInput
              value={ownerPhone}
              onChange={(v) => setOwnerPhone(v)}
              inputClassName={s.input}
            />

            <label className={s.label}>MoMo payment number <span style={{ color: '#94a3b8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — can be set later)</span></label>
            <PhoneInput
              value={momoNumber}
              onChange={(v) => setMomoNumber(v)}
              inputClassName={s.input}
            />

            <label className={s.label}>Email address <span style={{ color: '#94a3b8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — for monthly reports)</span></label>
            <input
              className={s.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />

            <button
              className={s.btnPrimary}
              disabled={!step2Valid || loading}
              onClick={sendOtp}
            >
              {loading ? 'Sending…' : 'Send verification code'}
            </button>
            <button className={s.btnBack} onClick={() => { setError(''); setStep(1); }}>
              Back
            </button>
          </>
        )}

        {/* ── STEP 3: OTP ── */}
        {step === 3 && (
          <>
            <div className={s.stepHeading}>Verify your phone</div>
            <div className={s.stepSub}>
              Enter the 6-digit code sent to <strong>{ownerPhone}</strong>.
            </div>

            {devCode && (
              <div className={s.devBadge}>Dev code: {devCode}</div>
            )}

            {error && <div className={s.error}>{error}</div>}

            <div className={s.otpGrid} onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  className={`${s.otpCell} ${digit ? s.otpCellFilled : ''}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            <div className={s.resendRow}>
              Didn't get it?{' '}
              <button
                className={s.resendBtn}
                disabled={resendCooldown > 0 || loading}
                onClick={async () => {
                  setLoading(true);
                  setError('');
                  try {
                    const r = await publicApi.post('/signup/send-otp', { phone: ownerPhone });
                    if (r.data.devCode) setDevCode(r.data.devCode);
                    setOtp(['', '', '', '', '', '']);
                    setResendCooldown(60);
                  } catch (e: any) {
                    setError(e.response?.data?.error || 'Failed to resend.');
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>

            <button
              className={s.btnPrimary}
              disabled={otp.join('').length < 6 || loading}
              onClick={createGym}
            >
              {loading ? 'Creating your gym…' : 'Verify & Create Gym'}
            </button>
            <button className={s.btnBack} onClick={() => { setError(''); setStep(2); }}>
              Back
            </button>
          </>
        )}

        {/* ── STEP 4: Success ── */}
        {step === 4 && (
          <div className={s.successCard}>
            <div className={s.successIcon}>🎉</div>
            <div className={s.successTitle}>Your gym is live!</div>
            <div className={s.successSub}>
              <strong>{gymName}</strong> is ready. Members can start checking in right away.
            </div>
            <div className={s.gymSlugPill}>gymmind.app/{createdSlug}/checkin</div>
            <button
              className={s.btnPrimary}
              onClick={() => navigate(`/${createdSlug}/manager`)}
            >
              Go to Manager Dashboard →
            </button>
          </div>
        )}

        {/* Footer link (steps 1–3) */}
        {step < 4 && (
          <div className={s.footerLink}>
            Already have an account?{' '}
            <Link to="/login">Sign in</Link>
          </div>
        )}

      </div>
    </div>
  );
}
