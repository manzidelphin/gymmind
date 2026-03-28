import { useEffect, useState } from 'react';
import api from '../../api/api';
import s from './ReportsTab.module.css';

interface MembershipSummary { active: number; expired: number; expiring_soon: number; no_membership: number; }

interface WalkInReport {
  from: string; to: string;
  total_payments: number; total_revenue: number; active_days: number;
  daily: { date: string; payments: number; revenue: number }[];
  top_services: { name: string; count: number; revenue: number }[];
}

interface Institution { id: number; name: string; }

interface AttendanceMember { name: string; visits: number; }
interface AttendanceInstitution { id: number; name: string; members: AttendanceMember[]; total_visits: number; }
interface InstitutionAttendanceReport { month: string; institutions: AttendanceInstitution[]; }

interface BillingMember {
  id: number; name: string; parent_name: string | null;
  visit_count: number; amount_due: number; visit_dates: string[];
}
interface BillingReport {
  institution: { id: number; name: string; rate_per_session: number };
  from: string; to: string;
  members: BillingMember[];
  total_visits: number; total_amount: number;
}

export default function ReportsTab() {
  const [data,    setData]    = useState<MembershipSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // Institution billing
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [instId,       setInstId]       = useState('');
  const [fromDate,     setFromDate]     = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [toDate,       setToDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [billing,      setBilling]      = useState<BillingReport | null>(null);
  const [billingLoad,  setBillingLoad]  = useState(false);
  const [expanded,     setExpanded]     = useState<Record<number, boolean>>({});

  // Institutional attendance
  const [attendMonth, setAttendMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [attendData,  setAttendData]  = useState<InstitutionAttendanceReport | null>(null);
  const [attendLoad,  setAttendLoad]  = useState(false);

  // Walk-in revenue
  const [walkinFrom,   setWalkinFrom]   = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [walkinTo,     setWalkinTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [walkinData,   setWalkinData]   = useState<WalkInReport | null>(null);
  const [walkinLoad,   setWalkinLoad]   = useState(false);

  useEffect(() => {
    fetchData();
    api.get<Institution[]>('/institutions').then(r => setInstitutions(r.data)).catch(() => {});
    fetchAttendance(new Date().toISOString().slice(0, 7));
    fetchWalkin(walkinFrom, walkinTo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: d } = await api.get<MembershipSummary>('/reports/memberships');
      setData(d);
    } finally { setLoading(false); }
  }

  async function fetchAttendance(month: string) {
    setAttendLoad(true);
    try {
      const { data: d } = await api.get<InstitutionAttendanceReport>(`/reports/institutions?month=${month}`);
      setAttendData(d);
    } catch { setAttendData(null); }
    finally { setAttendLoad(false); }
  }

  function downloadCSV(inst: AttendanceInstitution, month: string) {
    const lines = [
      `${inst.name} Attendance Report — ${month}`,
      ...inst.members.map(m => `${m.name}, ${m.visits}`),
      `Total: ${inst.total_visits} visits`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${inst.name.replace(/\s+/g, '-')}-attendance-${month.replace('/', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchWalkin(from: string, to: string) {
    setWalkinLoad(true);
    try {
      const { data: d } = await api.get<WalkInReport>(`/reports/walkin?from=${from}&to=${to}`);
      setWalkinData(d);
    } catch { setWalkinData(null); }
    finally { setWalkinLoad(false); }
  }

  async function fetchBilling() {
    if (!instId) return;
    setBillingLoad(true); setBilling(null);
    try {
      const { data: d } = await api.get<BillingReport>(
        `/reports/institution-billing?institutionId=${instId}&from=${fromDate}&to=${toDate}`
      );
      setBilling(d); setExpanded({});
    } finally { setBillingLoad(false); }
  }

  const cardDefs = data ? [
    { num: data.active,        label: 'Active memberships', sub: 'Currently valid plans',      cls: s.cardGreen  },
    { num: data.expiring_soon, label: 'Expiring this week', sub: 'End within 7 days',           cls: s.cardAmber  },
    { num: data.expired,       label: 'Expired',            sub: 'Past end date',               cls: s.cardRed    },
    { num: data.no_membership, label: 'No Plan',            sub: 'Members with no active plan', cls: s.cardPurple },
  ] : [];

  return (
    <>
      <h2 className={s.pageTitle}>Reports</h2>

      {/* ── Membership Summary ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Membership Summary</h3>
          <button type="button" className={s.refreshBtn} onClick={fetchData}>↻ Refresh</button>
        </div>
        {loading && <p className={s.empty}>Loading…</p>}
        {!loading && data && (
          <div className={s.statGrid}>
            {cardDefs.map(c => (
              <div key={c.label} className={`${s.statCard} ${c.cls}`}>
                <p className={s.statNum}>{c.num}</p>
                <p className={s.statLabel}>{c.label}</p>
                <p className={s.statSub}>{c.sub}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Institution Billing ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Institution Billing Report</h3>
          <button
            type="button"
            className={s.actionBtn}
            disabled={!instId || billingLoad}
            onClick={fetchBilling}
          >
            {billingLoad ? 'Loading…' : 'Generate →'}
          </button>
        </div>
        <div className={s.controlsRow}>
          <select
            className={s.control}
            value={instId}
            onChange={e => { setInstId(e.target.value); setBilling(null); }}
          >
            <option value="">Select institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <div className={s.dateRange}>
            <input type="date" className={s.control} value={fromDate}
              onChange={e => setFromDate(e.target.value)} />
            <span className={s.dateSep}>to</span>
            <input type="date" className={s.control} value={toDate}
              onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        {billing && (
          <div className={s.billingReport}>
            <div className={s.billingReportHeader}>
              <div>
                <p className={s.billingInstName}>{billing.institution.name}</p>
                <p className={s.billingPeriod}>
                  {billing.from} → {billing.to}
                  {billing.institution.rate_per_session > 0
                    ? ` · Rate: ${billing.institution.rate_per_session.toLocaleString()} RWF/visit`
                    : ' · Rate not set'}
                </p>
              </div>
              <div className={s.billingTotals}>
                <div className={s.billingTotal}>
                  <span className={s.billingTotalNum}>{billing.total_visits}</span>
                  <span className={s.billingTotalLabel}>Total Visits</span>
                </div>
                <div className={s.billingTotal}>
                  <span className={s.billingTotalNum}>{billing.total_amount.toLocaleString()}</span>
                  <span className={s.billingTotalLabel}>RWF Owed</span>
                </div>
              </div>
            </div>

            {billing.members.length === 0 ? (
              <p className={s.empty}>No members found for this institution.</p>
            ) : (
              <table className={s.billingTable}>
                <thead>
                  <tr>
                    <th className={s.bTh}>Member</th>
                    <th className={s.bTh}>Primary Member</th>
                    <th className={s.bTh}>Visits</th>
                    <th className={s.bTh}>Amount (RWF)</th>
                    <th className={s.bTh}>Visit Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.members.map(m => (
                    <tr key={m.id} className={s.bTr}>
                      <td className={s.bTd}><span className={s.memberName}>{m.name}</span></td>
                      <td className={s.bTd}>
                        {m.parent_name
                          ? <span className={s.parentName}>{m.parent_name}</span>
                          : <span className={s.primaryBadge}>Primary</span>
                        }
                      </td>
                      <td className={s.bTd}>{m.visit_count}</td>
                      <td className={s.bTd}>{m.amount_due > 0 ? m.amount_due.toLocaleString() : '—'}</td>
                      <td className={s.bTd}>
                        {m.visit_dates.length > 0 ? (
                          <>
                            <button type="button" className={s.datesToggle}
                              onClick={() => setExpanded(p => ({ ...p, [m.id]: !p[m.id] }))}>
                              {expanded[m.id] ? 'Hide ▲' : `Show ${m.visit_dates.length} ▼`}
                            </button>
                            {expanded[m.id] && (
                              <ul className={s.datesList}>
                                {m.visit_dates.map((d, i) => <li key={i}>{d}</li>)}
                              </ul>
                            )}
                          </>
                        ) : <span className={s.noVisits}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Institutional Attendance ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Institutional Attendance</h3>
          <input
            type="month"
            className={s.control}
            value={attendMonth}
            onChange={e => { setAttendMonth(e.target.value); fetchAttendance(e.target.value); }}
          />
        </div>

        {attendLoad && <p className={s.empty}>Loading…</p>}
        {attendData && attendData.institutions.length === 0 && (
          <p className={s.empty}>No institutions found for this gym.</p>
        )}
        {attendData && attendData.institutions.length > 0 && (
          <div className={s.attendList}>
            {attendData.institutions.map(inst => (
              <div key={inst.id} className={s.attendBlock}>
                <div className={s.attendBlockHeader}>
                  <span className={s.attendBlockName}>{inst.name}</span>
                  <span className={s.attendBlockMonth}>{attendData.month}</span>
                </div>
                <div className={s.attendDivider} />
                {inst.members.length === 0 ? (
                  <p className={s.attendEmpty}>No visits this month</p>
                ) : (
                  inst.members.map((m, i) => (
                    <div key={i} className={s.attendRow}>
                      <span>{m.name}</span>
                      <span className={s.attendVisits}>{m.visits} visit{m.visits !== 1 ? 's' : ''}</span>
                    </div>
                  ))
                )}
                <div className={s.attendFooter}>
                  <span className={s.attendTotal}>Total: {inst.total_visits} visits</span>
                  <button
                    type="button"
                    className={s.downloadBtn}
                    onClick={() => downloadCSV(inst, attendData.month)}
                  >
                    ↓ Download Report PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Walk-in Day Pass Revenue ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Walk-in Day Pass Revenue</h3>
          <button
            type="button"
            className={s.actionBtn}
            disabled={walkinLoad}
            onClick={() => fetchWalkin(walkinFrom, walkinTo)}
          >
            {walkinLoad ? 'Loading…' : 'Generate →'}
          </button>
        </div>
        <div className={s.dateRange}>
          <input type="date" className={s.control} value={walkinFrom}
            onChange={e => setWalkinFrom(e.target.value)} />
          <span className={s.dateSep}>to</span>
          <input type="date" className={s.control} value={walkinTo}
            onChange={e => setWalkinTo(e.target.value)} />
        </div>

        {walkinData && (
          <>
            <div className={s.walkinStats}>
              <div className={`${s.statCard} ${s.cardGreen}`}>
                <p className={s.statNum}>{walkinData.total_revenue.toLocaleString()}</p>
                <p className={s.statLabel}>Total Revenue</p>
                <p className={s.statSub}>RWF</p>
              </div>
              <div className={`${s.statCard} ${s.cardBlue}`}>
                <p className={s.statNum}>{walkinData.total_payments}</p>
                <p className={s.statLabel}>Day Passes Sold</p>
                <p className={s.statSub}>{walkinData.active_days} active days</p>
              </div>
            </div>
            <p className={s.periodText}>{walkinData.from} — {walkinData.to}</p>

            {walkinData.top_services.length > 0 && (
              <div className={s.servicesTable}>
                <p className={s.servicesTitle}>Top Services</p>
                <table className={s.billingTable}>
                  <thead>
                    <tr>
                      <th className={s.bTh}>Service</th>
                      <th className={s.bTh}>Sold</th>
                      <th className={s.bTh}>Revenue (RWF)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walkinData.top_services.map(svc => (
                      <tr key={svc.name} className={s.bTr}>
                        <td className={s.bTd}><span className={s.memberName}>{svc.name}</span></td>
                        <td className={s.bTd}>{svc.count}</td>
                        <td className={s.bTd}>{svc.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {walkinData.total_payments === 0 && (
              <p className={s.empty}>No walk-in payments in this period.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
