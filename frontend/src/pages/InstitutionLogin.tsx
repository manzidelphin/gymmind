import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicApi } from '../api/api';
import GymMindLogo from '../components/GymMindLogo';
import PhoneInput from '../components/PhoneInput';
import s from './Login.module.css';

export default function InstitutionLogin() {
  const navigate = useNavigate();
  const [step,       setStep]       = useState<'phone' | 'otp'>('phone');
  const [phone,      setPhone]      = useState('');
  const [phoneValid, setPhoneValid] = useState(false);
  const [otp,        setOtp]        = useState(['', '', '', '', '', '']);
  const [devCode,    setDevCode]    = useState<string | null>(null);
  const [instName,   setInstName]   = useState('');
  const [_instSlug,   setInstSlug]   = useState('');
  const [gymName,    setGymName]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  async function sendCode() {
    if (!phoneValid) return;
    setLoading(true); setError('');
    try {
      const { data } = await publicApi.post('/institution/send-otp', { phone });
      setInstName(data.institutionName);
      setInstSlug(data.institutionSlug);
      setGymName(data.gymName);
      setDevCode(data.devCode ?? null);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'No institution account found for this number.');
    } finally { setLoading(false); }
  }

  async function verifyCode(code: string) {
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await publicApi.post('/institution/verify-otp', { phone, code });
      localStorage.setItem('institutionToken', data.token);
      localStorage.setItem('institutionUser', JSON.stringify({
        ...data.user,
        institutionName: data.institutionName,
        gymName:         data.gymName,
      }));
      navigate(`/institution/${data.institutionSlug}`);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid code. Try again.');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally { setLoading(false); }
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
    else verifyCode(n.join(''));
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (d.length !== 6) return;
    setOtp(d.split('')); otpRefs.current[5]?.focus(); verifyCode(d);
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logoRow}>
          <GymMindLogo size={48} variant="color" />
          <div className={s.logoText}>GymMind</div>
        </div>

        <div className={s.title}>Institution Portal</div>

        {step === 'phone' && (
          <>
            <div className={s.subtitle}>Enter your phone to access your company's attendance data</div>
            <PhoneInput
              value={phone}
              onChange={(v, valid) => { setPhone(v); setPhoneValid(valid); }}
              inputClassName={s.input}
              onEnter={sendCode}
            />
            {error && <div className={s.error}>{error}</div>}
            <button
              type="button"
              className={s.btnPrimary}
              onClick={sendCode}
              disabled={!phoneValid || loading}
            >
              {loading ? 'Sending…' : 'Send Code →'}
            </button>
            <button type="button" className={s.backLink} onClick={() => navigate('/')}>
              ← Back
            </button>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className={s.subtitle}>Code sent to {phone}</div>
            <div className={s.gymBadge}>Signing in to {instName}</div>
            {gymName && <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px', textAlign: 'center' }}>Powered by {gymName}</div>}
            {devCode && <div className={s.devBadge}>DEV code: {devCode}</div>}
            <div className={s.otpGrid} onPaste={handleOtpPaste}>
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  aria-label={`Digit ${i + 1}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={() => {}}
                  onKeyDown={e => handleOtpKey(i, e)}
                  className={`${s.otpCell} ${d ? s.otpCellFilled : ''}`}
                />
              ))}
            </div>
            {error && <div className={s.error}>{error}</div>}
            <button
              type="button"
              className={s.btnPrimary}
              onClick={() => verifyCode(otp.join(''))}
              disabled={otp.some(d => !d) || loading}
            >
              {loading ? 'Verifying…' : 'Login →'}
            </button>
            <button type="button" className={s.backLink}
              onClick={() => { setStep('phone'); setOtp(['','','','','','']); setError(''); }}
            >
              ← Change number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
