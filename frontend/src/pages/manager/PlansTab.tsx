import { useEffect, useState } from 'react';
import api from '../../api/api';
import s from './PlansTab.module.css';

interface Plan {
  id: number; name: string; type: string;
  duration_days: number | null; sessions: number | null;
  price: number; currency: string; is_active: boolean | number;
}

export default function PlansTab() {
  const [plans,   setPlans]   = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);

  // Create form state
  const [name,     setName]     = useState('');
  const [type,     setType]     = useState('time_based');
  const [days,     setDays]     = useState('30');
  const [sessions, setSessions] = useState('10');
  const [price,    setPrice]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');
  const [formOk,   setFormOk]   = useState('');

  async function fetchPlans() {
    setLoading(true);
    try {
      // Fetch all plans including inactive by calling without filter
      const { data } = await api.get<Plan[]>('/membership-plans');
      setPlans(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchPlans(); }, []);

  async function toggleActive(plan: Plan) {
    await api.patch(`/membership-plans/${plan.id}`, { is_active: !plan.is_active });
    fetchPlans();
  }

  async function createPlan() {
    if (!name.trim() || !price) return;
    setSaving(true); setFormErr(''); setFormOk('');
    try {
      const body: Record<string, unknown> = {
        name: name.trim(), type, price: parseFloat(price),
      };
      if (type === 'time_based')    body.duration_days = parseInt(days);
      if (type === 'session_based') body.sessions      = parseInt(sessions);

      await api.post('/membership-plans', body);
      setName(''); setPrice(''); setDays('30'); setSessions('10');
      setFormOk('Plan created successfully.');
      fetchPlans();
    } catch (e: any) { setFormErr(e.response?.data?.error?.formErrors?.[0] ?? e.response?.data?.error ?? 'Failed to create plan.'); }
    finally { setSaving(false); }
  }

  function formatPrice(p: number, c: string) {
    return `${Number(p).toLocaleString()} ${c}`;
  }

  return (
    <>
      <p className={s.sectionTitle}>Active Plans</p>

      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      <div className={s.grid}>
        {plans.map(plan => (
          <div key={plan.id} className={`${s.planCard} ${!plan.is_active ? s.planCardInactive : ''}`}>
            <p className={s.planName}>{plan.name}</p>
            <span className={s.planType}>{plan.type.replace('_', ' ')}</span>
            <p className={s.planPrice}>
              {formatPrice(plan.price, plan.currency)}
            </p>
            {plan.type === 'time_based' && (
              <p className={s.planDetail}>{plan.duration_days} days access</p>
            )}
            {plan.type === 'session_based' && (
              <p className={s.planDetail}>{plan.sessions} sessions</p>
            )}
            <div className={s.planActions}>
              <button
                type="button"
                className={plan.is_active ? s.deactivateBtn : s.activateBtn}
                onClick={() => toggleActive(plan)}
              >
                {plan.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create plan form */}
      <div className={s.formCard}>
        <p className={s.formTitle}>Create New Plan</p>

        <div className={s.formRow}>
          <div className={s.formGroup}>
            <label htmlFor="plan-name" className={s.formLabel}>Plan name</label>
            <input
              id="plan-name"
              type="text"
              placeholder="e.g. Monthly"
              className={s.formInput}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className={s.formGroup}>
            <label htmlFor="plan-type" className={s.formLabel}>Type</label>
            <select
              id="plan-type"
              className={s.formSelect}
              value={type}
              onChange={e => setType(e.target.value)}
            >
              <option value="time_based">Time-based</option>
              <option value="session_based">Session-based</option>
            </select>
          </div>
        </div>

        <div className={s.formRow}>
          {type === 'time_based' && (
            <div className={s.formGroup}>
              <label htmlFor="plan-days" className={s.formLabel}>Duration (days)</label>
              <input
                id="plan-days"
                type="number"
                min="1"
                placeholder="30"
                className={s.formInput}
                value={days}
                onChange={e => setDays(e.target.value)}
              />
            </div>
          )}
          {type === 'session_based' && (
            <div className={s.formGroup}>
              <label htmlFor="plan-sessions" className={s.formLabel}>Sessions</label>
              <input
                id="plan-sessions"
                type="number"
                min="1"
                placeholder="10"
                className={s.formInput}
                value={sessions}
                onChange={e => setSessions(e.target.value)}
              />
            </div>
          )}
          <div className={s.formGroup}>
            <label htmlFor="plan-price" className={s.formLabel}>Price (RWF)</label>
            <input
              id="plan-price"
              type="number"
              min="0"
              placeholder="25000"
              className={s.formInput}
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </div>
        </div>

        {formErr && <p className={s.error}>{formErr}</p>}
        {formOk  && <p className={s.success}>{formOk}</p>}

        <button
          type="button"
          className={`${s.submitBtn} ${(!name.trim() || !price || saving) ? s.submitBtnDisabled : ''}`}
          onClick={createPlan}
          disabled={!name.trim() || !price || saving}
        >
          {saving ? 'Creating…' : '+ Create Plan'}
        </button>
      </div>
    </>
  );
}
