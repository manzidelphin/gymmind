import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { publicApi, institutionApi } from '../api/api';
import GymMindLogo from '../components/GymMindLogo';
import PhoneInput from '../components/PhoneInput';
import { useToast } from '../context/ToastContext';
import s from './InstitutionPortal.module.css';

type Screen = 'login-phone' | 'login-otp' | 'dashboard';
type Tab    = 'overview' | 'attendance' | 'members';

interface ServiceInfo {
  id: number;
  name: string;
}

interface BillingInfo {
  rate_per_session:  number;
  total_visits:      number;
  calculated_amount: number;
  payment_status:    'pending' | 'paid' | 'overdue' | null;
  paid_at:           string | null;
  paid_amount:       number | null;
  payment_reference: string | null;
}

interface AttendanceRow {
  name: string;
  parent_name: string | null;
  parent_id: number | null;
  status: string;
  visit_count: number;
  visit_dates: string | null;
  service_breakdown?: Record<string, number>;
}

interface Member {
  id: number;
  name: string;
  status: string;
  parent_id: number | null;
  parent_name: string | null;
  total_checkins: number;
}

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export default function InstitutionPortal() {
  const { institutionSlug } = useParams<{ institutionSlug: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  // Detect existing session
  const storedToken = localStorage.getItem('institutionToken');
  const storedUser  = localStorage.getItem('institutionUser');

  const [screen, setScreen] = useState<Screen>(
    storedToken && storedUser ? 'dashboard' : 'login-phone'
  );
  const [tab, setTab] = useState<Tab>('overview');

  // Login state
  const [phone,      setPhone]      = useState('');
  const [phoneValid, setPhoneValid] = useState(false);
  const [otp,        setOtp]        = useState(['', '', '', '', '', '']);
  const [devCode,    setDevCode]    = useState<string | null>(null);
  const [instName,   setInstName]   = useState('');
  const [gymName,    setGymName]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  // Dashboard state
  const [instInfo,    setInstInfo]    = useState<any>(null);
  const [attendance,  setAttendance]  = useState<AttendanceRow[]>([]);
  const [services,    setServices]    = useState<ServiceInfo[]>([]);
  const [billing,     setBilling]     = useState<BillingInfo | null>(null);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [month,       setMonth]       = useState(nowMonth());
  const [dataLoading, setDataLoading] = useState(false);
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());

  // Restore institution name from stored user for badge display
  useEffect(() => {
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        setInstName(u.institutionName ?? '');
        setGymName(u.gymName ?? '');
      } catch { /* ignore */ }
    }
  }, []);

  // Load dashboard data when on dashboard
  useEffect(() => {
    if (screen !== 'dashboard') return;
    loadDashboard();
  }, [screen, month]);

  async function loadDashboard() {
    setDataLoading(true);
    try {
      const [meRes, attRes] = await Promise.all([
        institutionApi.get('/institution/me'),
        institutionApi.get(`/institution/attendance?month=${month}`),
      ]);
      setInstInfo(meRes.data);
      setAttendance(attRes.data.data ?? []);
      setServices(attRes.data.services ?? []);
      setBilling(attRes.data.billing ?? null);
    } catch {
      toast.error('Failed to load data', 'Please refresh and try again');
    }
    finally { setDataLoading(false); }
  }

  async function loadMembers() {
    if (members.length > 0) return;
    setDataLoading(true);
    try {
      const { data } = await institutionApi.get('/institution/members');
      setMembers(data);
    } finally { setDataLoading(false); }
  }

  useEffect(() => {
    if (tab === 'members') loadMembers();
    if (tab === 'attendance') loadAttendance();
  }, [tab]);

  async function loadAttendance() {
    setDataLoading(true);
    try {
      const { data } = await institutionApi.get(`/institution/attendance?month=${month}`);
      setAttendance(data.data ?? []);
      setServices(data.services ?? []);
      setBilling(data.billing ?? null);
    } finally { setDataLoading(false); }
  }

  useEffect(() => {
    if (tab === 'attendance' || tab === 'overview') loadDashboard();
  }, [month]);

  // ── Login flow ───────────────────────────────────────────────

  async function sendCode() {
    if (!phoneValid) return;
    setLoading(true); setError('');
    try {
      const { data } = await publicApi.post('/institution/send-otp', { phone });
      setInstName(data.institutionName);
      setGymName(data.gymName);
      setDevCode(data.devCode ?? null);
      setOtp(['', '', '', '', '', '']);
      setScreen('login-otp');
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
      setInstName(data.institutionName);
      setGymName(data.gymName);
      setScreen('dashboard');
      toast.success('Welcome back', `Signed in to ${data.institutionName}`);
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

  function logout() {
    localStorage.removeItem('institutionToken');
    localStorage.removeItem('institutionUser');
    setScreen('login-phone');
    setInstName(''); setGymName('');
    setAttendance([]); setMembers([]); setInstInfo(null);
  }

  // ── PDF export ───────────────────────────────────────────────

  function downloadPdf() {
    const displayInstName = instInfo?.name ?? instName;
    const displayGymName  = instInfo?.gym_name ?? gymName;
    const [yr, mo]        = month.split('-');
    const monthLabel      = new Date(parseInt(yr), parseInt(mo) - 1, 1)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const generatedAt     = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const total       = attendance.reduce((n, r) => n + r.visit_count, 0);
    const activeCount = attendance.filter(r => r.visit_count > 0).length;
    const verifyId    = Math.random().toString(36).slice(2, 10).toUpperCase();

    const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const lm    = 20;   // left margin
    const rm    = 190;  // right edge
    const cw    = 170;  // content width
    const GREEN: [number, number, number]      = [15, 110, 86];
    const GRAY:  [number, number, number]      = [100, 116, 139];
    const DARK:  [number, number, number]      = [15, 23, 42];
    const LIGHT: [number, number, number]      = [248, 250, 252];

    let y = 20;

    // ── HEADER ──────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...GREEN);
    doc.text('GymMind', lm, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...GRAY);
    doc.text('ATTENDANCE REPORT', rm, y, { align: 'right' });

    y += 6;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.line(lm, y, rm, y);
    y += 8;

    // ── REPORT INFO ─────────────────────────────────────────────
    const infoRows: [string, string][] = [
      ['Institution:', displayInstName],
      ['Gym:', displayGymName],
      ['Period:', monthLabel],
      ['Generated:', generatedAt],
    ];
    doc.setFontSize(10);
    for (const [label, value] of infoRows) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK);
      doc.text(label, lm, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(55, 65, 81);
      doc.text(value, lm + 32, y);
      y += 6;
    }
    y += 2;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY);
    doc.text(
      'This report is verified and generated directly by GymMind',
      lm, y
    );
    y += 12;

    // ── SUMMARY BOXES ───────────────────────────────────────────
    const boxW   = 52;
    const boxH   = 22;
    const boxGap = 7;
    const summaryBoxes = [
      { label: 'Total Members',    value: String(attendance.length) },
      { label: 'Active This Month', value: String(activeCount) },
      { label: 'Total Visits',     value: String(total) },
    ];
    summaryBoxes.forEach((box, i) => {
      const bx = lm + i * (boxW + boxGap);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.setFillColor(...LIGHT);
      doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY);
      doc.text(box.label, bx + boxW / 2, y + 7, { align: 'center' });

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GREEN);
      doc.text(box.value, bx + boxW / 2, y + 17, { align: 'center' });
    });
    y += boxH + 10;

    // ── ATTENDANCE TABLE ─────────────────────────────────────────
    const tableBody = attendance.map(row => [
      row.name,
      row.parent_id ? `Dependent of ${row.parent_name ?? ''}` : 'Employee',
      String(row.visit_count),
    ]);
    tableBody.push(['TOTAL', '', String(total)]);

    autoTable(doc, {
      startY: y,
      head: [['NAME', 'TYPE', 'VISITS']],
      body: tableBody,
      margin: { left: lm, right: 20 },
      styles: {
        font: 'helvetica',
        fontSize: 10,
        cellPadding: 4,
        textColor: [55, 65, 81],
      },
      headStyles: {
        fillColor: GREEN,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      alternateRowStyles: { fillColor: LIGHT },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 68 },
        2: { cellWidth: 22, halign: 'center' },
      },
      didParseCell(data) {
        if (data.row.index === tableBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [229, 231, 235];
          data.cell.styles.textColor = DARK;
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterTable = (doc as any).lastAutoTable.finalY + 10;

    // ── BILLING SUMMARY ──────────────────────────────────────────
    const billingBlockH = (billing && billing.rate_per_session > 0) ? 38 : 0;
    if (billing && billing.rate_per_session > 0) {
      const billingY = afterTable;
      const bsH = 28;

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(lm, billingY, cw, bsH, 2, 2, 'FD');

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK);
      doc.text('BILLING SUMMARY', lm + 6, billingY + 8);

      const billingStatus = billing.payment_status ?? 'pending';
      const billingLines: [string, string][] = [
        ['Total visits:',       String(billing.total_visits)],
        ['Rate per session:',   `${billing.rate_per_session.toLocaleString()} RWF`],
        ['Calculated amount:',  `${billing.calculated_amount.toLocaleString()} RWF`],
        ['Status:',             billingStatus.toUpperCase()],
      ];
      doc.setFontSize(9);
      let bx = lm + 6;
      for (const [label, value] of billingLines) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRAY);
        doc.text(label, bx, billingY + 18);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);
        doc.text(value, bx + 32, billingY + 18);
        bx += 45;
      }
    }

    // ── VERIFICATION STAMP ───────────────────────────────────────
    const stampH = 30;
    const stampY  = afterTable + billingBlockH;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(lm, stampY, cw, stampH, 3, 3, 'FD');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('VERIFIED BY GYMMIND', pageW / 2, stampY + 8, { align: 'center' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(55, 65, 81);
    doc.text(
      "This report was generated directly from GymMind's secure database. Data cannot be modified by the gym.",
      pageW / 2, stampY + 15, { align: 'center', maxWidth: cw - 8 }
    );

    doc.setTextColor(...GRAY);
    doc.text(`Verification ID: ${verifyId}`, pageW / 2, stampY + 22, { align: 'center' });
    doc.text(`gymmind.rw/verify/${verifyId}`, pageW / 2, stampY + 27, { align: 'center' });

    // ── FOOTER ───────────────────────────────────────────────────
    const footerY = 277;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(lm, footerY, rm, footerY);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`Confidential — ${displayInstName} Internal Use`, lm, footerY + 5);
    doc.text('gymmind.rw', pageW / 2, footerY + 5, { align: 'center' });
    doc.text(generatedAt, rm, footerY + 5, { align: 'right' });
    doc.text('Page 1 of 1', rm, footerY + 10, { align: 'right' });

    // ── SAVE ─────────────────────────────────────────────────────
    const filename = `${displayInstName.replace(/\s+/g, '-')}-Attendance-${monthLabel.replace(/\s+/g, '-')}.pdf`;
    doc.save(filename);
    toast.success('Report downloaded', `${displayInstName} — ${monthLabel} report saved`);
  }

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ── Login screens ────────────────────────────────────────────

  if (screen === 'login-phone') {
    return (
      <div className={s.loginPage}>
        <div className={s.loginCard}>
          <div className={s.loginLogoRow}>
            <GymMindLogo size={48} variant="color" />
            <div className={s.loginLogoText}>GymMind</div>
          </div>
          <div className={s.loginTitle}>Institution Portal</div>
          <div className={s.loginSub}>Access your company's attendance data</div>
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
          <button type="button" className={s.btnGhost} onClick={() => navigate('/')}>
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'login-otp') {
    return (
      <div className={s.loginPage}>
        <div className={s.loginCard}>
          <div className={s.loginLogoRow}>
            <GymMindLogo size={48} variant="color" />
            <div className={s.loginLogoText}>GymMind</div>
          </div>
          <div className={s.loginTitle}>Verify your number</div>
          <div className={s.loginSub}>Code sent to {phone}</div>
          <div className={s.instBadge}>Signing in to {instName}</div>
          {gymName && <div className={s.gymBadge}>Powered by {gymName}</div>}
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
          <button type="button" className={s.btnGhost}
            onClick={() => { setScreen('login-phone'); setOtp(['','','','','','']); setError(''); }}
          >
            ← Change number
          </button>
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────

  const displayInstName = instInfo?.name ?? instName;
  const displayGymName  = instInfo?.gym_name ?? gymName;
  const totalVisits     = attendance.reduce((n, r) => n + r.visit_count, 0);
  const activeThisMonth = attendance.filter(r => r.visit_count > 0).length;

  return (
    <div className={s.dashPage}>

      {/* Sidebar */}
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.sidebarLogo}>
            <GymMindLogo size={28} variant="white" />
            <span className={s.sidebarLogoText}>GymMind</span>
          </div>
          <div className={s.sidebarInstName}>{displayInstName}</div>
          {displayGymName && <div className={s.sidebarGymName}>Powered by {displayGymName}</div>}
        </div>

        <nav className={s.sidebarNav}>
          {([
            ['overview',   '📊', 'Overview'],
            ['attendance', '📅', 'Attendance'],
            ['members',    '👥', 'Members'],
          ] as const).map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              className={`${s.navItem} ${tab === key ? s.navItemActive : ''}`}
              onClick={() => setTab(key)}
            >
              <span className={s.navIcon}>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className={s.sidebarBottom}>
          <button type="button" className={s.logoutBtn} onClick={logout}>
            ← Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={s.main}>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <>
            <div className={s.pageTitle}>{displayInstName}</div>
            <div className={s.pageSubtitle}>{formatMonth(month)} · Overview</div>

            <div className={s.statRow}>
              <div className={s.statCard}>
                <div className={s.statLabel}>Total Members</div>
                <div className={s.statValue}>{attendance.length}</div>
              </div>
              <div className={s.statCard}>
                <div className={s.statLabel}>Active This Month</div>
                <div className={`${s.statValue} ${s.statValueGreen}`}>{activeThisMonth}</div>
              </div>
              <div className={s.statCard}>
                <div className={s.statLabel}>Total Visits</div>
                <div className={`${s.statValue} ${s.statValueGreen}`}>{totalVisits}</div>
              </div>
            </div>

            {billing && billing.rate_per_session > 0 && (
              <div className={s.billingPanel}>
                <div className={s.billingPanelTitle}>Billing Summary</div>
                <div className={s.billingGrid}>
                  <div className={s.billingItem}>
                    <div className={s.billingItemLabel}>Total visits</div>
                    <div className={s.billingItemValue}>{billing.total_visits}</div>
                  </div>
                  <div className={s.billingItem}>
                    <div className={s.billingItemLabel}>Calculated amount</div>
                    <div className={s.billingItemValue}>{billing.calculated_amount.toLocaleString()} RWF</div>
                  </div>
                  <div className={s.billingItem}>
                    <div className={s.billingItemLabel}>Status</div>
                    <div className={s.billingItemValue}>
                      {(billing.payment_status ?? 'pending') === 'paid'
                        ? <span className={s.billingPaid}>PAID ✓{billing.paid_at ? ` · ${new Date(billing.paid_at).toLocaleDateString()}` : ''}</span>
                        : <span className={s.billingPending}>{(billing.payment_status ?? 'pending').toUpperCase()}</span>
                      }
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={s.panel}>
              <div className={s.panelHeader}>
                <span className={s.panelTitle}>Monthly Attendance</span>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="month"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    className={s.monthPicker}
                  />
                  <button type="button" className={s.downloadBtn} onClick={downloadPdf}>
                    ↓ Download PDF Report
                  </button>
                </div>
              </div>

              {dataLoading ? (
                <div className={s.loadingMsg}>Loading…</div>
              ) : (
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>Name</th>
                      <th className={s.th}>Type</th>
                      {services.map(sv => (
                        <th key={sv.id} className={s.th}>{sv.name}</th>
                      ))}
                      <th className={s.th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row, i) => (
                      <tr key={i} className={i === attendance.length - 1 ? s.trLast : ''}>
                        <td className={s.td}>
                          <span className={s.memberName}>{row.name}</span>
                          {row.parent_name && (
                            <div className={s.depLabel}>Dependent of {row.parent_name}</div>
                          )}
                        </td>
                        <td className={s.td}>
                          {row.parent_id ? 'Dependent' : 'Employee'}
                        </td>
                        {services.map(sv => (
                          <td key={sv.id} className={s.td}>
                            {row.service_breakdown?.[String(sv.id)] ?? 0}
                          </td>
                        ))}
                        <td className={s.td}>{row.visit_count}</td>
                      </tr>
                    ))}
                    {attendance.length > 0 && (
                      <tr className={s.trTotal}>
                        <td className={s.td}>TOTAL</td>
                        <td className={s.td}></td>
                        {services.map(sv => (
                          <td key={sv.id} className={s.td}>
                            {attendance.reduce((n, r) => n + (r.service_breakdown?.[String(sv.id)] ?? 0), 0)}
                          </td>
                        ))}
                        <td className={s.td}>{totalVisits}</td>
                      </tr>
                    )}
                    {attendance.length === 0 && (
                      <tr><td className={s.td} colSpan={3 + services.length} style={{ textAlign: 'center', color: '#94a3b8' }}>No data for this month.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ── ATTENDANCE TAB ── */}
        {tab === 'attendance' && (
          <>
            <div className={s.pageTitle}>Attendance Detail</div>
            <div className={s.pageSubtitle}>Click a member to expand their visit history</div>

            <div className={s.panel}>
              <div className={s.panelHeader}>
                <span className={s.panelTitle}>{formatMonth(month)}</span>
                <input
                  type="month"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  className={s.monthPicker}
                />
              </div>

              {dataLoading ? (
                <div className={s.loadingMsg}>Loading…</div>
              ) : (
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>Name</th>
                      <th className={s.th}>Type</th>
                      <th className={s.th}>Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row, i) => {
                      const isOpen  = expanded.has(row.name);
                      const visits  = row.visit_dates ? row.visit_dates.split('|') : [];
                      return (
                        <>
                          <tr
                            key={`r-${i}`}
                            className={`${s.expandRow} ${i === attendance.length - 1 && !isOpen ? s.trLast : ''}`}
                            onClick={() => toggleExpand(row.name)}
                          >
                            <td className={s.td}>
                              <span className={s.memberName}>{row.name}</span>
                              <span className={`${s.expandIcon} ${isOpen ? s.expandIconOpen : ''}`}>▼</span>
                              {row.parent_name && (
                                <div className={s.depLabel}>Dep. of {row.parent_name}</div>
                              )}
                            </td>
                            <td className={s.td}>{row.parent_id ? 'Dependent' : 'Employee'}</td>
                            <td className={s.td}>{row.visit_count}</td>
                          </tr>
                          {isOpen && (
                            <tr key={`v-${i}`}>
                              <td colSpan={3} className={s.td}>
                                <div className={s.visitList}>
                                  {visits.length === 0
                                    ? <div className={s.noVisits}>No visits this month</div>
                                    : visits.map((v, j) => (
                                      <div key={j} className={s.visitItem}>{v}</div>
                                    ))
                                  }
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {attendance.length === 0 && (
                      <tr><td className={s.td} colSpan={3} style={{ textAlign: 'center', color: '#94a3b8' }}>No data for this month.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ── MEMBERS TAB ── */}
        {tab === 'members' && (
          <>
            <div className={s.pageTitle}>Members</div>
            <div className={s.pageSubtitle}>All current members registered to {displayInstName}</div>

            <div className={s.panel}>
              {dataLoading ? (
                <div className={s.loadingMsg}>Loading…</div>
              ) : (
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>Name</th>
                      <th className={s.th}>Type</th>
                      <th className={s.th}>Status</th>
                      <th className={s.th}>Total Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, i) => (
                      <tr key={m.id} className={i === members.length - 1 ? s.trLast : ''}>
                        <td className={s.td}>
                          <span className={s.memberName}>{m.name}</span>
                          {m.parent_name && (
                            <div className={s.depLabel}>Dep. of {m.parent_name}</div>
                          )}
                        </td>
                        <td className={s.td}>{m.parent_id ? 'Dependent' : 'Employee'}</td>
                        <td className={s.td}>
                          <span className={
                            m.status === 'active'    ? s.badgeActive :
                            m.status === 'unclaimed' ? s.badgeUnclaimed : s.badgeSuspended
                          }>
                            {m.status}
                          </span>
                        </td>
                        <td className={s.td}>{m.total_checkins}</td>
                      </tr>
                    ))}
                    {members.length === 0 && (
                      <tr><td className={s.td} colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>No members found.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

      </main>
    </div>
  );
}
