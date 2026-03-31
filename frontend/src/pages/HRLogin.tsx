import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicApi } from '../api/api';
import s from './HRLogin.module.css';

export default function HRLogin() {
  const navigate = useNavigate();

  const [phase,   setPhase]   = useState<'phone' | 'otp'>('phone');
  const [phone,   setPhone]   = useState('');
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function sendOtp() {
    if (!phone.trim()) return;
    setLoading(true); setError('');
    try {
      await publicApi.post('/hr/auth/send-otp', { phone: phone.trim() });
      setPhase('otp');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await publicApi.post('/hr/auth/verify-otp', { phone: phone.trim(), code });
      localStorage.setItem('hr_token', data.token);
      navigate('/hr/dashboard');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid or expired code.');
    } finally { setLoading(false); }
  }

  return (
    <div className={s.root}>
      <div className={s.card}>
        <div className={s.logo}>GymMind</div>
        <h1 className={s.title}>HR Admin Portal</h1>
        <p className={s.sub}>Sign in to manage your employee wellness program</p>

        {phase === 'phone' ? (
          <div className={s.form}>
            <label className={s.label}>Phone Number</label>
            <input
              className={s.input}
              type="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOtp()}
              autoFocus
            />
            {error && <div className={s.error}>{error}</div>}
            <button
              className={s.btn}
              onClick={sendOtp}
              disabled={loading || !phone.trim()}
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        ) : (
          <div className={s.form}>
            <label className={s.label}>
              Enter the 6-digit code sent to <strong>{phone}</strong>
            </label>
            <input
              className={`${s.input} ${s.inputCode}`}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && verifyOtp()}
              autoFocus
            />
            {error && <div className={s.error}>{error}</div>}
            <button
              className={s.btn}
              onClick={verifyOtp}
              disabled={loading || code.length !== 6}
            >
              {loading ? 'Verifying…' : 'Login'}
            </button>
            <button
              className={s.btnLink}
              onClick={() => { setPhase('phone'); setCode(''); setError(''); }}
            >
              ← Change number
            </button>
          </div>
        )}

        <div className={s.powered}>Powered by GymMind</div>
      </div>
    </div>
  );
}
