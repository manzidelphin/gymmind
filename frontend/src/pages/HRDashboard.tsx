import { useEffect, useState, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { hrApi, publicApi } from '../api/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import s from './HRDashboard.module.css';

// ── Types ─────────────────────────────────────────────────────────
type Tab = 'overview' | 'employees' | 'gyms' | 'attendance' | 'invoices' | 'settings';

interface GymEntry {
  gymId:           number;
  gymName:         string;
  gymSlug:         string;
  institutionId:   number;
  institutionName: string;
  ratePerSession:  number;
  employeeCount:   number;
  thisMonthVisits: number;
  invoiceAmount:   number;
  invoiceStatus:   'pending' | 'paid' | 'overdue' | null;
  invoiceToken:    string | null;
  invoiceId:       number | null;
  month:           string;
}

interface Employee {
  id:            number;
  name:          string;
  phone:         string | null;
  status:        string;
  days_attended: number;
  amount:        number;
  last_checkin:  string | null;
}

interface DetailData {
  gym_name:          string;
  institution:       { id: number; name: string; rate_per_session: number };
  month:             string;
  employees:         Employee[];
  total:             number;
  payment_status:    string | null;
  paid_at:           string | null;
  payment_reference: string | null;
  total_paid:        number | null;
  invoice_id?:       number;
}

interface AttendanceRow {
  user_id:    number;
  name:       string;
  days:       number[];
  total_days: number;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtRwf(n: number) {
  return n.toLocaleString('en-RW') + ' RWF';
}

function fmtMonth(ym: string) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function buildChartData(attendance: AttendanceRow[], month: string) {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => {
    const day = i + 1;
    return { day: String(day), checkins: attendance.filter(e => e.days.includes(day)).length };
  });
}

function exportCsv(employees: Employee[], month: string) {
  const rows = [
    ['Name', 'Phone', 'Days Attended', 'Amount (RWF)', 'Last Check-in', 'Status'],
    ...employees.map(e => [
      e.name, e.phone ?? '', String(e.days_attended), String(e.amount),
      e.last_checkin ? new Date(e.last_checkin).toLocaleString() : '', e.status,
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `attendance-${month}.csv`;
  a.click();
}

// ── Skeleton ──────────────────────────────────────────────────────
function Sk({ h = 16, w = '100%' }: { h?: number; w?: string }) {
  return <div className={s.skeleton} style={{ height: h, width: w }} />;
}

// ── Badges ────────────────────────────────────────────────────────
function InvoiceBadge({ status }: { status: string | null }) {
  if (status === 'paid')    return <span className={`${s.badge} ${s.bPaid}`}>Paid</span>;
  if (status === 'overdue') return <span className={`${s.badge} ${s.bOverdue}`}>Overdue</span>;
  if (status === 'pending') return <span className={`${s.badge} ${s.bPending}`}>Pending</span>;
  return <span className={`${s.badge} ${s.bNone}`}>No Invoice</span>;
}

function EmpBadge({ status }: { status: string }) {
  if (status === 'active')    return <span className={`${s.badge} ${s.bPaid}`}>Active</span>;
  if (status === 'suspended') return <span className={`${s.badge} ${s.bOverdue}`}>Suspended</span>;
  return <span className={`${s.badge} ${s.bNone}`}>{status}</span>;
}

// ── Main component ────────────────────────────────────────────────
export default function HRDashboard() {
  const navigate = useNavigate();

  const [tab,           setTab]           = useState<Tab>('overview');
  const [entries,       setEntries]       = useState<GymEntry[]>([]);
  const [detail,        setDetail]        = useState<DetailData | null>(null);
  const [attendance,    setAttendance]    = useState<AttendanceRow[]>([]);
  const [attMonth,      setAttMonth]      = useState('');
  const [loadingDash,   setLoadingDash]   = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingAtt,    setLoadingAtt]    = useState(false);
  const [dashError,     setDashError]     = useState('');
  const [search,        setSearch]        = useState('');

  // MoMo modal
  const [momoEntry,   setMomoEntry]   = useState<GymEntry | null>(null);
  const [momoName,    setMomoName]    = useState('');
  const [momoPhone,   setMomoPhone]   = useState('');
  const [momoLoading, setMomoLoading] = useState(false);
  const [momoResult,  setMomoResult]  = useState<string | null>(null);
  const [momoError,   setMomoError]   = useState('');

  // Add employee modal
  const [addOpen,    setAddOpen]    = useState(false);
  const [addName,    setAddName]    = useState('');
  const [addPhone,   setAddPhone]   = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState('');

  // ── Init ─────────────────────────────────────────────────────
  useEffect(() => {
    loadDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load detail + attendance on first non-empty entries ──────
  useEffect(() => {
    const e = entries[0];
    if (!e) return;
    if (!detail)           loadDetail(e);
    if (!attendance.length && e.invoiceToken) loadAttendance(e.invoiceToken, e.month);
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data fetchers ─────────────────────────────────────────────
  async function loadDashboard() {
    setLoadingDash(true); setDashError('');
    try {
      const { data } = await hrApi.get<GymEntry[]>('/hr/dashboard');
      setEntries(data);
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem('hr_token');
        navigate('/hr/login');
      } else {
        setDashError('Failed to load dashboard. Please refresh.');
      }
    } finally { setLoadingDash(false); }
  }

  async function loadDetail(e: GymEntry) {
    const token = e.invoiceToken ?? e.gymSlug;
    setLoadingDetail(true);
    try {
      const { data } = await hrApi.get<DetailData>(`/hr/${token}`);
      setDetail(data);
    } catch { /* optional */ }
    finally { setLoadingDetail(false); }
  }

  async function loadAttendance(token: string, month: string) {
    setLoadingAtt(true);
    try {
      const { data } = await hrApi.get<{ month: string; attendance: AttendanceRow[] }>(
        `/hr/${token}/attendance?month=${month}`,
      );
      setAttendance(data.attendance);
      setAttMonth(data.month);
    } catch { /* optional */ }
    finally { setLoadingAtt(false); }
  }

  // ── Actions ───────────────────────────────────────────────────
  function logout() { localStorage.removeItem('hr_token'); navigate('/hr/login'); }

  function openMomo(e: GymEntry) {
    setMomoEntry(e); setMomoName(''); setMomoPhone('');
    setMomoResult(null); setMomoError('');
  }

  async function submitPay() {
    if (!momoEntry?.invoiceToken || !momoName.trim() || !momoPhone.trim()) return;
    setMomoLoading(true); setMomoError('');
    try {
      const { data } = await publicApi.post<{ message: string; reference: string }>(
        `/hr/${momoEntry.invoiceToken}/pay`,
        { hrName: momoName.trim(), momoPhone: momoPhone.trim() },
      );
      setMomoResult(`${data.message}  ·  Ref: ${data.reference}`);
      loadDashboard();
    } catch (e: any) {
      setMomoError(e.response?.data?.error ?? 'Payment failed. Try again.');
    } finally { setMomoLoading(false); }
  }

  async function addEmployee() {
    const e = entries[0];
    const token = e?.invoiceToken ?? e?.gymSlug;
    if (!token || !addName.trim()) return;
    setAddLoading(true); setAddError('');
    try {
      await hrApi.post(`/hr/${token}/employees`, { name: addName.trim(), phone: addPhone.trim() || undefined });
      setAddOpen(false); setAddName(''); setAddPhone('');
      if (e) loadDetail(e);
    } catch (err: any) {
      setAddError(err.response?.data?.error ?? 'Failed to add employee.');
    } finally { setAddLoading(false); }
  }

  async function removeEmployee(userId: number) {
    const e = entries[0];
    const token = e?.invoiceToken ?? e?.gymSlug;
    if (!token || !confirm('Remove this employee from the programme?')) return;
    try {
      await hrApi.delete(`/hr/${token}/employees/${userId}`);
      if (e) loadDetail(e);
    } catch { /* ignore */ }
  }

  // ── Derived data ──────────────────────────────────────────────
  const totalEmployees  = entries.reduce((s, e) => s + e.employeeCount, 0);
  const totalVisits     = entries.reduce((s, e) => s + e.thisMonthVisits, 0);
  const totalInvoice    = entries.reduce((s, e) => s + e.invoiceAmount, 0);
  const activeThisMonth = detail?.employees.filter(e => e.days_attended > 0).length ?? 0;
  const complianceRate  = totalEmployees > 0 ? Math.round((activeThisMonth / totalEmployees) * 100) : 0;
  const month           = entries[0]?.month ?? '';

  const chartData = useMemo(
    () => attendance.length && attMonth ? buildChartData(attendance, attMonth) : [],
    [attendance, attMonth],
  );
  const topEmployees = useMemo(
    () => [...(detail?.employees ?? [])].sort((a, b) => b.days_attended - a.days_attended).slice(0, 5),
    [detail],
  );
  const recentCheckins = useMemo(
    () => [...(detail?.employees ?? [])]
      .filter(e => e.last_checkin)
      .sort((a, b) => new Date(b.last_checkin!).getTime() - new Date(a.last_checkin!).getTime())
      .slice(0, 8),
    [detail],
  );
  const filteredEmployees = useMemo(
    () => (detail?.employees ?? []).filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.phone ?? '').includes(search),
    ),
    [detail, search],
  );

  const entry = entries[0] ?? null;

  // ── Sidebar nav ───────────────────────────────────────────────
  const navItems: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview',   icon: '📊', label: 'Overview' },
    { id: 'employees',  icon: '👥', label: 'Employees' },
    { id: 'gyms',       icon: '🏋️', label: 'Gyms' },
    { id: 'attendance', icon: '📅', label: 'Attendance' },
    { id: 'invoices',   icon: '📄', label: 'Invoices' },
    { id: 'settings',   icon: '⚙️', label: 'Settings' },
  ];

  // ── Auth guard — redirect immediately, never show loading for unauthenticated users ──
  if (!localStorage.getItem('hr_token')) {
    return <Navigate to="/hr/login" replace />;
  }

  // ── Loading / error screens ───────────────────────────────────
  if (loadingDash) {
    return (
      <div className={s.splash}>
        <div className={s.splashSpinner} />
        <p>Loading your dashboard…</p>
      </div>
    );
  }
  if (dashError) {
    return (
      <div className={s.splash}>
        <div className={s.splashError}>{dashError}</div>
        <button className={s.btnPrimary} onClick={loadDashboard}>Retry</button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={s.root}>

      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sideTop}>
          <div className={s.sideBrand}>
            <div className={s.sideMark}>G</div>
            <span className={s.sideBrandName}>GymMind</span>
          </div>

          {entry && (
            <div className={s.instBox}>
              <div className={s.instAvatar}>{entry.institutionName.slice(0, 2).toUpperCase()}</div>
              <div>
                <div className={s.instName}>{entry.institutionName}</div>
                <div className={s.instSub}>HR Portal</div>
              </div>
            </div>
          )}

          <nav className={s.nav}>
            {navItems.map(({ id, icon, label }) => (
              <button
                key={id}
                className={`${s.navItem} ${tab === id ? s.navActive : ''}`}
                onClick={() => setTab(id)}
              >
                <span className={s.navIcon}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className={s.sideBottom}>
          <button className={s.logoutBtn} onClick={logout}>
            <span>↩</span> Sign Out
          </button>
          <div className={s.poweredBy}>Powered by GymMind</div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className={s.main}>
        <header className={s.pageHeader}>
          <div>
            <h1 className={s.pageTitle}>
              {{ overview: 'Overview', employees: 'Employees', gyms: 'Partner Gyms',
                 attendance: 'Attendance', invoices: 'Invoices', settings: 'Settings' }[tab]}
            </h1>
            {month && <div className={s.pageMonth}>{fmtMonth(month)}</div>}
          </div>
        </header>

        <div className={s.content}>

          {/* ══ OVERVIEW ══ */}
          {tab === 'overview' && (
            <>
              <div className={s.statGrid}>
                <StatCard
                  label="Total Enrolled"
                  value={String(totalEmployees)}
                  sub={`${activeThisMonth} active this month`}
                />
                <StatCard
                  label="Check-ins This Month"
                  value={String(totalVisits)}
                  sub="across all locations"
                />
                <StatCard
                  label="Compliance Rate"
                  value={`${complianceRate}%`}
                  sub="attended ≥1 session"
                  accent
                />
                <StatCard
                  label="Current Invoice"
                  value={fmtRwf(totalInvoice)}
                  sub={entry ? <InvoiceBadge status={entry.invoiceStatus} /> : 'not generated'}
                />
              </div>

              <div className={s.twoCol}>
                <div className={s.panel}>
                  <div className={s.panelHead}><h3>Attendance This Month</h3></div>
                  {loadingAtt ? <Sk h={220} /> : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }} tickLine={false} axisLine={false} interval={4} />
                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: '#0F172A', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13 }}
                          labelFormatter={d => `Day ${d}`}
                          formatter={(v: number) => [v, 'check-ins']}
                        />
                        <Bar dataKey="checkins" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <Empty icon="📊" title="No chart data yet" sub="Check-ins will appear as employees start attending." />}
                </div>

                <div className={s.panel}>
                  <div className={s.panelHead}><h3>Top Active Employees</h3></div>
                  {loadingDetail ? <div className={s.skStack}>{[...Array(5)].map((_, i) => <Sk key={i} h={40} />)}</div>
                    : topEmployees.length > 0 ? (
                      <table className={s.table}>
                        <thead><tr><th>#</th><th>Name</th><th>Check-ins</th><th>Last seen</th></tr></thead>
                        <tbody>
                          {topEmployees.map((emp, i) => (
                            <tr key={emp.id}>
                              <td><span className={s.rank}>{i + 1}</span></td>
                              <td className={s.tdName}>{emp.name}</td>
                              <td><span className={s.cnt}>{emp.days_attended}</span></td>
                              <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <Empty icon="👥" title="No data yet" sub="Employee rankings will appear here." />}
                </div>
              </div>

              <div className={s.panel}>
                <div className={s.panelHead}><h3>Recent Check-ins</h3></div>
                {loadingDetail ? <div className={s.skStack}>{[...Array(4)].map((_, i) => <Sk key={i} h={44} />)}</div>
                  : recentCheckins.length > 0 ? (
                    <table className={s.table}>
                      <thead><tr><th>Employee</th><th>Gym</th><th>Last check-in</th><th>Verified</th></tr></thead>
                      <tbody>
                        {recentCheckins.map(emp => (
                          <tr key={emp.id}>
                            <td className={s.tdName}>{emp.name}</td>
                            <td className={s.tdMuted}>{entry?.gymName ?? '—'}</td>
                            <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                            <td><span className={s.verifiedBadge}>✓ OTP</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <Empty icon="📋" title="No check-ins yet this month" sub="Employee activity will appear here once they start visiting." />}
              </div>
            </>
          )}

          {/* ══ EMPLOYEES ══ */}
          {tab === 'employees' && (
            <>
              <div className={s.toolbar}>
                <input
                  className={s.searchInput}
                  type="search"
                  placeholder="Search by name or phone…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className={s.toolbarRight}>
                  <button className={s.btnSecondary} onClick={() => detail && exportCsv(detail.employees, month)}>
                    ↓ Export CSV
                  </button>
                  <button className={s.btnPrimary} onClick={() => setAddOpen(true)}>
                    + Add Employee
                  </button>
                </div>
              </div>
              <div className={s.panel}>
                {loadingDetail
                  ? <div className={s.skStack}>{[...Array(6)].map((_, i) => <Sk key={i} h={48} />)}</div>
                  : filteredEmployees.length > 0
                    ? (
                      <table className={s.table}>
                        <thead><tr><th>Name</th><th>Phone</th><th>Check-ins</th><th>Amount</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                          {filteredEmployees.map(emp => (
                            <tr key={emp.id}>
                              <td className={s.tdName}>{emp.name}</td>
                              <td className={s.tdMuted}>{emp.phone ?? '—'}</td>
                              <td><span className={s.cnt}>{emp.days_attended}</span></td>
                              <td>{fmtRwf(emp.amount)}</td>
                              <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                              <td><EmpBadge status={emp.status} /></td>
                              <td>
                                <button className={s.btnDanger} onClick={() => removeEmployee(emp.id)} title="Remove">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                    : <Empty icon="👥" title={search ? 'No matching employees' : 'No employees enrolled yet'} sub={search ? 'Try a different search term.' : 'Click "+ Add Employee" to get started.'} />
                }
              </div>
            </>
          )}

          {/* ══ GYMS ══ */}
          {tab === 'gyms' && (
            <>
              {entries.length === 0
                ? <Empty icon="🏋️" title="No gym partnerships" sub="Contact GymMind to set up gym access for your employees." />
                : (
                  <div className={s.gymGrid}>
                    {entries.map(e => (
                      <div key={`${e.gymId}-${e.institutionId}`} className={s.gymCard}>
                        <div className={s.gymCardTop}>
                          <div className={s.gymAvatar}>{e.gymName.slice(0, 2).toUpperCase()}</div>
                          <div className={s.gymInfo}>
                            <div className={s.gymName}>{e.gymName}</div>
                            <div className={s.gymSub}>{e.institutionName}</div>
                          </div>
                          <InvoiceBadge status={e.invoiceStatus} />
                        </div>
                        <div className={s.gymStats}>
                          <div className={s.gymStat}><span className={s.gymStatN}>{e.employeeCount}</span><span className={s.gymStatL}>employees</span></div>
                          <div className={s.gymStatDiv} />
                          <div className={s.gymStat}><span className={s.gymStatN}>{e.thisMonthVisits}</span><span className={s.gymStatL}>visits</span></div>
                          <div className={s.gymStatDiv} />
                          <div className={s.gymStat}><span className={s.gymStatN}>{fmtRwf(e.ratePerSession)}</span><span className={s.gymStatL}>per visit</span></div>
                        </div>
                        <div className={s.gymCardFoot}>
                          {e.invoiceToken && <a href={`/hr/${e.invoiceToken}`} className={s.btnSecondary}>View Invoice</a>}
                          {e.invoiceStatus !== 'paid' && e.invoiceToken && (
                            <button className={s.btnPrimary} onClick={() => openMomo(e)}>Pay Now</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
              <div className={s.partnerCta}>
                <span>Want to add another gym location?</span>
                <a href="mailto:hello@gymmind.app" className={s.btnSecondary}>Request Partnership →</a>
              </div>
            </>
          )}

          {/* ══ ATTENDANCE ══ */}
          {tab === 'attendance' && (
            <>
              <div className={s.toolbar}>
                {attMonth && <span className={s.monthTag}>{fmtMonth(attMonth)}</span>}
                <button className={s.btnSecondary} onClick={() => detail && exportCsv(detail.employees, month)}>
                  ↓ Export CSV
                </button>
              </div>
              <div className={s.panel}>
                {loadingAtt
                  ? <div className={s.skStack}>{[...Array(8)].map((_, i) => <Sk key={i} h={44} />)}</div>
                  : attendance.length > 0
                    ? (
                      <table className={s.table}>
                        <thead><tr><th>Employee</th><th>Days attended</th><th>Days of month visited</th><th>Verified</th></tr></thead>
                        <tbody>
                          {attendance.map(row => (
                            <tr key={row.user_id}>
                              <td className={s.tdName}>{row.name}</td>
                              <td><span className={s.cnt}>{row.total_days}</span></td>
                              <td>
                                <div className={s.dayDots}>
                                  {row.days.map(d => <span key={d} className={s.dayDot} title={`Day ${d}`}>{d}</span>)}
                                  {row.days.length === 0 && <span className={s.tdMuted}>No visits</span>}
                                </div>
                              </td>
                              <td><span className={s.verifiedBadge}>✓ OTP</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                    : <Empty icon="📅" title="No attendance records" sub="Records appear once employees start checking in." />
                }
              </div>
            </>
          )}

          {/* ══ INVOICES ══ */}
          {tab === 'invoices' && (
            <>
              <div className={s.invoiceSummary}>
                <div>
                  <div className={s.invoiceSumLabel}>Current Month Estimate</div>
                  <div className={s.invoiceSumAmount}>{fmtRwf(totalInvoice)}</div>
                  <div className={s.invoiceSumSub}>
                    Based on {totalVisits} check-ins at {fmtRwf(entry?.ratePerSession ?? 0)} per visit
                  </div>
                </div>
                {entry?.invoiceToken && (
                  <a
                    href={`/api/hr/${entry.invoiceToken}/invoice.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className={s.btnPrimary}
                  >
                    ↓ Download PDF
                  </a>
                )}
              </div>

              <div className={s.panel}>
                <div className={s.panelHead}><h3>Invoice History</h3></div>
                {entries.length > 0
                  ? (
                    <table className={s.table}>
                      <thead><tr><th>Period</th><th>Institution</th><th>Gym</th><th>Check-ins</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
                      <tbody>
                        {entries.map(e => (
                          <tr key={`${e.gymId}-${e.institutionId}`}>
                            <td>{e.month ? fmtMonth(e.month) : '—'}</td>
                            <td className={s.tdName}>{e.institutionName}</td>
                            <td>{e.gymName}</td>
                            <td><span className={s.cnt}>{e.thisMonthVisits}</span></td>
                            <td className={s.tdAmount}>{fmtRwf(e.invoiceAmount)}</td>
                            <td><InvoiceBadge status={e.invoiceStatus} /></td>
                            <td>
                              <div className={s.invActions}>
                                {e.invoiceToken && (
                                  <a href={`/api/hr/${e.invoiceToken}/invoice.pdf`} target="_blank" rel="noreferrer" className={s.btnSecondary}>↓ PDF</a>
                                )}
                                {e.invoiceStatus !== 'paid' && e.invoiceToken && (
                                  <button className={s.btnPrimary} onClick={() => openMomo(e)}>Pay</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  : <Empty icon="📄" title="No invoices yet" sub="Invoices are generated automatically each month." />
                }
              </div>
            </>
          )}

          {/* ══ SETTINGS ══ */}
          {tab === 'settings' && entry && (
            <div className={s.settingsGrid}>
              <div className={s.panel}>
                <div className={s.panelHead}><h3>Company Profile</h3></div>
                <SettingsRow label="Company Name"   value={entry.institutionName} />
                <SettingsRow label="Partner Gym"    value={entry.gymName} />
                <SettingsRow label="Rate Per Visit" value={fmtRwf(entry.ratePerSession)} />
                <div className={s.settingsNote}>
                  To update company details, contact{' '}
                  <a href="mailto:hello@gymmind.app">hello@gymmind.app</a>
                </div>
              </div>
              <div className={s.panel}>
                <div className={s.panelHead}><h3>Billing Summary</h3></div>
                <SettingsRow label="Current Period"   value={fmtMonth(month)} />
                <SettingsRow label="Invoice Status"   value={<InvoiceBadge status={entry.invoiceStatus} />} />
                <SettingsRow label="Total Employees"  value={`${entry.employeeCount} enrolled`} />
                <SettingsRow label="Total This Month" value={fmtRwf(entry.invoiceAmount)} />
                <div className={s.settingsNote}>
                  For billing queries, email{' '}
                  <a href="mailto:billing@gymmind.app">billing@gymmind.app</a>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ══ MOMO MODAL ══ */}
      {momoEntry && (
        <div className={s.overlay} onClick={() => !momoLoading && setMomoEntry(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h2>Pay via MTN MoMo</h2>
              <button className={s.modalClose} onClick={() => setMomoEntry(null)} disabled={momoLoading}>✕</button>
            </div>
            <div className={s.modalBody}>
              <div className={s.modalInvoice}>
                <span>{momoEntry.gymName} · {momoEntry.institutionName}</span>
                <span className={s.modalAmt}>{fmtRwf(momoEntry.invoiceAmount)}</span>
              </div>
              {momoResult
                ? <div className={s.momoSuccess}>{momoResult}</div>
                : (
                  <>
                    <label className={s.lbl}>Your Name</label>
                    <input className={s.inp} placeholder="Full name" value={momoName} onChange={e => setMomoName(e.target.value)} />
                    <label className={s.lbl}>MoMo Phone</label>
                    <input className={s.inp} type="tel" placeholder="07XX XXX XXX" value={momoPhone} onChange={e => setMomoPhone(e.target.value)} />
                    {momoError && <div className={s.inlineError}>{momoError}</div>}
                    <div className={s.modalFoot}>
                      <button className={s.btnSecondary} onClick={() => setMomoEntry(null)} disabled={momoLoading}>Cancel</button>
                      <button className={s.btnPrimary} onClick={submitPay} disabled={momoLoading || !momoName.trim() || !momoPhone.trim()}>
                        {momoLoading ? 'Processing…' : 'Pay Now'}
                      </button>
                    </div>
                  </>
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD EMPLOYEE MODAL ══ */}
      {addOpen && (
        <div className={s.overlay} onClick={() => !addLoading && setAddOpen(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h2>Add Employee</h2>
              <button className={s.modalClose} onClick={() => setAddOpen(false)} disabled={addLoading}>✕</button>
            </div>
            <div className={s.modalBody}>
              <label className={s.lbl}>Full Name</label>
              <input className={s.inp} placeholder="e.g. Jean-Paul Habimana" value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
              <label className={s.lbl}>Phone (optional)</label>
              <input className={s.inp} type="tel" placeholder="07XX XXX XXX" value={addPhone} onChange={e => setAddPhone(e.target.value)} />
              {addError && <div className={s.inlineError}>{addError}</div>}
              <div className={s.modalFoot}>
                <button className={s.btnSecondary} onClick={() => setAddOpen(false)} disabled={addLoading}>Cancel</button>
                <button className={s.btnPrimary} onClick={addEmployee} disabled={addLoading || !addName.trim()}>
                  {addLoading ? 'Adding…' : 'Add Employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`${s.statCard} ${accent ? s.statCardAccent : ''}`}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
      <div className={s.statSub}>{sub}</div>
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={s.settingsRow}>
      <div className={s.settingsLabel}>{label}</div>
      <div className={s.settingsValue}>{value}</div>
    </div>
  );
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <div className={s.emptyTitle}>{title}</div>
      <div className={s.emptySub}>{sub}</div>
    </div>
  );
}
