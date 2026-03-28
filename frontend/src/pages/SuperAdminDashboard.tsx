import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '../api/api';
import s from './SuperAdminDashboard.module.css';

// Dedicated axios instance for super admin auth — absolute URL bypasses Vite proxy.
const adminApi = axios.create({
  baseURL: window.location.hostname === 'localhost'
    ? 'http://localhost:3002/api'
    : `${window.location.origin}/api`,
});

interface Gym {
  id: number; name: string; slug: string; subscription_plan: string;
  subscription_status: string; member_count: number; last_checkin_at: string | null;
  created_at: string;
}
interface Stats { total_gyms: number; total_members: number; checkins_today: number; }

// ── Login Gate ─────────────────────────────────────────────────
function LoginGate({ onLogin }: { onLogin: (token: string, user: any) => void }) {
  const [step,    setStep]    = useState<'phone' | 'otp'>('phone');
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState('');
  const [devCode, setDevCode] = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const res = await adminApi.post('/auth/admin/send-otp', { phone });
      setDevCode(res.data.devCode ?? '');
      setStep('otp');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    if (loading) return;
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return; }
    setLoading(true); setError('');
    try {
      const res = await adminApi.post('/auth/admin/verify-otp', { phone, code: otp });
      onLogin(res.data.token, res.data.user);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid or expired code');
      setLoading(false); // only reset on failure; success unmounts the component
    }
  }

  if (step === 'phone') {
    return (
      <div className={s.loginWrap}>
        <div className={s.loginCard}>
          <p className={s.loginTitle}>Platform Admin</p>
          <p className={s.loginSub}>GymMind Super Admin</p>
          <label htmlFor="sa-phone" className={s.label}>Admin phone number</label>
          <input
            id="sa-phone"
            type="tel"
            placeholder="0780 000 000"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendCode()}
            className={s.input}
            autoFocus
          />
          {error && <p className={s.error}>{error}</p>}
          <button
            type="button"
            className={`${s.btn} ${(loading || phone.length < 9) ? s.btnDisabled : ''}`}
            onClick={sendCode}
            disabled={loading || phone.length < 9}
          >
            {loading ? 'Sending…' : 'Send Code →'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.loginWrap}>
      <div className={s.loginCard}>
        <p className={s.loginTitle}>Platform Admin</p>
        <p className={s.loginSub}>Code sent to {phone}</p>
        {devCode && <p className={s.devCode}>DEV code: {devCode}</p>}
        <label htmlFor="sa-otp" className={s.label}>6-digit code</label>
        <input
          id="sa-otp"
          type="text"
          inputMode="numeric"
          placeholder="123456"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && verifyCode()}
          maxLength={6}
          className={s.input}
          autoFocus
        />
        {error && <p className={s.error}>{error}</p>}
        <button
          type="button"
          className={`${s.btn} ${(loading || otp.length !== 6) ? s.btnDisabled : ''}`}
          onClick={verifyCode}
          disabled={loading || otp.length !== 6}
        >
          {loading ? 'Verifying…' : 'Login →'}
        </button>
        <button
          type="button"
          className={`${s.btn} ${s.btnGhost}`}
          onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
        >
          ← Change number
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────
export default function SuperAdminDashboard() {
  const [adminUser,  setAdminUser]  = useState<any>(() => {
    const stored = localStorage.getItem('adminUser');
    return stored ? JSON.parse(stored) : null;
  });
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem('adminToken') ?? '');

  const [gyms,    setGyms]    = useState<Gym[]>([]);
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  // Create gym form
  const [showForm,   setShowForm]   = useState(false);
  const [gymName,    setGymName]    = useState('');
  const [gymSlugVal, setGymSlugVal] = useState('');
  const [gymPlan,    setGymPlan]    = useState('trial');
  const [gymPhone,   setGymPhone]   = useState('');
  const [creating,   setCreating]   = useState(false);
  const [formErr,    setFormErr]    = useState('');
  const [formOk,     setFormOk]     = useState('');

  function handleLogin(token: string, user: any) {
    localStorage.setItem('adminToken', token);
    localStorage.setItem('adminUser', JSON.stringify(user));
    localStorage.setItem('token', token); // picked up by api interceptor for /admin/* calls
    setAdminToken(token);
    setAdminUser(user);
  }

  function handleLogout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    localStorage.removeItem('token');
    setAdminToken('');
    setAdminUser(null);
  }

  const isAdmin = !!adminToken && adminUser?.role === 'super_admin';

  async function fetchAll() {
    setLoading(true);
    try {
      const [{ data: g }, { data: st }] = await Promise.all([
        api.get<Gym[]>('/admin/gyms'),
        api.get<Stats>('/admin/stats'),
      ]);
      setGyms(g);
      setStats(st);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (isAdmin) fetchAll(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleGym(gym: Gym) {
    const newStatus = gym.subscription_status === 'active' ? 'suspended' : 'active';
    await api.patch(`/admin/gyms/${gym.id}`, { subscription_status: newStatus });
    fetchAll();
  }

  async function createGym() {
    if (!gymName.trim() || !gymSlugVal.trim()) return;
    setCreating(true); setFormErr(''); setFormOk('');
    try {
      await api.post('/admin/gyms', {
        name: gymName.trim(), slug: gymSlugVal.trim(),
        subscription_plan: gymPlan,
        phone: gymPhone.trim() || undefined,
      });
      setGymName(''); setGymSlugVal(''); setGymPlan('trial'); setGymPhone('');
      setFormOk('Gym created successfully.');
      setShowForm(false);
      fetchAll();
    } catch (e: any) { setFormErr(e.response?.data?.error ?? 'Failed to create gym.'); }
    finally { setCreating(false); }
  }

  function formatLastCheckin(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusClass(status: string) {
    if (status === 'active')    return s.badgeActive;
    if (status === 'suspended') return s.badgeSuspended;
    return s.badgeCancelled;
  }

  if (!isAdmin) {
    return <LoginGate onLogin={handleLogin} />;
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <span className={s.logoText}>GymMind</span>
          <span className={s.adminBadge}>Super Admin</span>
        </div>
        <div className={s.userInfo}>
          <span>{adminUser?.name}</span>
          <button type="button" className={s.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={s.body}>
        {/* Stats */}
        {stats && (
          <div className={s.statsRow}>
            {[
              { num: stats.total_gyms,    label: 'Total gyms',       color: '#7c3aed' },
              { num: stats.total_members, label: 'Total members',    color: '#2563eb' },
              { num: stats.checkins_today,label: "Check-ins today",  color: '#059669' },
            ].map(c => (
              <div key={c.label} className={s.statCard} style={{ borderLeftColor: c.color }}>
                <p className={s.statNum} style={{ color: c.color }}>{c.num}</p>
                <p className={s.statLabel}>{c.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Gyms table */}
        <div className={s.sectionHeader}>
          <p className={s.sectionTitle}>All Gyms</p>
          <button type="button" className={s.addBtn} onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Gym'}
          </button>
        </div>

        {formOk && <p className={s.formSuccess}>{formOk}</p>}

        {loading && <p style={{ color: '#64748b', marginBottom: '16px' }}>Loading…</p>}

        {!loading && (
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>Gym</th>
                <th className={s.th}>Slug</th>
                <th className={s.th}>Plan</th>
                <th className={s.th}>Status</th>
                <th className={s.th}>Members</th>
                <th className={s.th}>Last check-in</th>
                <th className={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {gyms.map(gym => (
                <tr key={gym.id} className={s.tr}>
                  <td className={s.td}>{gym.name}</td>
                  <td className={s.td}>{gym.slug}</td>
                  <td className={s.td}><span className={s.planBadge}>{gym.subscription_plan}</span></td>
                  <td className={s.td}>
                    <span className={`${s.badge} ${statusClass(gym.subscription_status)}`}>
                      {gym.subscription_status}
                    </span>
                  </td>
                  <td className={s.td}>{gym.member_count}</td>
                  <td className={s.td}>{formatLastCheckin(gym.last_checkin_at)}</td>
                  <td className={s.td}>
                    <button
                      type="button"
                      className={`${s.actionBtn} ${gym.subscription_status === 'active' ? s.suspendBtn : s.activateBtn}`}
                      onClick={() => toggleGym(gym)}
                    >
                      {gym.subscription_status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Create gym form */}
        {showForm && (
          <div className={s.formCard}>
            <p className={s.formTitle}>Create New Gym</p>
            <div className={s.formGrid}>
              <div className={s.formGroup}>
                <label htmlFor="gym-name" className={s.formLabel}>Gym name</label>
                <input id="gym-name" type="text" placeholder="e.g. Musanze Gym"
                  className={s.formInput} value={gymName} onChange={e => setGymName(e.target.value)} />
              </div>
              <div className={s.formGroup}>
                <label htmlFor="gym-slug" className={s.formLabel}>Slug (URL ID)</label>
                <input id="gym-slug" type="text" placeholder="e.g. musanze-gym"
                  className={s.formInput} value={gymSlugVal}
                  onChange={e => setGymSlugVal(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
              </div>
              <div className={s.formGroup}>
                <label htmlFor="gym-plan" className={s.formLabel}>Subscription plan</label>
                <select id="gym-plan" className={s.formSelect} value={gymPlan} onChange={e => setGymPlan(e.target.value)}>
                  <option value="trial">Trial</option>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className={s.formGroup}>
                <label htmlFor="gym-phone" className={s.formLabel}>Phone (optional)</label>
                <input id="gym-phone" type="tel" placeholder="+250 7XX XXX XXX"
                  className={s.formInput} value={gymPhone} onChange={e => setGymPhone(e.target.value)} />
              </div>
            </div>
            {formErr && <p className={s.formError}>{formErr}</p>}
            <button
              type="button"
              className={`${s.submitBtn} ${(!gymName.trim() || !gymSlugVal.trim() || creating) ? s.submitBtnDisabled : ''}`}
              onClick={createGym}
              disabled={!gymName.trim() || !gymSlugVal.trim() || creating}
            >
              {creating ? 'Creating…' : 'Create Gym'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
