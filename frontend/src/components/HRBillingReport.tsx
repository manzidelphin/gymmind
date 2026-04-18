import { useState } from 'react';
import type { AxiosInstance } from 'axios';

interface Member {
  id: number;
  name: string;
  parent_name: string | null;
  visit_count: number;
  amount_due: number;
  visit_dates: string[];
  service_names: string[];
  gym_name: string;
}

interface ReportData {
  institution: { id: number; name: string; rate_per_session: number };
  from: string;
  to: string;
  members: Member[];
  total_visits: number;
  total_amount: number;
}

interface Props {
  entry: { institutionId: number; gymId: number; gymSlug: string };
  hrApi: AxiosInstance;
}

export default function HRBillingReport({ entry, hrApi }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function generate() {
    setLoading(true);
    try {
      const { data } = await hrApi.get<ReportData>(
        `/hr/${entry.institutionId}/billing-report?from=${from}&to=${to}`
      );
      setReport(data);
      setExpanded(new Set());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Institution Billing Report</h2>
        <button
          onClick={generate}
          disabled={loading}
          style={{ background: '#0F6E56', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
        >
          {loading ? 'Loading...' : 'Generate →'}
        </button>
      </div>

      {/* Date range */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px', background: '#f8fafc', padding: '16px', borderRadius: '12px' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
        <span style={{ color: '#64748b' }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
      </div>

      {report && (
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{report.institution.name}</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>{report.from} → {report.to} · Rate: {report.institution.rate_per_session.toLocaleString()} RWF/visit</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#0F6E56' }}>{report.total_visits}</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>TOTAL VISITS</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>{report.total_amount.toLocaleString()} RWF</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>RWF OWED</div>
            </div>
          </div>

          {/* Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['MEMBER', 'ROLE', 'PRIMARY MEMBER', 'VISITS', 'AMOUNT (RWF)', 'SERVICES', 'GYM', 'VISIT DATES'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#64748b', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.members.map(m => (
                <>
                  <tr key={m.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0f172a' }}>{m.name}</td>
                    <td style={{ padding: '14px 16px' }}>
                      {m.parent_name
                        ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '99px', fontSize: '12px', fontWeight: 600 }}>Dependent</span>
                        : <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '99px', fontSize: '12px', fontWeight: 600 }}>Employee</span>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {m.parent_name
                        ? <span style={{ color: '#64748b' }}>{m.parent_name}</span>
                        : <span style={{ background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: '99px', fontSize: '12px', fontWeight: 600 }}>Primary</span>}
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: m.visit_count > 0 ? '#0F6E56' : '#94a3b8' }}>{m.visit_count}</td>
                    <td style={{ padding: '14px 16px', color: m.amount_due > 0 ? '#0f172a' : '#94a3b8' }}>
                      {m.amount_due > 0 ? m.amount_due.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {m.visit_count > 0 ? (
                        <button onClick={() => toggleExpanded(m.id)}
                          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: '#475569' }}>
                          {expanded.has(m.id) ? '▲ Hide' : `Show ${m.visit_count} ▼`}
                        </button>
                      ) : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                  </tr>
                  {expanded.has(m.id) && (
                    <tr key={`${m.id}-dates`}>
                      <td colSpan={6} style={{ padding: '0 16px 14px 16px', background: '#f8fafc' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '8px' }}>
                          {m.visit_dates.map((d, i) => (
                            <span key={i} style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 500 }}>
                              {new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <td colSpan={4} style={{ padding: '14px 16px', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '14px 16px', fontWeight: 700, color: '#0F6E56' }}>{report.total_visits}</td>
                <td style={{ padding: '14px 16px', fontWeight: 700 }}>{report.total_amount.toLocaleString()} RWF</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!report && !loading && (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>Select a date range and click Generate</div>
          <div style={{ fontSize: '13px', marginTop: '4px' }}>View detailed attendance and billing for your institution</div>
        </div>
      )}
    </div>
  );
}
