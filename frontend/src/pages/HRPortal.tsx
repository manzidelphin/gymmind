import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi } from '../api/api';
import s from './HRPortal.module.css';

// ─── Types ────────────────────────────────────────────────────────
interface Employee {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  days_attended: number;
  amount: number;
  last_checkin: string | null;
}

interface PortalData {
  gym_name: string;
  institution: { id: number; name: string; rate_per_session: number };
  month: string;
  employees: Employee[];
  total: number;
  payment_status: 'paid' | 'pending' | 'overdue' | null;
  paid_at: string | null;
  payment_reference: string | null;
  total_paid: number | null;
  invoice_id?: number;
}

interface AttendanceRecord {
  user_id: number;
  name: string;
  days: number[];
  total_days: number;
}

type Tab = 'invoice' | 'employees' | 'attendance';

// ─── Helpers ──────────────────────────────────────────────────────
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dueDate(invoiceMonth: string): { label: string; overdue: boolean } {
  const [y, m] = invoiceMonth.split('-').map(Number);
  const due = new Date(y, m, 5); // 5th of next month
  const overdue = new Date() > due;
  return { label: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), overdue };
}

function parseCsv(text: string): { name: string; phone: string }[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
  return lines.slice(start).map(line => {
    const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
    return { name: parts[0] || '', phone: parts[1] || '' };
  }).filter(e => e.name);
}

// ─── Main Component ───────────────────────────────────────────────
export default function HRPortal() {
  const { token } = useParams<{ token: string }>();

  const [data,       setData]       = useState<PortalData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [tab,        setTab]        = useState<Tab>('invoice');

  // Attendance tab
  const [attMonth,   setAttMonth]   = useState('');
  const [attData,    setAttData]    = useState<AttendanceRecord[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  // Add employee modal
  const [addOpen,    setAddOpen]    = useState(false);
  const [addName,    setAddName]    = useState('');
  const [addPhone,   setAddPhone]   = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState('');

  // Bulk upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult,  setBulkResult]  = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  // MoMo modal
  const [momoOpen,    setMomoOpen]    = useState(false);
  const [momoName,    setMomoName]    = useState('');
  const [momoPhone,   setMomoPhone]   = useState('');
  const [momoLoading, setMomoLoading] = useState(false);
  const [momoResult,  setMomoResult]  = useState<string | null>(null);
  const [momoError,   setMomoError]   = useState('');

  // Remove employee
  const [removing, setRemoving] = useState<number | null>(null);

  // ─── Load portal data ────────────────────────────────────────
  async function load() {
    setLoading(true); setError('');
    try {
      const { data: resp } = await publicApi.get<PortalData>(`/hr/${token}`);
      setData(resp);
      setAttMonth(resp.month);
    } catch {
      setError('Portal not found or link has expired.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load attendance ─────────────────────────────────────────
  async function loadAttendance(month: string) {
    setAttLoading(true);
    try {
      const { data: resp } = await publicApi.get<{ month: string; attendance: AttendanceRecord[] }>(
        `/hr/${token}/attendance?month=${month}`,
      );
      setAttData(resp.attendance);
    } finally {
      setAttLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'attendance' && attMonth) loadAttendance(attMonth);
  }, [tab, attMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Add employee ────────────────────────────────────────────
  async function submitAddEmployee() {
    if (!addName.trim()) return;
    setAddLoading(true); setAddError('');
    try {
      await publicApi.post(`/hr/${token}/employees`, { name: addName.trim(), phone: addPhone.trim() || undefined });
      setAddOpen(false); setAddName(''); setAddPhone('');
      load();
    } catch (e: any) {
      setAddError(e.response?.data?.error ?? 'Failed to add employee.');
    } finally { setAddLoading(false); }
  }

  // ─── Bulk CSV upload ─────────────────────────────────────────
  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkLoading(true); setBulkResult(null);
    const text = await file.text();
    const employees = parseCsv(text);
    if (!employees.length) { setBulkLoading(false); return; }
    try {
      const { data: res } = await publicApi.post<{ created: number; skipped: number; errors: string[] }>(
        `/hr/${token}/employees/bulk`, { employees },
      );
      setBulkResult(res);
      load();
    } finally {
      setBulkLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ─── Remove employee ─────────────────────────────────────────
  async function removeEmployee(id: number) {
    if (!window.confirm('Remove this employee from the portal?')) return;
    setRemoving(id);
    try {
      await publicApi.delete(`/hr/${token}/employees/${id}`);
      load();
    } finally { setRemoving(null); }
  }

  // ─── MoMo pay ────────────────────────────────────────────────
  async function submitPay() {
    if (!momoName.trim() || !momoPhone.trim()) return;
    setMomoLoading(true); setMomoError('');
    try {
      const { data: res } = await publicApi.post<{ message: string; reference: string }>(
        `/hr/${token}/pay`, { hrName: momoName.trim(), momoPhone: momoPhone.trim() },
      );
      setMomoResult(res.message + ` Ref: ${res.reference}`);
    } catch (e: any) {
      setMomoError(e.response?.data?.error ?? 'Payment failed. Try again.');
    } finally { setMomoLoading(false); }
  }

  // ─── Download PDF ────────────────────────────────────────────
  function downloadPdf() {
    if (!token) return;
    window.open(`${import.meta.env.VITE_API_BASE_URL}/hr/${token}/invoice.pdf`, '_blank');
  }

  // ─── Render states ────────────────────────────────────────────
  if (loading) {
    return (
      <div className={s.root}>
        <nav className={s.navbar}><span className={s.navLogo}>GymMind</span></nav>
        <div className={s.splash}>Loading portal…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={s.root}>
        <nav className={s.navbar}><span className={s.navLogo}>GymMind</span></nav>
        <div className={s.splash}><div className={s.splashError}>{error || 'Portal not found.'}</div></div>
      </div>
    );
  }

  const isPaid    = data.payment_status === 'paid';
  const isOverdue = data.payment_status === 'overdue';
  const present   = data.employees.filter(e => e.days_attended > 0).length;
  const total     = data.employees.length;
  const pct       = total > 0 ? Math.round((present / total) * 100) : 0;
  const due       = dueDate(data.month);

  return (
    <div className={s.root}>

      {/* ── Navbar ── */}
      <nav className={s.navbar}>
        <div className={s.navLeft}>
          <span className={s.navLogo}>GymMind</span>
          <span className={s.navGymName}>{data.gym_name}</span>
        </div>
        <div className={s.navCenter}>Employee Wellness Portal</div>
        <div className={s.navRight}>
          <span className={s.navInstBadge}>{data.institution.name}</span>
          {localStorage.getItem('hr_token') && (
            <Link to="/hr/dashboard" className={s.navBackBtn}>← Dashboard</Link>
          )}
          <span className={s.navPowered}>Powered by GymMind</span>
        </div>
      </nav>

      {/* ── Hero summary ── */}
      <div className={s.hero}>
        <div className={s.heroGrid}>
          <div className={s.statCard}>
            <div className={s.statNum}>{total}</div>
            <div className={s.statLabel}>Total Employees</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statNum}>{present}<span className={s.statPct}> ({pct}%)</span></div>
            <div className={s.statLabel}>Present This Month</div>
          </div>
          <div className={`${s.statCard} ${s.statGreen}`}>
            <div className={`${s.statNum} ${s.statGreenNum}`}>{data.total.toLocaleString()} RWF</div>
            <div className={s.statLabel}>Invoice Amount</div>
          </div>
          <div className={`${s.statCard} ${due.overdue && !isPaid ? s.statRed : ''}`}>
            <div className={`${s.statNum} ${due.overdue && !isPaid ? s.statRedNum : ''}`}>{due.label}</div>
            <div className={s.statLabel}>Due Date</div>
          </div>
        </div>
        <div className={s.heroBadge}>
          {isPaid    && <span className={`${s.badge} ${s.badgePaid}`}>✓ PAID</span>}
          {isOverdue && <span className={`${s.badge} ${s.badgeOverdue}`}>OVERDUE</span>}
          {!isPaid && !isOverdue && <span className={`${s.badge} ${s.badgePending}`}>PENDING</span>}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={s.tabBar}>
        <button type="button" className={tab === 'invoice'    ? s.tabActive : s.tab} onClick={() => setTab('invoice')}>Invoice &amp; Payment</button>
        <button type="button" className={tab === 'employees'  ? s.tabActive : s.tab} onClick={() => setTab('employees')}>Employees ({total})</button>
        <button type="button" className={tab === 'attendance' ? s.tabActive : s.tab} onClick={() => setTab('attendance')}>Attendance</button>
      </div>

      {/* ── Tab content ── */}
      <div className={s.content}>

        {/* ──── Invoice & Payment tab ──── */}
        {tab === 'invoice' && (
          <div className={s.panel}>
            {isPaid && (
              <div className={s.paidBanner}>
                ✅ Payment confirmed on {new Date(data.paid_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                {data.payment_reference && ` Reference: ${data.payment_reference}`}
                &nbsp;Thank you!
              </div>
            )}

            <div className={s.invoiceHeader}>
              <div>
                <div className={s.invoiceTitle}>Invoice — {fmtMonth(data.month)}</div>
                <div className={s.invoiceSub}>Rate per session: {data.institution.rate_per_session.toLocaleString()} RWF</div>
              </div>
              <button type="button" className={s.downloadBtn} onClick={downloadPdf}>↓ Download PDF</button>
            </div>

            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Employee</th>
                  <th className={s.th}>Days Attended</th>
                  <th className={s.th}>Attendance</th>
                  <th className={`${s.th} ${s.thRight}`}>Amount Due (RWF)</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.length === 0 ? (
                  <tr><td className={s.td} colSpan={4}>No employees found.</td></tr>
                ) : data.employees.map(emp => {
                  const maxDays = daysInMonth(data.month);
                  const pctBar  = Math.min(100, (emp.days_attended / maxDays) * 100);
                  return (
                    <tr key={emp.id} className={s.tr}>
                      <td className={s.td}>
                        <div className={s.empName}>{emp.name}</div>
                        {emp.phone && <div className={s.empPhone}>{emp.phone}</div>}
                      </td>
                      <td className={s.td}><strong>{emp.days_attended}</strong> / {maxDays}</td>
                      <td className={s.td}>
                        <div className={s.barTrack}>
                          <div className={s.barFill} style={{ width: `${pctBar}%` }} />
                        </div>
                      </td>
                      <td className={`${s.td} ${s.tdRight}`}>
                        {emp.amount > 0 ? emp.amount.toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className={s.totalRow}>
                  <td className={s.tdBold} colSpan={3}>TOTAL</td>
                  <td className={`${s.tdBold} ${s.tdRight}`}>{data.total.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>

            {!isPaid && (
              <div className={s.paySection}>
                <button type="button" className={s.momoBtn} onClick={() => { setMomoOpen(true); setMomoResult(null); setMomoError(''); }}>
                  <span className={s.momoIcon}>📱</span>
                  Pay via MTN MoMo — {data.total.toLocaleString()} RWF
                </button>
              </div>
            )}
          </div>
        )}

        {/* ──── Employees tab ──── */}
        {tab === 'employees' && (
          <div className={s.panel}>
            <div className={s.empToolbar}>
              <div className={s.empToolbarTitle}>All Employees</div>
              <div className={s.empActions}>
                <label className={s.csvBtn}>
                  {bulkLoading ? 'Uploading…' : '↑ Upload CSV'}
                  <input ref={fileRef} type="file" accept=".csv,.txt" className={s.hiddenInput} onChange={handleCsvFile} />
                </label>
                <button type="button" className={s.addBtn} onClick={() => { setAddOpen(true); setAddError(''); }}>
                  + Add Employee
                </button>
              </div>
            </div>

            {bulkResult && (
              <div className={s.bulkResult}>
                ✓ {bulkResult.created} added, {bulkResult.skipped} skipped
                {bulkResult.errors.length > 0 && (
                  <ul className={s.bulkErrors}>{bulkResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
                )}
              </div>
            )}

            <div className={s.csvHint}>CSV format: Name, Phone (one per line, first line = header)</div>

            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Name</th>
                  <th className={s.th}>Phone</th>
                  <th className={s.th}>Status</th>
                  <th className={s.th}>Last Check-in</th>
                  <th className={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {data.employees.length === 0 ? (
                  <tr><td className={s.td} colSpan={5}>No employees yet. Add one above.</td></tr>
                ) : data.employees.map(emp => (
                  <tr key={emp.id} className={s.tr}>
                    <td className={s.td}><div className={s.empName}>{emp.name}</div></td>
                    <td className={s.td}>{emp.phone ?? <span className={s.muted}>—</span>}</td>
                    <td className={s.td}>
                      <span className={emp.status === 'active' ? s.statusActive : s.statusUnclaimed}>
                        {emp.status === 'active' ? 'Active' : 'Unclaimed'}
                      </span>
                    </td>
                    <td className={s.td}>
                      {emp.last_checkin
                        ? new Date(emp.last_checkin).toLocaleDateString('en-GB')
                        : <span className={s.muted}>Never</span>}
                    </td>
                    <td className={s.td}>
                      <button
                        type="button"
                        className={s.removeBtn}
                        disabled={removing === emp.id}
                        onClick={() => removeEmployee(emp.id)}
                      >
                        {removing === emp.id ? '…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ──── Attendance tab ──── */}
        {tab === 'attendance' && (
          <div className={s.panel}>
            <div className={s.attHeader}>
              <div className={s.empToolbarTitle}>Monthly Attendance</div>
              <div className={s.monthNav}>
                <button type="button" className={s.monthBtn} onClick={() => setAttMonth(m => shiftMonth(m, -1))}>‹</button>
                <span className={s.monthLabel}>{fmtMonth(attMonth)}</span>
                <button type="button" className={s.monthBtn} onClick={() => setAttMonth(m => shiftMonth(m, 1))}>›</button>
              </div>
            </div>

            {attLoading ? (
              <div className={s.attLoading}>Loading attendance…</div>
            ) : (
              <div className={s.attGrid}>
                {/* Day headers */}
                <div className={s.attNameCol} />
                {Array.from({ length: daysInMonth(attMonth) }, (_, i) => (
                  <div key={i} className={s.attDayHead}>{i + 1}</div>
                ))}
                <div className={s.attSumHead}>Days</div>

                {/* Employee rows */}
                {attData.length === 0 ? (
                  <div className={s.attEmpty}>No attendance data for this month.</div>
                ) : attData.map(emp => {
                  const todayDay = new Date().getDate();
                  const todayMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
                  const isCurrentMonth = attMonth === todayMonth;
                  return (
                    <>
                      <div key={`n-${emp.user_id}`} className={s.attNameCol}>{emp.name}</div>
                      {Array.from({ length: daysInMonth(attMonth) }, (_, i) => {
                        const day = i + 1;
                        const attended = emp.days.includes(day);
                        const isToday  = isCurrentMonth && day === todayDay;
                        return (
                          <div
                            key={day}
                            className={`${s.attCell} ${attended ? s.attPresent : s.attAbsent} ${isToday ? s.attToday : ''}`}
                            title={attended ? `${emp.name} attended on day ${day}` : undefined}
                          />
                        );
                      })}
                      <div key={`s-${emp.user_id}`} className={s.attSum}>{emp.total_days}</div>
                    </>
                  );
                })}
              </div>
            )}

            <div className={s.attLegend}>
              <span className={`${s.legendDot} ${s.attPresent}`} /> Attended &nbsp;
              <span className={`${s.legendDot} ${s.attAbsent}`}  /> Absent &nbsp;
              <span className={`${s.legendDot} ${s.attToday}`}   /> Today
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className={s.footer}>
        <span>Powered by <strong>GymMind</strong> — Gym Management for Rwanda</span>
        <span className={s.footerSep}>·</span>
        <span>Support: support@gymmind.rw</span>
      </footer>

      {/* ──── Add Employee Modal ──── */}
      {addOpen && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && setAddOpen(false)}>
          <div className={s.modal}>
            <div className={s.modalHeader}>
              <div className={s.modalTitle}>Add Employee</div>
              <button type="button" className={s.modalClose} onClick={() => setAddOpen(false)}>×</button>
            </div>
            <div className={s.modalBody}>
              <label className={s.formLabel}>Full Name <span className={s.req}>*</span></label>
              <input type="text" className={s.formInput} placeholder="Jean Paul Habimana"
                value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
              <label className={s.formLabel}>Phone (optional)</label>
              <input type="tel" className={s.formInput} placeholder="078 000 0000"
                value={addPhone} onChange={e => setAddPhone(e.target.value)} />
              {addError && <div className={s.formError}>{addError}</div>}
            </div>
            <div className={s.modalFooter}>
              <button type="button" className={s.btnSecondary} onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="button" className={s.btnPrimary}
                disabled={!addName.trim() || addLoading} onClick={submitAddEmployee}>
                {addLoading ? 'Adding…' : 'Add Employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──── MoMo Payment Modal ──── */}
      {momoOpen && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && !momoResult && setMomoOpen(false)}>
          <div className={s.modal}>
            <div className={s.modalHeader}>
              <div className={s.modalTitle}>Pay via MTN MoMo</div>
              <button type="button" className={s.modalClose} onClick={() => setMomoOpen(false)}>×</button>
            </div>
            <div className={s.modalBody}>
              {momoResult ? (
                <div className={s.momoSuccess}>
                  <div className={s.momoSuccessIcon}>✅</div>
                  <div className={s.momoSuccessText}>{momoResult}</div>
                </div>
              ) : (
                <>
                  <div className={s.momoAmount}>{data.total.toLocaleString()} RWF</div>
                  <div className={s.momoSub}>{fmtMonth(data.month)} · {data.institution.name}</div>
                  <label className={s.formLabel}>Your Name <span className={s.req}>*</span></label>
                  <input type="text" className={s.formInput} placeholder="HR Manager name"
                    value={momoName} onChange={e => setMomoName(e.target.value)} autoFocus />
                  <label className={s.formLabel}>MoMo Phone Number <span className={s.req}>*</span></label>
                  <input type="tel" className={s.formInput} placeholder="078 000 0000"
                    value={momoPhone} onChange={e => setMomoPhone(e.target.value)} />
                  {momoError && <div className={s.formError}>{momoError}</div>}
                </>
              )}
            </div>
            <div className={s.modalFooter}>
              {momoResult ? (
                <button type="button" className={s.btnPrimary} onClick={() => setMomoOpen(false)}>Done</button>
              ) : (
                <>
                  <button type="button" className={s.btnSecondary} onClick={() => setMomoOpen(false)}>Cancel</button>
                  <button type="button" className={s.momoSubmitBtn}
                    disabled={!momoName.trim() || !momoPhone.trim() || momoLoading} onClick={submitPay}>
                    {momoLoading ? 'Initiating…' : `Pay ${data.total.toLocaleString()} RWF`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
