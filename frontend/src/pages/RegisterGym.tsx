import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/api';
import s from './RegisterGym.module.css';

type Step = 'form' | 'otp' | 'success';

function slugify(text: string) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export default function RegisterGym() {
  const navigate = useNavigate();

  const [step,      setStep]      = useState<Step>('form');
  const [gymName,   setGymName]   = useState('');
  const [slug,      setSlug]      = useState('');
  const [address,   setAddress]   = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone,     setPhone]     = useState('');
  const [otp,       setOtp]       = useState(['','','','','','']);
  const [devCode,   setDevCode]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [gymSlug,   setGymSlug]   = useState('');

  const otpRefs = useRef<(HTMLInputElement | null)[]>([null,null,null,null,null,null]);

  function handleGymNameChange(val: string) {
    setGymName(val);
    setSlug(slugify(val));
  }

  async function sendOtp() {
    if (!gymName.trim() || !slug.trim() || !ownerName.trim() || !phone.trim()) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/register/send-otp', {
        gymName: gymName.trim(),
        slug: slug.trim(),
        address: address.trim() || undefined,
        ownerName: ownerName.trim(),
        phone: phone.trim(),
      }, { headers: { 'X-Gym-Slug': 'none' } });
      setDevCode(data.devCode ?? null);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to send code.');
    } finally { setLoading(false); }
  }

  async function verifyOtp(code: string) {
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/register', {
        gymName: gymName.trim(),
        slug: slug.trim(),
        address: address.trim() || undefined,
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        code,
      }, { headers: { 'X-Gym-Slug': 'none' } });

      // Store auth for direct redirect into manager dashboard
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('gymSlug', data.gymSlug);
      setGymSlug(data.gymSlug);
      setStep('success');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid code.');
      setOtp(['','','','','','']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally { setLoading(false); }
  }

  function handleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const n = [...otp];
      if (n[idx]) { n[idx] = ''; setOtp(n); }
      else if (idx > 0) { n[idx-1] = ''; setOtp(n); otpRefs.current[idx-1]?.focus(); }
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    const n = [...otp]; n[idx] = e.key; setOtp(n);
    if (idx < 5) otpRefs.current[idx+1]?.focus();
    else verifyOtp(n.join(''));
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const d = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
    if (d.length !== 6) return;
    setOtp(d.split('')); otpRefs.current[5]?.focus(); verifyOtp(d);
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>GymMind</div>

        {/* ── Step 1: Form ── */}
        {step === 'form' && (
          <>
            <h1 className={s.title}>Create your gym</h1>
            <p className={s.sub}>Free 30-day trial. No credit card required.</p>

            <label className={s.label}>Gym name</label>
            <input className={s.input} type="text" placeholder="e.g. Kigali Fitness Center"
              value={gymName} onChange={e => handleGymNameChange(e.target.value)} autoFocus />

            <label className={s.label}>Gym URL</label>
            <div className={s.slugWrap}>
              <span className={s.slugPrefix}>gymmind.rw/</span>
              <input className={s.slugInput} type="text" placeholder="kigali-fitness"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}
              />
            </div>
            <p className={s.slugHint}>Members use this link to check in</p>

            <label className={s.label}>Address (optional)</label>
            <input className={s.input} type="text" placeholder="KG 1 Ave, Kigali"
              value={address} onChange={e => setAddress(e.target.value)} />

            <label className={s.label}>Your name (owner)</label>
            <input className={s.input} type="text" placeholder="Jean Paul Habimana"
              value={ownerName} onChange={e => setOwnerName(e.target.value)} />

            <label className={s.label}>Your phone number</label>
            <input className={s.input} type="tel" placeholder="07XX XXX XXX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOtp()}
            />

            {error && <p className={s.error}>{error}</p>}

            <button type="button" className={s.btn}
              disabled={!gymName.trim() || !slug.trim() || !ownerName.trim() || !phone.trim() || loading}
              onClick={sendOtp}
            >
              {loading ? 'Sending code…' : 'Create my gym →'}
            </button>

            <p className={s.loginLink}>
              Already have an account? <Link to="/kigali-fitness/manager">Sign in</Link>
            </p>
          </>
        )}

        {/* ── Step 2: OTP ── */}
        {step === 'otp' && (
          <>
            <h1 className={s.title}>Verify your number</h1>
            <p className={s.sub}>Enter the 6-digit code sent to <strong>{phone}</strong></p>

            <div className={s.otpGrid} onPaste={handleOtpPaste}>
              {otp.map((d, i) => (
                <input key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  type="text" inputMode="numeric" maxLength={1}
                  value={d} onChange={() => {}}
                  onKeyDown={e => handleOtpKey(i, e)}
                  className={`${s.otpCell} ${d ? s.otpCellFilled : ''}`}
                  aria-label={`Digit ${i+1}`}
                />
              ))}
            </div>

            {devCode && <p className={s.devBadge}>DEV code: {devCode}</p>}
            {error && <p className={s.error}>{error}</p>}

            <button type="button" className={s.btn}
              disabled={!otp.every(d => d) || loading}
              onClick={() => verifyOtp(otp.join(''))}
            >
              {loading ? 'Verifying…' : 'Confirm →'}
            </button>

            <button type="button" className={s.btnGhost} onClick={() => { setStep('form'); setOtp(['','','','','','']); setError(''); }}>
              ← Change details
            </button>
          </>
        )}

        {/* ── Step 3: Success ── */}
        {step === 'success' && (
          <>
            <div className={s.successIcon}>🎉</div>
            <h1 className={s.title}>Your gym is ready!</h1>
            <p className={s.sub}>Welcome to GymMind. Your 30-day free trial has started.</p>

            <div className={s.infoBox}>
              <div className={s.infoRow}>
                <span className={s.infoLabel}>Gym URL</span>
                <span className={s.infoValue}>/{gymSlug}/checkin</span>
              </div>
              <div className={s.infoRow}>
                <span className={s.infoLabel}>Manager dashboard</span>
                <span className={s.infoValue}>/{gymSlug}/manager</span>
              </div>
            </div>

            <button type="button" className={s.btn} onClick={() => navigate(`/${gymSlug}/manager`)}>
              Go to my dashboard →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
