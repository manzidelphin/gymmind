import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { hrApi, publicApi } from '../api/api';
import s from './HRDashboard.module.css';

// ─── Types ────────────────────────────────────────────────────────
interface GymEntry {
  gymId:          number;
  gymName:        string;
  gymSlug:        string;
  institutionId:  number;
  institutionName: string;
  ratePerSession: number;
  employeeCount:  number;
  thisMonthVisits: number;
  invoiceAmount:  number;
  invoiceStatus:  'pending' | 'paid' | 'overdue' | null;
  invoiceToken:   string | null;
  invoiceId:      number | null;
  month:          string;
}

// ─── Helpers ──────────────────────────────────────────────────────
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ─── Main Component ───────────────────────────────────────────────
export default function HRDashboard() {
  const navigate = useNavigate();

  const [entries,  setEntries]  = useState<GymEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  // MoMo modal
  const [momoEntry,   setMomoEntry]   = useState<GymEntry | null>(null);
  const [momoName,    setMomoName]    = useState('');
  const [momoPhone,   setMomoPhone]   = useState('');
  const [momoLoading, setMomoLoading] = useState(false);
  const [momoResult,  setMomoResult]  = useState<string | null>(null);
  const [momoError,   setMomoError]   = useState('');

  // ─── Load ────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('hr_token');
    if (!token) { navigate('/hr/login'); return; }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setError('');
    try {
      const { data } = await hrApi.get<GymEntry[]>('/hr/dashboard');
      setEntries(data);
    } catch (e: any) {
      if (e.response?.status === 401) {
        localStorage.removeItem('hr_token');
        navigate('/hr/login');
      } else {
        setError('Failed to load dashboard. Please try again.');
      }
    } finally { setLoading(false); }
  }

  function logout() {
    localStorage.removeItem('hr_token');
    navigate('/hr/login');
  }

  // ─── Aggregates ──────────────────────────────────────────────
  const totalEmployees = entries.reduce((s, e) => s + e.employeeCount, 0);
  const totalVisits    = entries.reduce((s, e) => s + e.thisMonthVisits, 0);
  const totalInvoice   = entries.reduce((s, e) => s + e.invoiceAmount, 0);
  const paidCount      = entries.filter(e => e.invoiceStatus === 'paid').length;
  const pendingCount   = entries.filter(e => e.invoiceStatus !== 'paid').length;

  // ─── MoMo payment ────────────────────────────────────────────
  function openMomo(entry: GymEntry) {
    setMomoEntry(entry);
    setMomoName(''); setMomoPhone('');
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
      setMomoResult(`${data.message} Ref: ${data.reference}`);
      load();
    } catch (e: any) {
      setMomoError(e.response?.data?.error ?? 'Payment failed. Try again.');
    } finally { setMomoLoading(false); }
  }

  // ─── Render ──────────────────────────────────────────────────
  const month = entries[0]?.month ?? '';

  if (loading) {
    return (
      <div className={s.root}>
        <nav className={s.navbar}>
          <span className={s.navLogo}>GymMind</span>
          <span className={s.navTitle}>HR Admin Portal</span>
        </nav>
        <div className={s.splash}>Loading dashboard…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.root}>
        <nav className={s.navbar}>
          <span className={s.navLogo}>GymMind</span>
          <span className={s.navTitle}>HR Admin Portal</span>
        </nav>
        <div className={s.splash}><div className={s.splashError}>{error}</div></div>
      </div>
    );
  }

  return (
    <div className={s.root}>

      {/* ── Navbar ── */}
      <nav className={s.navbar}>
        <div className={s.navLeft}>
          <span className={s.navLogo}>GymMind</span>
          <span className={s.navTitle}>HR Admin Portal</span>
        </div>
        <div className={s.navRight}>
          {month && <span className={s.navMonth}>{fmtMonth(month)}</span>}
          <button className={s.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </nav>

      {/* ── Hero stats ── */}
      <div className={s.hero}>
        <div className={s.heroGrid}>
          <div className={s.statCard}>
            <div className={s.statNum}>{totalEmployees}</div>
            <div className={s.statLabel}>Total Employees</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statNum}>{totalVisits}</div>
            <div className={s.statLabel}>Total Visits This Month</div>
          </div>
          <div className={`${s.statCard} ${s.statGreen}`}>
            <div className={`${s.statNum} ${s.statGreenNum}`}>{totalInvoice.toLocaleString()} RWF</div>
            <div className={s.statLabel}>Total Invoice Amount</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statNum}>
              <span className={s.paidBadge}>{paidCount} paid</span>
              {' / '}
              <span className={s.pendingBadge}>{pendingCount} pending</span>
            </div>
            <div className={s.statLabel}>Invoice Status</div>
          </div>
        </div>
      </div>

      {/* ── Gym cards ── */}
      <div className={s.content}>
        {entries.length === 0 ? (
          <div className={s.empty}>No institutions found. Contact your gym to be set up as an HR admin.</div>
        ) : (
          <div className={s.cards}>
            {entries.map(entry => (
              <GymCard
                key={`${entry.gymId}-${entry.institutionId}`}
                entry={entry}
                onPay={() => openMomo(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── MoMo modal ── */}
      {momoEntry && (
        <div className={s.overlay} onClick={() => !momoLoading && setMomoEntry(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <h2 className={s.modalTitle}>Pay via MoMo</h2>
            <p className={s.modalSub}>
              {momoEntry.gymName} · {momoEntry.institutionName}<br/>
              Amount: <strong>{momoEntry.invoiceAmount.toLocaleString()} RWF</strong>
            </p>

            {momoResult ? (
              <div className={s.momoSuccess}>{momoResult}</div>
            ) : (
              <>
                <label className={s.modalLabel}>Your Name</label>
                <input
                  className={s.modalInput}
                  placeholder="Full name"
                  value={momoName}
                  onChange={e => setMomoName(e.target.value)}
                />
                <label className={s.modalLabel}>MoMo Phone Number</label>
                <input
                  className={s.modalInput}
                  type="tel"
                  placeholder="07XX XXX XXX"
                  value={momoPhone}
                  onChange={e => setMomoPhone(e.target.value)}
                />
                {momoError && <div className={s.momoError}>{momoError}</div>}
                <div className={s.modalActions}>
                  <button
                    className={s.modalCancel}
                    onClick={() => setMomoEntry(null)}
                    disabled={momoLoading}
                  >
                    Cancel
                  </button>
                  <button
                    className={s.modalPay}
                    onClick={submitPay}
                    disabled={momoLoading || !momoName.trim() || !momoPhone.trim()}
                  >
                    {momoLoading ? 'Processing…' : 'Pay Now'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Gym Card ─────────────────────────────────────────────────────
function GymCard({ entry, onPay }: { entry: GymEntry; onPay: () => void }) {
  const isPaid    = entry.invoiceStatus === 'paid';
  const isOverdue = entry.invoiceStatus === 'overdue';

  return (
    <div className={s.gymCard}>
      <div className={s.cardHeader}>
        <div className={s.cardGymName}>{entry.gymName}</div>
        <StatusBadge status={entry.invoiceStatus} />
      </div>
      <div className={s.cardInst}>{entry.institutionName}</div>

      <div className={s.cardStats}>
        <div className={s.cardStat}>
          <span className={s.cardStatNum}>{entry.employeeCount}</span>
          <span className={s.cardStatLabel}>employees</span>
        </div>
        <div className={s.cardStatDivider} />
        <div className={s.cardStat}>
          <span className={s.cardStatNum}>{entry.thisMonthVisits}</span>
          <span className={s.cardStatLabel}>visits this month</span>
        </div>
        <div className={s.cardStatDivider} />
        <div className={s.cardStat}>
          <span className={`${s.cardStatNum} ${s.cardStatGreen}`}>
            {entry.invoiceAmount.toLocaleString()} RWF
          </span>
          <span className={s.cardStatLabel}>invoice</span>
        </div>
      </div>

      <div className={s.cardActions}>
        {entry.invoiceToken ? (
          <Link to={`/hr/${entry.invoiceToken}`} className={s.btnDetails}>
            View Details
          </Link>
        ) : (
          <span className={s.btnDetailsDisabled}>No invoice yet</span>
        )}
        {!isPaid && !isOverdue && entry.invoiceToken && (
          <button className={s.btnPay} onClick={onPay}>
            Pay Invoice
          </button>
        )}
        <Link
          to={`/hr/${entry.invoiceToken ?? entry.gymSlug}`}
          className={s.btnEmployees}
        >
          Employees
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: GymEntry['invoiceStatus'] }) {
  if (status === 'paid')    return <span className={`${s.badge} ${s.badgePaid}`}>✓ PAID</span>;
  if (status === 'overdue') return <span className={`${s.badge} ${s.badgeOverdue}`}>OVERDUE</span>;
  if (status === 'pending') return <span className={`${s.badge} ${s.badgePending}`}>PENDING</span>;
  return <span className={`${s.badge} ${s.badgeNone}`}>NO INVOICE</span>;
}
