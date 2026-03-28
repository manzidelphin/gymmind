import { useEffect, useState } from 'react';
import api from '../../api/api';
import s from './PaymentsTab.module.css';

interface InstitutionalPayment {
  id: number;
  name: string;
  total_visits: number;
  paid_amount: number;
  paid_at: string;
  payment_reference: string | null;
}

interface Payment {
  id: number;
  member_name: string | null;
  payer_phone: string;
  plan_name: string | null;
  service_name: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'successful' | 'failed';
  failure_reason: string | null;
  created_at: string;
  payment_type: 'membership' | 'walkin';
}

export default function PaymentsTab() {
  const [payments,     setPayments]     = useState<Payment[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [instPayments, setInstPayments] = useState<InstitutionalPayment[]>([]);

  async function load() {
    setLoading(true); setError('');
    try {
      const { data } = await api.get<{ payments: Payment[]; total: number }>('/payments');
      setPayments(data.payments);
    } catch {
      setError('Failed to load payments.');
    } finally {
      setLoading(false);
    }
    // Institutional payments loaded separately — failure here never blocks the main table
    try {
      const now   = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data } = await api.get<{ institutions: Array<{
        id: number; name: string; total_visits: number;
        paid_amount: number | null; paid_at: string | null;
        payment_status: string | null; payment_reference: string | null;
      }> }>(`/billing/institutions?month=${month}`);
      setInstPayments(
        data.institutions
          .filter(i => i.payment_status === 'paid' && i.paid_at != null && i.paid_amount != null)
          .map(i => ({
            id:                i.id,
            name:              i.name,
            total_visits:      i.total_visits,
            paid_amount:       i.paid_amount!,
            paid_at:           i.paid_at!,
            payment_reference: i.payment_reference,
          })),
      );
    } catch { /* billing section is optional — silently ignore */ }
  }

  useEffect(() => { load(); }, []);

  // ── Summary stats (current month) ─────────────────────────────
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  const totalCollected = payments
    .filter(p => {
      const d = new Date(p.created_at);
      return p.status === 'successful'
        && d.getMonth() === thisMonth
        && d.getFullYear() === thisYear;
    })
    .reduce((sum, p) => sum + Number(p.amount), 0);

  // Walk-in pending payments are excluded from the list on the backend.
  // Only membership pending payments count here.
  const pendingCount = payments.filter(p => p.status === 'pending').length;
  const failedCount  = payments.filter(p => p.status === 'failed').length;

  const summaryCards = [
    { label: `Collected this month`,  value: `${totalCollected.toLocaleString()} RWF`, cls: s.summaryCardGreen },
    { label: 'Pending payments',       value: pendingCount,                              cls: s.summaryCardAmber },
    { label: 'Failed payments',        value: failedCount,                               cls: s.summaryCardRed   },
  ];

  function badgeClass(status: Payment['status']) {
    if (status === 'successful') return s.badgeGreen;
    if (status === 'pending')    return s.badgeAmber;
    return s.badgeRed;
  }

  return (
    <div className={s.section}>
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>Payments</h3>
        <button type="button" className={s.refreshBtn} onClick={load}>↻ Refresh</button>
      </div>

      {/* ── Summary cards ── */}
      <div className={s.summaryGrid}>
        {summaryCards.map(c => (
          <div key={c.label} className={`${s.summaryCard} ${c.cls}`}>
            <p className={s.summaryNum}>{c.value}</p>
            <p className={s.summaryLabel}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      {loading && <p className={s.loading}>Loading…</p>}
      {error   && <p className={s.empty}>{error}</p>}

      {!loading && payments.length === 0 && (
        <p className={s.empty}>No payments recorded yet.</p>
      )}

      {!loading && instPayments.length > 0 && (
        <div className={s.instSection}>
          <h4 className={s.instSectionTitle}>Institutional Payments — This Month</h4>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Institution</th>
                  <th className={s.th}>Visits</th>
                  <th className={s.th}>Amount</th>
                  <th className={s.th}>Reference</th>
                  <th className={s.th}>Paid On</th>
                </tr>
              </thead>
              <tbody>
                {instPayments.map(ip => (
                  <tr key={ip.id} className={s.tr}>
                    <td className={s.td}>
                      <div className={s.memberCell}>
                        <span>{ip.name}</span>
                        <span className={`${s.badge} ${s.badgeGreen}`}>PAID</span>
                      </div>
                    </td>
                    <td className={s.td}>{ip.total_visits}</td>
                    <td className={s.td}>
                      <span className={s.amount}>{Number(ip.paid_amount).toLocaleString()} RWF</span>
                    </td>
                    <td className={s.td}>
                      <span className={s.phone}>{ip.payment_reference ?? '—'}</span>
                    </td>
                    <td className={s.td}>{new Date(ip.paid_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && payments.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>Member</th>
                <th className={s.th}>Phone</th>
                <th className={s.th}>Plan</th>
                <th className={s.th}>Service</th>
                <th className={s.th}>Amount</th>
                <th className={s.th}>Status</th>
                <th className={s.th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={`${p.payment_type}-${p.id}`} className={s.tr}>
                  <td className={s.td}>
                    <div className={s.memberCell}>
                      <span>{p.member_name ?? '—'}</span>
                      {p.payment_type === 'walkin' && (
                        <span className={`${s.badge} ${s.badgeOrange}`}>Walk-in</span>
                      )}
                    </div>
                  </td>
                  <td className={s.td}><span className={s.phone}>{p.payer_phone}</span></td>
                  <td className={s.td}>{p.plan_name ?? '—'}</td>
                  <td className={s.td}>
                    {p.service_name
                      ? p.service_name.split(', ').map(name => (
                          <span key={name} className={s.servicePill}>{name}</span>
                        ))
                      : '—'}
                  </td>
                  <td className={s.td}>
                    <span className={s.amount}>{Number(p.amount).toLocaleString()} {p.currency}</span>
                  </td>
                  <td className={s.td}>
                    <span className={`${s.badge} ${badgeClass(p.status)}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className={s.td}>{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
