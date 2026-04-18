import { useEffect, useState } from 'react';
import api from '../../api/api';
import s from './ReportsTab.module.css';

interface MembershipSummary { active: number; expired: number; expiring_soon: number; no_membership: number; }

interface MembershipDetail {
  id: number;
  name: string;
  phone: string | null;
  plan_name: string | null;
  plan_type: string | null;
  membership_status: string | null;
  remaining_sessions: number | null;
  end_date: string | null;
  start_date: string | null;
  checkins_this_month: number;
}

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
  const [membershipData, setMembershipData] = useState<MembershipDetail[] | null>(null);
  const [membershipLoad,   setMembershipLoad]   = useState(false);
  const [membershipSearch, setMembershipSearch] = useState('');
  const [walkinFrom,   setWalkinFrom]   = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [memberData,   setMemberData]   = useState<MembershipDetail[] | null>(null);
  const [memberLoad,   setMemberLoad]   = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [walkinTo,     setWalkinTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [walkinData,   setWalkinData]   = useState<WalkInReport | null>(null);
  const [walkinLoad,   setWalkinLoad]   = useState(false);
  const [membershipLoad, setMembershipLoad] = useState(false);

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
  }>('/reports/membership-detail');
      setMembershipData(data.members);
    } catch { /* ignore */ }
    finally { setMembershipLoad(false); }
  }

  async function fetchMembershipReport() {
    setMembershipLoad(true);
    try {
      const { data } = await api.get<{ members: MembershipDetail[] }>('/reports/membership-detail');
      setMembershipData(data.members);
    } catch { /* ignore */ }
    finally { setMembershipLoad(false); }
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

  async function fetchMemberships() {
    setMemberLoad(true);
    try {
      const { data } = await api.get<{ members: MembershipDetail[] }>('/reports/membership-detail');
      setMemberData(data.members);
    } catch { /* ignore */ }
    finally { setMemberLoad(false); }
  }

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

      {/* ── Membership & Subscriptions Report ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Membership &amp; Subscriptions</h3>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <input
              type="text" placeholder="Search member..." className={s.control}
              value={membershipSearch} onChange={e => setMembershipSearch(e.target.value)}
              style={{ width:'180px' }}
            />
            <button className={s.btnGenerate} disabled={membershipLoad} onClick={fetchMembershipReport}>
              {membershipLoad ? 'Loading…' : 'Generate →'}
            </button>
          </div>
        </div>
        {membershipData && (
          <div style={{ overflowX:'auto', marginTop:'16px' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['MEMBER','PHONE','PLAN','TYPE','STATUS','SESSIONS LEFT','EXPIRY','CHECK-INS THIS MONTH'].map(h=>(
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:600, color:'#64748b', letterSpacing:'0.5px', borderBottom:'1px solid #e2e8f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {membershipData
                  .filter(m => !membershipSearch || m.name.toLowerCase().includes(membershipSearch.toLowerCase()))
                  .map(m => (
                  <tr key={m.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'12px 14px', fontWeight:600, color:'#0f172a' }}>{m.name}</td>
                    <td style={{ padding:'12px 14px', color:'#64748b' }}>{m.phone || '—'}</td>
                    <td style={{ padding:'12px 14px', color:'#0f172a' }}>{m.plan_name || <span style={{ color:'#94a3b8' }}>No Plan</span>}</td>
                    <td style={{ padding:'12px 14px' }}>
                      {m.plan_type === 'session_based'
                        ? <span style={{ background:'#dbeafe', color:'#1e40af', padding:'2px 8px', borderRadius:'99px', fontSize:'11px', fontWeight:600 }}>Session</span>
                        : m.plan_type === 'time_based'
                        ? <span style={{ background:'#dcfce7', color:'#166534', padding:'2px 8px', borderRadius:'99px', fontSize:'11px', fontWeight:600 }}>Time</span>
                        : <span style={{ color:'#94a3b8', fontSize:'12px' }}>—</span>}
                    </td>
                    <td style={{ padding:'12px 14px' }}>
                      {m.membership_status === 'active'
                        ? <span style={{ background:'#dcfce7', color:'#166534', padding:'2px 8px', borderRadius:'99px', fontSize:'11px', fontWeight:600 }}>Active</span>
                        : m.membership_status === 'expired'
                        ? <span style={{ background:'#fee2e2', color:'#991b1b', padding:'2px 8px', borderRadius:'99px', fontSize:'11px', fontWeight:600 }}>Expired</span>
                        : <span style={{ color:'#94a3b8', fontSize:'12px' }}>No Plan</span>}
                    </td>
                    <td style={{ padding:'12px 14px', fontWeight:700, color: m.remaining_sessions != null ? '#0F6E56' : '#94a3b8' }}>
                      {m.remaining_sessions != null ? m.remaining_sessions : m.plan_type === 'time_based' ? '∞' : '—'}
                    </td>
                    <td style={{ padding:'12px 14px', color:'#64748b', fontSize:'12px' }}>
                      {m.end_date ? new Date(m.end_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                    </td>
                    <td style={{ padding:'12px 14px', fontWeight:700, color: Number(m.checkins_this_month) > 0 ? '#0F6E56' : '#94a3b8' }}>
                      {m.checkins_this_month ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background:'#f8fafc', fontWeight:700 }}>
                  <td colSpan={5} style={{ padding:'12px 14px' }}>TOTAL</td>
                  <td style={{ padding:'12px 14px', color:'#0F6E56' }}>
                    {membershipData.filter(m=>m.membership_status==='active').length} active
                  </td>
                  <td colSpan={2} style={{ padding:'12px 14px', color:'#64748b' }}>
                    {membershipData.filter(m=>m.membership_status==='active' && m.plan_type==='session_based').reduce((s,m)=>s+(m.remaining_sessions??0),0)} sessions remaining
                  </td>
                </tr>
              </tfoot>
            </table>
            {membershipData.filter(m => !membershipSearch || m.name.toLowerCase().includes(membershipSearch.toLowerCase())).length === 0 && (
              <div style={{ textAlign:'center', padding:'32px', color:'#94a3b8' }}>No members found</div>
            )}
          </div>
        )}
      </div>

      {/* ── Membership / Subscription Report ── */}
      <div className={s.sectionCard}>
        <div className={s.cardHeader}>
          <h3 className={s.cardTitle}>Membership & Subscription Report</h3>
          <button className={s.generateBtn} disabled={memberLoad} onClick={fetchMemberships}>
            {memberLoad ? 'Loading…' : 'Generate →'}
          </button>
        </div>
        {memberData && (
          <>
            <input
              type="text" placeholder="Search member..." value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              style={{ width:'100%', padding:'10px 14px', border:'1px solid #e2e8f0', borderRadius:'8px', fontSize:'14px', marginBottom:'16px', outline:'none' }}
            />
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'14px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['MEMBER','PHONE','PLAN','TYPE','STATUS','SESSIONS LEFT','EXPIRES','CHECK-INS THIS MONTH'].map(h => (
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:600, color:'#64748b', letterSpacing:'0.5px', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberData.filter(m => !memberSearch || m.name.toLowerCase().includes(memberSearch.toLowerCase()) || (m.phone||'').includes(memberSearch)).map(m => (
                    <tr key={m.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                      <td style={{ padding:'12px 14px', fontWeight:600, color:'#0f172a' }}>{m.name}</td>
                      <td style={{ padding:'12px 14px', color:'#64748b', fontSize:'13px' }}>{m.phone || '—'}</td>
                      <td style={{ padding:'12px 14px' }}>{m.plan_name ? <span style={{ background:'#dbeafe', color:'#1e40af', padding:'2px 10px', borderRadius:'99px', fontSize:'12px', fontWeight:600 }}>{m.plan_name}</span> : <span style={{ color:'#94a3b8', fontSize:'13px' }}>No plan</span>}</td>
                      <td style={{ padding:'12px 14px', color:'#64748b', fontSize:'13px', textTransform:'capitalize' }}>{m.plan_type?.replace('_',' ') || '—'}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ padding:'2px 10px', borderRadius:'99px', fontSize:'12px', fontWeight:600, background: m.membership_status==='active'?'#dcfce7':m.membership_status==='expired'?'#fee2e2':'#f1f5f9', color: m.membership_status==='active'?'#166534':m.membership_status==='expired'?'#991b1b':'#64748b' }}>
                          {m.membership_status || 'No plan'}
                        </span>
                      </td>
                      <td style={{ padding:'12px 14px', fontWeight:700, color: (m.remaining_sessions??0)>0?'#0F6E56':'#94a3b8' }}>
                        {m.plan_type==='session_based' ? (m.remaining_sessions??0) : m.plan_type==='time_based' ? '∞' : '—'}
                      </td>
                      <td style={{ padding:'12px 14px', color:'#64748b', fontSize:'13px' }}>
                        {m.end_date ? new Date(m.end_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
                      </td>
                      <td style={{ padding:'12px 14px', fontWeight:700, color:'#0F6E56', textAlign:'center' }}>{m.checkins_this_month}</td>
                    </tr>
                  ))}
                  {memberData.filter(m => !memberSearch || m.name.toLowerCase().includes(memberSearch.toLowerCase())).length === 0 && (
                    <tr><td colSpan={8} style={{ padding:'32px', textAlign:'center', color:'#94a3b8' }}>No members found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop:'16px', padding:'12px 16px', background:'#f8fafc', borderRadius:'10px', display:'flex', gap:'24px', fontSize:'13px', color:'#64748b' }}>
              <span>Total members: <strong style={{color:'#0f172a'}}>{memberData.length}</strong></span>
              <span>Active plans: <strong style={{color:'#0F6E56'}}>{memberData.filter(m=>m.membership_status==='active').length}</strong></span>
              <span>No plan: <strong style={{color:'#94a3b8'}}>{memberData.filter(m=>!m.plan_name).length}</strong></span>
            </div>
          </>
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
