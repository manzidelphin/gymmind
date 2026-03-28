import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/api';
import s from './AttendanceTab.module.css';

interface DayRow {
  date: string;
  total: number;
  individual: number;
  institutional: number;
  dependent: number;
}

interface TodayCheckin {
  id: number;
  checked_in_at: string;
  checkin_type: 'individual' | 'institutional' | 'dependent' | 'walkin';
  member_name: string | null;
  member_phone: string | null;
  service_name: string | null;
  institution_name: string | null;
  parent_name: string | null;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatTime(iso: string): { text: string; cls: string } {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 5)  return { text: 'Just now', cls: s.timeNow };
  if (mins < 60) return { text: `${mins} min ago`, cls: s.timeAgo };
  const d = new Date(iso);
  return {
    text: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    cls: s.timeHHMM,
  };
}

const AVATAR_CLASS: Record<TodayCheckin['checkin_type'], string> = {
  individual:    s.avatarIndividual,
  institutional: s.avatarInstitutional,
  dependent:     s.avatarDependent,
  walkin:        s.avatarWalkin,
};

const BADGE_CLASS: Record<TodayCheckin['checkin_type'], string> = {
  individual:    s.badgeIndividual,
  institutional: s.badgeInstitutional,
  dependent:     s.badgeDependent,
  walkin:        s.badgeWalkin,
};

const TYPE_LABEL: Record<TodayCheckin['checkin_type'], string> = {
  individual:    'Member',
  institutional: 'Corporate',
  dependent:     'Dependent',
  walkin:        'Walk-in',
};

export default function AttendanceTab() {
  const [from,    setFrom]    = useState(daysAgo(29));
  const [to,      setTo]      = useState(daysAgo(0));
  const [pending, setPending] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [rows,    setRows]    = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [feed,        setFeed]        = useState<TodayCheckin[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  async function fetchData(f: string, t: string) {
    setLoading(true);
    try {
      const { data } = await api.get(`/reports/attendance?from=${f}&to=${t}`);
      setRows(data.data.map((r: any) => ({
        ...r,
        date:          r.date.slice(0, 10),
        total:         Number(r.total),
        individual:    Number(r.individual),
        institutional: Number(r.institutional),
        dependent:     Number(r.dependent),
      })));
    } finally { setLoading(false); }
  }

  async function fetchFeed() {
    setFeedLoading(true);
    try {
      const { data } = await api.get('/reports/today-checkins');
      setFeed(data.checkins ?? []);
    } catch { /* silently ignore */ }
    finally { setFeedLoading(false); }
  }

  useEffect(() => {
    fetchData(from, to);
    fetchFeed();
    const t = setInterval(fetchFeed, 30000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    setFrom(pending.from);
    setTo(pending.to);
    fetchData(pending.from, pending.to);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      total:         acc.total         + r.total,
      individual:    acc.individual    + r.individual,
      institutional: acc.institutional + r.institutional,
      dependent:     acc.dependent     + r.dependent,
    }),
    { total: 0, individual: 0, institutional: 0, dependent: 0 }
  );

  return (
    <>
      <div className={s.controls}>
        <div className={s.dateGroup}>
          <label htmlFor="att-from" className={s.dateLabel}>From</label>
          <input
            id="att-from"
            type="date"
            className={s.dateInput}
            value={pending.from}
            onChange={e => setPending(p => ({ ...p, from: e.target.value }))}
          />
        </div>
        <div className={s.dateGroup}>
          <label htmlFor="att-to" className={s.dateLabel}>To</label>
          <input
            id="att-to"
            type="date"
            className={s.dateInput}
            value={pending.to}
            onChange={e => setPending(p => ({ ...p, to: e.target.value }))}
          />
        </div>
        <button type="button" className={s.applyBtn} onClick={apply}>Apply</button>
      </div>

      <div className={s.chartCard}>
        <p className={s.chartTitle}>Daily Check-ins</p>

        {loading && <p className={s.empty}>Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className={s.empty}>No check-ins in this period.</p>
        )}

        {!loading && rows.length > 0 && (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={d => {
                  const dt = new Date(d);
                  return `${dt.getDate()} ${dt.toLocaleString('default', { month: 'short' })}`;
                }}
              />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                labelFormatter={l => {
                  const dt = new Date(l);
                  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                }}
              />
              <Legend wrapperStyle={{ fontSize: '13px' }} />
              <Bar dataKey="individual"    name="Individual"    fill="#2563eb" radius={[3,3,0,0]} />
              <Bar dataKey="institutional" name="Institutional" fill="#059669" radius={[3,3,0,0]} />
              <Bar dataKey="dependent"     name="Dependent"     fill="#0891b2" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={s.summaryGrid}>
        {[
          { label: 'Total check-ins', num: totals.total,         color: '#0f172a' },
          { label: 'Individual',       num: totals.individual,    color: '#2563eb' },
          { label: 'Institutional',    num: totals.institutional, color: '#059669' },
          { label: 'Dependent',        num: totals.dependent,     color: '#0891b2' },
        ].map(c => (
          <div key={c.label} className={s.summaryCard}>
            <p className={s.summaryNum} style={{ color: c.color }}>{c.num}</p>
            <p className={s.summaryLabel}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Today's Live Feed ── */}
      <div className={s.feedSection}>
        <div className={s.feedHeader}>
          <h3 className={s.feedTitle}>Today's Check-ins</h3>
          <div className={s.feedMeta}>
            {!feedLoading && (
              <span className={s.feedCount}>
                {feed.length} check-in{feed.length !== 1 ? 's' : ''} today
              </span>
            )}
            <div className={s.liveRow}>
              <span className={s.liveDot} />
              <span className={s.liveLabel}>Live</span>
            </div>
            <span className={s.refreshText}>Refreshes every 30s</span>
          </div>
        </div>

        {feedLoading && feed.length === 0 && (
          <p className={s.empty}>Loading…</p>
        )}

        {!feedLoading && feed.length === 0 && (
          <div className={s.feedEmpty}>
            <p className={s.feedEmptyTitle}>No check-ins yet today</p>
            <p className={s.feedEmptySub}>Members will appear here as they check in</p>
          </div>
        )}

        {feed.length > 0 && (
          <table className={s.feedTable}>
            <thead>
              <tr>
                <th className={s.feedTh}>Time</th>
                <th className={s.feedTh}>Member</th>
                <th className={s.feedTh}>Service</th>
                <th className={s.feedTh}>Type</th>
                <th className={`${s.feedTh} ${s.colInstitution}`}>Institution</th>
              </tr>
            </thead>
            <tbody>
              {feed.map(row => {
                const time = formatTime(row.checked_in_at);
                return (
                  <tr key={row.id} className={s.feedTr}>
                    <td className={s.feedTd}>
                      <span className={time.cls}>{time.text}</span>
                    </td>
                    <td className={s.feedTd}>
                      <div className={s.memberCell}>
                        <div className={`${s.avatar} ${AVATAR_CLASS[row.checkin_type]}`}>
                          {initials(row.member_name)}
                        </div>
                        <div>
                          <div className={s.memberName}>{row.member_name ?? 'Unknown'}</div>
                          {row.member_phone && (
                            <div className={s.memberPhone}>{row.member_phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={s.feedTd}>
                      <span className={s.servicePill}>
                        {row.service_name ?? 'Gym Floor'}
                      </span>
                    </td>
                    <td className={s.feedTd}>
                      <span className={`${s.typeBadge} ${BADGE_CLASS[row.checkin_type]}`}>
                        {TYPE_LABEL[row.checkin_type]}
                      </span>
                    </td>
                    <td className={`${s.feedTd} ${s.colInstitution}`}>
                      {row.institution_name ? (
                        <div>
                          <div className={s.instCell}>{row.institution_name}</div>
                          {row.parent_name && (
                            <div className={s.instVia}>via {row.parent_name}</div>
                          )}
                        </div>
                      ) : (
                        <span className={s.instDash}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
