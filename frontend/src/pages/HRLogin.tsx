import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicApi } from '../api/api';
import s from './HRLogin.module.css';

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="9" fill="#10B981" fillOpacity="0.2" />
      <path d="M5 9l3 3 5-5" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HRLogin() {
  const navigate = useNavigate();

  const [phase,   setPhase]   = useState<'phone' | 'otp'>('phone');
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function sendOtp() {
    if (!phone.trim()) return;
    setLoading(true); setError('');
    try {
      await publicApi.post('/hr/auth/send-otp', { phone: phone.trim() });
      setPhase('otp');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to send code. Check the number and try again.');
    } finally { setLoading(false); }
  }

  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next  = [...otp];
    next[idx]   = digit;
    setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) { setOtp(text.split('')); otpRefs.current[5]?.focus(); e.preventDefault(); }
  }

  async function verifyOtp() {
    const code = otp.join('');
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await publicApi.post('/hr/auth/verify-otp', { phone: phone.trim(), code });
      localStorage.setItem('hr_token', data.token);
      navigate('/hr/dashboard');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid or expired code. Request a new one.');
    } finally { setLoading(false); }
  }

  return (
    <div className={s.root}>

      {/* ── Left: Marketing panel ── */}
      <div className={s.left}>
        <div className={s.leftInner}>

          <div className={s.brand}>
            <div className={s.brandMark}>G</div>
            <span className={s.brandName}>GymMind</span>
          </div>

          <div className={s.heroSection}>
            <h1 className={s.heroTitle}>
              Employee Wellness,<br />Fully Verified.
            </h1>
            <p className={s.heroSub}>
              The corporate wellness platform built for Rwanda's leading employers.
              Every check-in is OTP-verified. Every invoice is transparent.
            </p>
          </div>

          <ul className={s.valueList}>
            <li className={s.valueItem}><CheckIcon /><span>Real-time attendance tracking across all locations</span></li>
            <li className={s.valueItem}><CheckIcon /><span>Zero false check-ins — every visit is OTP-verified</span></li>
            <li className={s.valueItem}><CheckIcon /><span>Automated monthly reports &amp; invoicing</span></li>
            <li className={s.valueItem}><CheckIcon /><span>Department-level insights &amp; compliance tracking</span></li>
          </ul>

          <blockquote className={s.quote}>
            <p>"We pay for results, not promises."</p>
            <footer>— The GymMind philosophy</footer>
          </blockquote>

          <div className={s.trusted}>
            <div className={s.trustedLabel}>Trusted by leading companies</div>
            <div className={s.trustedLogos}>
              <div className={s.logoChip}>RwandAir</div>
              <div className={s.logoChip}>Bank of Kigali</div>
              <div className={s.logoChip}>MTN Rwanda</div>
              <div className={s.logoChip}>+ more</div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Right: Login form ── */}
      <div className={s.right}>
        <div className={s.formWrap}>

          <div className={s.formHeader}>
            <div className={s.formBadge}>Enterprise HR Portal</div>
            <h2 className={s.formTitle}>Welcome back</h2>
            <p className={s.formSub}>Sign in to your HR Administrator account</p>
          </div>

          {phase === 'phone' ? (
            <>
              <label className={s.label}>Phone Number</label>
              <input
                className={s.input}
                type="tel"
                placeholder="e.g. 0788 123 456"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendOtp()}
                autoFocus
              />
              {error && <div className={s.error}>{error}</div>}
              <button className={s.btn} onClick={sendOtp} disabled={loading || !phone.trim()}>
                {loading
                  ? <span className={s.spinner} />
                  : 'Send Verification Code'}
              </button>
            </>
          ) : (
            <>
              <div className={s.otpHint}>
                Enter the 6-digit code sent to <strong>{phone}</strong>
              </div>
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
              {error && <div className={s.error}>{error}</div>}
              <button
                className={s.btn}
                onClick={verifyOtp}
                disabled={loading || otp.join('').length < 6}
              >
                {loading ? <span className={s.spinner} /> : 'Sign In'}
              </button>
              <button
                className={s.btnGhost}
                onClick={() => { setPhase('phone'); setOtp(['', '', '', '', '', '']); setError(''); }}
              >
                ← Change phone number
              </button>
            </>
          )}

          <div className={s.formFooter}>
            Don't have an account?{' '}
            <a href="mailto:hello@gymmind.app" className={s.contactLink}>Contact GymMind</a>
          </div>

        </div>
      </div>
    </div>
  );
}
