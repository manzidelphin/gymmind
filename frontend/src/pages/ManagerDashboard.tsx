import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/api';
import { useGym } from '../hooks/useGym';
import { useToast } from '../context/ToastContext';
import { useActivityPoller } from '../hooks/useActivityPoller';
import PhoneInput from '../components/PhoneInput';
import GymMindLogo from '../components/GymMindLogo';
import MembersTab from './manager/MembersTab';
import PlansTab from './manager/PlansTab';
import ServicesTab from './manager/ServicesTab';
import AttendanceTab from './manager/AttendanceTab';
import ReportsTab from './manager/ReportsTab';
import InstitutionsTab from './manager/InstitutionsTab';
import ImportTab from './manager/ImportTab';
import PaymentsTab from './manager/PaymentsTab';
import BillingTab from './manager/BillingTab';
import SettingsTab from './manager/SettingsTab';
import s from './ManagerDashboard.module.css';
import ms from './manager/MembersTab.module.css';

type Tab = 'members' | 'approvals' | 'plans' | 'services' | 'institutions' | 'attendance' | 'reports' | 'import' | 'payments' | 'billing' | 'settings';

// ── Login Gate ─────────────────────────────────────────────────
function LoginGate({ onAuth }: { onAuth: (user: any, token: string) => void }) {
  const { gymSlug } = useGym();
  const [loginStep, setLoginStep] = useState<'phone' | 'otp'>('phone');
  const [phone,      setPhone]      = useState('');
  const [phoneValid, setPhoneValid] = useState(false);
  const [otp,     setOtp]     = useState(['', '', '', '', '', '']);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  async function sendOtp() {
    if (!phoneValid) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone: phone.trim() });
      setDevCode(data.devCode ?? null);
      setLoginStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) { setError(e.response?.data?.error ?? 'Failed to send OTP.'); }
    finally { setLoading(false); }
  }

  async function verifyOtp(code: string) {
    if (code.length !== 6) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/verify-otp', { phone: phone.trim(), code });
      if (data.newUser) { setError('No staff account found for this phone.'); return; }
      if (!['gym_owner', 'gym_manager'].includes(data.user?.role)) {
        setError('This page is for gym staff only.'); return;
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
        <p className={s.loginTitle}>Welcome back</p>
        <p className={s.loginSub}>Enter your phone to continue · {gymSlug}</p>

        {loginStep === 'phone' && <>
          <label htmlFor="staff-phone" className={s.label}>Staff phone number</label>
          <PhoneInput
            id="staff-phone"
            value={phone}
            onChange={(v, valid) => { setPhone(v); setPhoneValid(valid); }}
            inputClassName={s.input}
            inputRef={phoneRef}
            onEnter={sendOtp}
          />
          {error && <p className={s.error}>{error}</p>}
          <button
            type="button"
            className={`${s.btn} ${(!phoneValid || loading) ? s.btnDisabled : ''}`}
            onClick={sendOtp}
            disabled={!phoneValid || loading}
          >
            {loading ? 'Sending…' : 'Send Code →'}
          </button>
        </>}

        {loginStep === 'otp' && <>
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
            onClick={() => { setLoginStep('phone'); setOtp(['','','','','','']); setError(''); }}
          >
            ← Change number
          </button>
        </>}
      </div>
    </div>
  );
}

// ── Approvals Tab ──────────────────────────────────────────────
interface ApprovalRequest {
  id: number;
  requested_at: string;
  member_name: string;
  member_phone: string;
  user_id: number | null;
  plan_name: string;
  price: number;
  currency: string;
  plan_type: string;
  duration_days: number | null;
  sessions: number | null;
}

function ApprovalsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const toast = useToast();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [actionId, setActionId] = useState<number | null>(null);

  async function load() {
    try {
      const { data } = await api.get<{ requests: ApprovalRequest[]; total: number }>('/membership-requests?status=pending');
      setRequests(data.requests);
      onCountChange(data.total);
    } catch {
      setError('Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(id: number) {
    const req = requests.find(r => r.id === id);
    setActionId(id);
    try {
      await api.patch(`/membership-requests/${id}/approve`);
      toast.success('Membership approved', req ? `${req.member_name} — plan activated` : 'Membership activated');
      load();
    } catch (err: any) {
      const msg = err.response?.data?.error ?? 'Failed to approve.';
      toast.error('Failed to approve', msg);
    } finally {
      setActionId(null);
    }
  }

  async function reject(id: number) {
    const req = requests.find(r => r.id === id);
    setActionId(id);
    try {
      await api.patch(`/membership-requests/${id}/reject`);
      toast.error('Request rejected', req ? `${req.member_name}'s request has been rejected` : 'Request rejected');
      load();
    } catch (err: any) {
      const msg = err.response?.data?.error ?? 'Failed to reject.';
      toast.error('Failed to reject', msg);
    } finally {
      setActionId(null);
    }
  }

  function planLabel(r: ApprovalRequest) {
    if (r.plan_type === 'session_based') return `${r.sessions ?? '?'} sessions`;
    const d = r.duration_days ?? 0;
    if (d >= 365) return `${Math.round(d / 365)} yr`;
    if (d >= 30)  return `${Math.round(d / 30)} mo`;
    return `${d} d`;
  }

  return (
    <div>
      {loading && <p className={ms.loadingMsg}>Loading requests…</p>}
      {error && <p className={s.error}>{error}</p>}
      {!loading && requests.length === 0 && (
        <div className={ms.empty}>No pending membership requests</div>
      )}
      {!loading && requests.length > 0 && (
        <table className={ms.table}>
          <thead>
            <tr>
              <th className={ms.th}>Member</th>
              <th className={ms.th}>Phone</th>
              <th className={ms.th}>Plan</th>
              <th className={ms.th}>Duration</th>
              <th className={ms.th}>Price</th>
              <th className={ms.th}>Requested</th>
              <th className={ms.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id} className={ms.tr}>
                <td className={ms.td}>
                  {r.member_name}
                  {r.user_id === null && (
                    <span className={`${ms.badge} ${ms.badgePending} ${s.ml8}`}>New</span>
                  )}
                </td>
                <td className={ms.td}>{r.member_phone}</td>
                <td className={ms.td}><span className={ms.planPill}>{r.plan_name}</span></td>
                <td className={ms.td}>{planLabel(r)}</td>
                <td className={ms.td}>{r.price.toLocaleString()} {r.currency}</td>
                <td className={ms.td}>{new Date(r.requested_at).toLocaleDateString()}</td>
                <td className={ms.td}>
                  <button
                    type="button"
                    className={`${ms.actionBtn} ${ms.activateBtn}`}
                    onClick={() => approve(r.id)}
                    disabled={actionId === r.id}
                  >
                    {actionId === r.id ? '…' : '✓ Approve'}
                  </button>
                  <button
                    type="button"
                    className={`${ms.actionBtn} ${ms.suspendBtn}`}
                    onClick={() => reject(r.id)}
                    disabled={actionId === r.id}
                  >
                    ✗ Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────
function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ── Sidebar icons (20×20, stroke style) ───────────────────────
function NavIcon({ type }: { type: Tab }) {
  const p = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'members':
      return <svg {...p}><circle cx="10" cy="7" r="3.25"/><path d="M4 18a6 6 0 0112 0"/></svg>;
    case 'approvals':
      return <svg {...p}><circle cx="10" cy="10" r="7.25"/><path d="M7 10.5l2 2 4-4"/></svg>;
    case 'plans':
      return <svg {...p}><rect x="2.5" y="6" width="15" height="10" rx="1.75"/><line x1="2.5" y1="9.5" x2="17.5" y2="9.5"/><line x1="5.5" y1="13" x2="8.5" y2="13"/></svg>;
    case 'institutions':
      return <svg {...p}><path d="M3 18V10l7-6 7 6v8"/><rect x="8" y="12" width="4" height="6"/></svg>;
    case 'attendance':
      return <svg {...p}><path d="M3.5 16V12m4 4V8m4 8V4m4 12V10"/></svg>;
    case 'reports':
      return <svg {...p}><path d="M4.5 3.5h8l3 3V17.5h-11z"/><path d="M12.5 3.5V6.5h3"/><line x1="7" y1="9.5" x2="13" y2="9.5"/><line x1="7" y1="12.5" x2="13" y2="12.5"/><line x1="7" y1="15.5" x2="10" y2="15.5"/></svg>;
    case 'import':
      return <svg {...p}><path d="M10 3.5v10"/><path d="M7 6.5l3-3 3 3"/><path d="M4 14.5v1A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5v-1"/></svg>;
    case 'payments':
      return <svg {...p}><circle cx="10" cy="10" r="7.25"/><path d="M10 6.5v7"/><path d="M8 13h3.5a1.5 1.5 0 100-3H9a1.5 1.5 0 110-3H12"/></svg>;
    case 'services':
      return <svg {...p}><circle cx="10" cy="10" r="3"/><path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.9 4.9l1 1M14.1 14.1l1 1M4.9 15.1l1-1M14.1 5.9l1-1"/></svg>;
    case 'billing':
      return <svg {...p}><rect x="2.5" y="4.5" width="15" height="11" rx="1.75"/><line x1="2.5" y1="8.5" x2="17.5" y2="8.5"/><line x1="6" y1="12.5" x2="8" y2="12.5"/><line x1="6" y1="12.5" x2="8" y2="12.5"/><circle cx="13" cy="12.5" r="1.5"/></svg>;
    case 'settings':
      return <svg {...p}><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v1.5m0 11.5v1.5M2.5 10H4m12 0h1.5M5.2 5.2l1 1m7.6 7.6 1 1M5.2 14.8l1-1m7.6-7.6 1-1"/></svg>;
    default:
      return null;
  }
}

// ── Main Dashboard ─────────────────────────────────────────────
export default function ManagerDashboard() {
  const { gymSlug, gymName, user, setAuth, clearAuth } = useGym();
  const navigate = useNavigate();
  const [activeTab,    setActiveTab]    = useState<Tab>('members');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);

  const isStaff = user && ['gym_owner', 'gym_manager'].includes(user.role);

  useActivityPoller(!!isStaff);

  useEffect(() => {
    if (!isStaff) return;
    function fetchCount() {
      api.get<{ total: number }>('/membership-requests?status=pending')
        .then(r => setPendingCount(r.data.total))
        .catch(() => {});
    }
    fetchCount();
    const t = setInterval(fetchCount, 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);

  if (!isStaff) return <LoginGate onAuth={(u, t) => setAuth(u, t)} />;

  function navigate_tab(key: Tab) {
    setActiveTab(key);
    setSidebarOpen(false);
  }

  const PROTECTED: Tab[] = ['approvals','plans','services','institutions','reports','import','payments','billing','settings'];
  const [pinTab, setPinTab] = React.useState<Tab|null>(null);
  const [pinVal, setPinVal] = React.useState('');
  const [pinErr, setPinErr] = React.useState('');
  const PIN_KEY = 'gm_pin';
  const [resetStep, setResetStep] = React.useState<'idle'|'otp'|'newpin'>('idle');
  const [resetOtp, setResetOtp] = React.useState('');
  const [resetOtpSent, setResetOtpSent] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [resetErr, setResetErr] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const getPin = () => localStorage.getItem(PIN_KEY) || '';
  const onTabClick = (key: Tab) => {
    if (PROTECTED.includes(key)) { setPinTab(key); setPinVal(''); setPinErr(''); }
    else navigate_tab(key);
  };
  const doPin = () => {
    const p = getPin();
    if (!p) {
      if (pinVal.length < 4) { setPinErr('Min 4 digits'); return; }
      localStorage.setItem(PIN_KEY, pinVal);
      const t = pinTab!; setPinTab(null); navigate_tab(t);
    } else if (pinVal === p) {
      const t = pinTab!; setPinTab(null); setPinVal(''); navigate_tab(t);
    } else { setPinErr('Wrong PIN'); setPinVal(''); }
  };
  const navItems: { key: Tab; label: string }[] = [
    { key: 'members',      label: 'Members' },
    { key: 'approvals',    label: 'Approvals' },
    { key: 'plans',        label: 'Plans' },
    { key: 'services',     label: 'Services' },
    { key: 'institutions', label: 'Institutions' },
    { key: 'attendance',   label: 'Attendance' },
    { key: 'reports',      label: 'Reports' },
    { key: 'import',       label: 'Import' },
    { key: 'payments',     label: 'Payments' },
    { key: 'billing',      label: 'Billing' },
    { key: 'settings',     label: 'Settings' },
  ];

  return (
    <div className={s.dashboardLayout}>
      {/* Mobile hamburger */}
      <button
        type="button"
        className={s.hamburger}
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className={s.sidebarOverlayVisible}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`${s.sidebar} ${sidebarOpen ? s.sidebarMobileOpen : ''}`}>
        <button
          type="button"
          className={s.sidebarClose}
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          ×
        </button>

        <div className={s.sidebarTop}>
          <GymMindLogo size={36} variant="white" />
          <span className={s.sidebarBrand}>GymMind</span>
          <span className={s.sidebarGymBadge}>{gymSlug}</span>
        </div>

        <nav className={s.sidebarNav}>
          {navItems.map(item => (
            <button
              key={item.key}
              type="button"
              className={`${s.navItem} ${activeTab === item.key ? s.navItemActive : ''}`}
              onClick={() => onTabClick(item.key)}
            >
              <span className={s.navIconWrap}>
                <NavIcon type={item.key} />
                {item.key === 'approvals' && pendingCount ? (
                  <span className={s.navBadge}>{pendingCount}</span>
                ) : null}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className={s.sidebarBottom}>
          <div className={s.sidebarUser}>
            <div className={s.avatarCircle}>{initials(user.name)}</div>
            <div>
              <div className={s.userName}>{user.name}</div>
              <div className={s.userRole}>{gymName || gymSlug.charAt(0).toUpperCase() + gymSlug.slice(1)}</div>
            </div>
          </div>
          <button
            type="button"
            className={s.sidebarLogout}
            onClick={() => { clearAuth(); navigate('/'); }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className={s.mainContent}>
        {activeTab === 'members'      && <MembersTab />}
        {activeTab === 'approvals'    && <ApprovalsTab onCountChange={setPendingCount} />}
        {activeTab === 'plans'        && <PlansTab />}
        {activeTab === 'services'     && <ServicesTab />}
        {activeTab === 'institutions' && <InstitutionsTab />}
        {activeTab === 'attendance'   && <AttendanceTab />}
        {activeTab === 'reports'      && <ReportsTab />}
        {activeTab === 'import'       && <ImportTab />}
        {activeTab === 'payments'     && <PaymentsTab />}
        {activeTab === 'billing'      && <BillingTab />}
        {activeTab === 'settings'     && <SettingsTab />}
      </main>
      {pinTab && (
        <div style={{position:'fixed',inset:'0',background:'rgba(0,0,0,0.8)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#fff',borderRadius:'20px',padding:'36px',width:'340px',textAlign:'center'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>{'🔒'}</div>
            <h2 style={{fontSize:'18px',fontWeight:700,marginBottom:'8px'}}>
              {getPin() ? 'Manager Access Required' : 'Set Manager PIN'}
            </h2>
            <p style={{fontSize:'13px',color:'#64748b',marginBottom:'16px'}}>
              {getPin() ? 'Enter PIN to access this section.' : 'Create a PIN to protect restricted tabs.'}
            </p>
            <input type='password' inputMode='numeric'
              placeholder={getPin() ? 'Enter PIN' : 'Create PIN (4+ digits)'}
              value={pinVal} autoFocus
              onChange={e => { setPinVal(e.target.value.replace(/\D/g,'')); setPinErr(''); }}
              onKeyDown={e => { if(e.key==='Enter') doPin(); }}
              style={{width:'100%',padding:'12px',border:'2px solid '+(pinErr?'#ef4444':'#e5e7eb'),borderRadius:'10px',fontSize:'18px',textAlign:'center',outline:'none',letterSpacing:'4px',marginBottom:'6px'}}
            />
            {pinErr && <p style={{color:'#ef4444',fontSize:'12px',marginBottom:'8px'}}>{pinErr}</p>}
            <button onClick={doPin} style={{width:'100%',padding:'12px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:600,cursor:'pointer',marginBottom:'8px'}}>
              {getPin() ? 'Unlock' : 'Set PIN'}
            </button>
            <button onClick={() => setPinTab(null)} style={{width:'100%',padding:'8px',background:'transparent',color:'#94a3b8',border:'none',cursor:'pointer',fontSize:'13px'}}>
              Cancel
            </button>
            {getPin() && resetStep === 'idle' && (
              <button onClick={async () => {
                setResetLoading(true); setResetErr('');
                try {
                  const phone = localStorage.getItem('gm_mgr_phone') || '';
                  const r = await fetch('/api/auth/send-otp', {method:'POST',headers:{'Content-Type':'application/json','X-Gym-Slug':location.pathname.split('/')[1]||''},body:JSON.stringify({phone})});
                  const d = await r.json();
                  if(d.devCode) setResetOtpSent(d.devCode);
                  setResetStep('otp'); setResetOtp(''); setResetErr('');
                } catch(e) { setResetErr('Failed to send OTP'); }
                setResetLoading(false);
              }} style={{width:'100%',padding:'6px',background:'transparent',color:'#cbd5e1',border:'none',cursor:'pointer',fontSize:'11px',marginTop:'4px'}}>
                {resetLoading ? 'Sending...' : 'Forgot PIN? Reset it'}
              </button>
            )}
            {resetStep === 'otp' && (
              <div style={{marginTop:'12px',borderTop:'1px solid #f1f5f9',paddingTop:'12px'}}>
                <p style={{fontSize:'12px',color:'#64748b',marginBottom:'8px'}}>Enter the OTP sent to your phone</p>
                {resetOtpSent && <p style={{fontSize:'11px',color:'#f59e0b',marginBottom:'6px'}}>Dev OTP: {resetOtpSent}</p>}
                <input type="text" inputMode="numeric" maxLength={6} placeholder="6-digit OTP"
                  value={resetOtp} onChange={e => { setResetOtp(e.target.value.replace(/\D/g,'')); setResetErr(''); }}
                  style={{width:'100%',padding:'10px',border:'1px solid #e5e7eb',borderRadius:'8px',fontSize:'16px',textAlign:'center',outline:'none',letterSpacing:'4px',marginBottom:'6px'}}
                />
                {resetErr && <p style={{color:'#ef4444',fontSize:'11px',marginBottom:'6px'}}>{resetErr}</p>}
                <button onClick={async () => {
                  setResetLoading(true);
                  try {
                    const phone = localStorage.getItem('gm_mgr_phone') || '';
                    const slug = location.pathname.split('/')[1] || '';
                    const r = await fetch('/api/auth/verify-otp', {method:'POST',headers:{'Content-Type':'application/json','X-Gym-Slug':slug},body:JSON.stringify({phone,code:resetOtp})});
                    const d = await r.json();
                    if(d.token) { setResetStep('newpin'); setNewPin(''); setConfirmPin(''); setResetErr(''); }
                    else setResetErr('Invalid OTP. Try again.');
                  } catch(e) { setResetErr('Verification failed'); }
                  setResetLoading(false);
                }} style={{width:'100%',padding:'10px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer',marginBottom:'6px'}}>
                  {resetLoading ? 'Verifying...' : 'Verify OTP'}
                </button>
                <button onClick={() => { setResetStep('idle'); setResetOtp(''); setResetErr(''); }}
                  style={{width:'100%',padding:'6px',background:'transparent',color:'#94a3b8',border:'none',cursor:'pointer',fontSize:'11px'}}>
                  Back
                </button>
              </div>
            )}
            {resetStep === 'newpin' && (
              <div style={{marginTop:'12px',borderTop:'1px solid #f1f5f9',paddingTop:'12px'}}>
                <p style={{fontSize:'12px',color:'#64748b',marginBottom:'8px'}}>Set your new PIN</p>
                <input type="password" inputMode="numeric" placeholder="New PIN (4+ digits)"
                  value={newPin} onChange={e => { setNewPin(e.target.value.replace(/\D/g,'')); setResetErr(''); }}
                  style={{width:'100%',padding:'10px',border:'1px solid #e5e7eb',borderRadius:'8px',fontSize:'16px',textAlign:'center',outline:'none',letterSpacing:'4px',marginBottom:'6px'}}
                />
                <input type="password" inputMode="numeric" placeholder="Confirm PIN"
                  value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g,'')); setResetErr(''); }}
                  style={{width:'100%',padding:'10px',border:'1px solid #e5e7eb',borderRadius:'8px',fontSize:'16px',textAlign:'center',outline:'none',letterSpacing:'4px',marginBottom:'6px'}}
                />
                {resetErr && <p style={{color:'#ef4444',fontSize:'11px',marginBottom:'6px'}}>{resetErr}</p>}
                <button onClick={() => {
                  if(newPin.length < 4) { setResetErr('PIN must be at least 4 digits'); return; }
                  if(newPin !== confirmPin) { setResetErr('PINs do not match'); return; }
                  localStorage.setItem(PIN_KEY, newPin);
                  setResetStep('idle'); setNewPin(''); setConfirmPin('');
                  setPinTab(null); setPinVal(''); setPinErr('');
                  alert('PIN reset successfully!');
                }} style={{width:'100%',padding:'10px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer',marginBottom:'6px'}}>
                  Reset PIN
                </button>
                <button onClick={() => { setResetStep('idle'); setResetErr(''); }}
                  style={{width:'100%',padding:'6px',background:'transparent',color:'#94a3b8',border:'none',cursor:'pointer',fontSize:'11px'}}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
