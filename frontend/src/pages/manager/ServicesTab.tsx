import { useEffect, useState } from 'react';
import api from '../../api/api';
import s from './ServicesTab.module.css';
import pt from './PlansTab.module.css';

interface Service {
  id: number;
  name: string;
  description: string | null;
  price_per_visit: number;
  walkin_price: number;
  currency: string;
  is_active: boolean;
  is_default: boolean;
}

interface Plan {
  id: number;
  name: string;
  services: { id: number; name: string }[];
}

interface Institution {
  id: number;
  name: string;
}

interface InstitutionService {
  id: number;
  name: string;
  allowed_for: 'employees' | 'dependents' | 'both';
}

export default function ServicesTab() {
  const [services,    setServices]    = useState<Service[]>([]);
  const [plans,       setPlans]       = useState<Plan[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [instServices, setInstServices] = useState<Record<number, InstitutionService[]>>({});
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState('');
  const [toastOk,     setToastOk]     = useState(true);

  // Add service form
  const [showForm,      setShowForm]      = useState(false);
  const [formName,      setFormName]      = useState('');
  const [formDesc,      setFormDesc]      = useState('');
  const [formPrice,     setFormPrice]     = useState('0');
  const [formWalkin,    setFormWalkin]    = useState('0');
  const [formDefault,   setFormDefault]   = useState(false);
  const [formLoading,   setFormLoading]   = useState(false);
  const [formError,     setFormError]     = useState('');

  // Edit service form
  const [editId,        setEditId]        = useState<number | null>(null);
  const [editName,      setEditName]      = useState('');
  const [editDesc,      setEditDesc]      = useState('');
  const [editPrice,     setEditPrice]     = useState('0');
  const [editWalkin,    setEditWalkin]    = useState('0');
  const [editLoading,   setEditLoading]   = useState(false);
  const [editError,     setEditError]     = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [svcRes, planRes, instRes] = await Promise.all([
        api.get<Service[]>('/services'),
        api.get<Plan[]>('/membership-plans'),
        api.get<Institution[]>('/institutions'),
      ]);
      setServices(svcRes.data);
      setPlans(planRes.data);
      setInstitutions(instRes.data);

      // Load services for each institution
      const instSvcMap: Record<number, InstitutionService[]> = {};
      await Promise.all(
        instRes.data.map(async (inst) => {
          try {
            const { data } = await api.get<InstitutionService[]>(`/institutions/${inst.id}/services`);
            instSvcMap[inst.id] = data;
          } catch {
            instSvcMap[inst.id] = [];
          }
        })
      );
      setInstServices(instSvcMap);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast(msg); setToastOk(ok);
    setTimeout(() => setToast(''), 3000);
  }

  async function createService() {
    if (!formName.trim()) return;
    setFormLoading(true); setFormError('');
    try {
      await api.post('/services', {
        name:          formName.trim(),
        description:   formDesc.trim() || undefined,
        pricePerVisit: parseFloat(formPrice) || 0,
        walkinPrice:   parseFloat(formWalkin) || 0,
        isDefault:     formDefault,
      });
      showToast('Service created!', true);
      setShowForm(false);
      setFormName(''); setFormDesc(''); setFormPrice('0'); setFormWalkin('0'); setFormDefault(false);
      loadAll();
    } catch (e: any) {
      setFormError(e.response?.data?.error ?? 'Failed to create service');
    } finally {
      setFormLoading(false);
    }
  }

  async function saveEdit() {
    if (!editId || !editName.trim()) return;
    setEditLoading(true); setEditError('');
    try {
      await api.patch(`/services/${editId}`, {
        name:          editName.trim(),
        description:   editDesc.trim() || undefined,
        pricePerVisit: parseFloat(editPrice) || 0,
        walkinPrice:   parseFloat(editWalkin) || 0,
      });
      showToast('Service updated!', true);
      setEditId(null);
      loadAll();
    } catch (e: any) {
      setEditError(e.response?.data?.error ?? 'Failed to update');
    } finally {
      setEditLoading(false);
    }
  }

  async function deactivateService(id: number) {
    try {
      await api.delete(`/services/${id}`);
      showToast('Service deactivated', true);
      loadAll();
    } catch {
      showToast('Failed to deactivate', false);
    }
  }

  async function togglePlanService(planId: number, serviceId: number, currentlyIncluded: boolean) {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    const newServiceIds = currentlyIncluded
      ? plan.services.filter(s => s.id !== serviceId).map(s => s.id)
      : [...plan.services.map(s => s.id), serviceId];

    try {
      await api.patch(`/membership-plans/${planId}/services`, { serviceIds: newServiceIds });
      loadAll();
    } catch {
      showToast('Failed to update plan services', false);
    }
  }

  async function toggleInstService(
    instId: number,
    serviceId: number,
    currentAllowedFor: 'employees' | 'dependents' | 'both' | null
  ) {
    const current = instServices[instId] ?? [];

    let updated: { serviceId: number; allowedFor: 'employees' | 'dependents' | 'both' }[];

    if (currentAllowedFor === null) {
      // Add with default 'both'
      updated = [
        ...current.map(s => ({ serviceId: s.id, allowedFor: s.allowed_for })),
        { serviceId, allowedFor: 'both' as const },
      ];
    } else if (currentAllowedFor === 'both') {
      // Cycle: both → employees → dependents → remove
      updated = current.map(s =>
        s.id === serviceId
          ? { serviceId: s.id, allowedFor: 'employees' as const }
          : { serviceId: s.id, allowedFor: s.allowed_for }
      );
    } else if (currentAllowedFor === 'employees') {
      updated = current.map(s =>
        s.id === serviceId
          ? { serviceId: s.id, allowedFor: 'dependents' as const }
          : { serviceId: s.id, allowedFor: s.allowed_for }
      );
    } else {
      // Remove
      updated = current
        .filter(s => s.id !== serviceId)
        .map(s => ({ serviceId: s.id, allowedFor: s.allowed_for }));
    }

    try {
      await api.patch(`/institutions/${instId}/services`, { services: updated });
      const { data } = await api.get<InstitutionService[]>(`/institutions/${instId}/services`);
      setInstServices(prev => ({ ...prev, [instId]: data }));
    } catch {
      showToast('Failed to update institution services', false);
    }
  }

  function allowedForLabel(af: 'employees' | 'dependents' | 'both' | null): string {
    if (af === null) return '—';
    if (af === 'both') return 'Both';
    if (af === 'employees') return 'Employees';
    return 'Dependents';
  }

  function allowedForClass(af: 'employees' | 'dependents' | 'both' | null): string {
    if (af === null) return s.afNone;
    if (af === 'both') return s.afBoth;
    if (af === 'employees') return s.afEmployees;
    return s.afDependents;
  }

  if (loading) return <div className={pt.formCard}><p className={s.loadingMsg}>Loading services…</p></div>;

  return (
    <div>
      {toast && <div className={`${s.toast} ${toastOk ? s.toastSuccess : s.toastError}`}>{toast}</div>}

      {/* ── SERVICES LIST ── */}
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Gym Services</h2>
        <button type="button" className={s.addBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ Add Service'}
        </button>
      </div>

      {showForm && (
        <div className={pt.formCard}>
          <div className={pt.formTitle}>New Service</div>
          <div className={pt.formRow}>
            <div className={pt.formGroup}>
              <label className={pt.formLabel}>Name *</label>
              <input className={pt.formInput} value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Swimming Pool" />
            </div>
            <div className={pt.formGroup}>
              <label className={pt.formLabel}>Price per visit (0 = included)</label>
              <input className={pt.formInput} type="number" min="0" value={formPrice} onChange={e => setFormPrice(e.target.value)} />
            </div>
          </div>
          <div className={pt.formGroup}>
            <label className={pt.formLabel}>Walk-in day pass price (0 = not available)</label>
            <input className={pt.formInput} type="number" min="0" value={formWalkin} onChange={e => setFormWalkin(e.target.value)} placeholder="e.g. 3000" />
          </div>
          <div className={pt.formGroup}>
            <label className={pt.formLabel}>Description (optional)</label>
            <input className={pt.formInput} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Brief description" />
          </div>
          <div className={pt.formGroup}>
            <label className={s.checkboxLabel}>
              <input type="checkbox" checked={formDefault} onChange={e => setFormDefault(e.target.checked)} />
              <span>Default service (auto-selected on check-in)</span>
            </label>
          </div>
          {formError && <div className={pt.error}>{formError}</div>}
          <button
            type="button"
            className={`${pt.submitBtn} ${(!formName.trim() || formLoading) ? pt.submitBtnDisabled : ''}`}
            onClick={createService}
            disabled={!formName.trim() || formLoading}
          >
            {formLoading ? 'Creating…' : 'Create Service'}
          </button>
        </div>
      )}

      <div className={s.serviceGrid}>
        {services.length === 0 && (
          <div className={s.emptyState}>No services yet. Add your first service above.</div>
        )}
        {services.map(svc => (
          <div key={svc.id} className={s.serviceCard}>
            {editId === svc.id ? (
              <>
                <input className={pt.formInput} value={editName} onChange={e => setEditName(e.target.value)} />
                <input className={`${pt.formInput} ${s.mt8}`} value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" />
                <input className={`${pt.formInput} ${s.mt8}`} type="number" min="0" value={editPrice} onChange={e => setEditPrice(e.target.value)} placeholder="Price per visit" />
                <input className={`${pt.formInput} ${s.mt8}`} type="number" min="0" value={editWalkin} onChange={e => setEditWalkin(e.target.value)} placeholder="Walk-in price (0 = N/A)" />
                {editError && <div className={pt.error}>{editError}</div>}
                <div className={s.cardActions}>
                  <button type="button" className={s.saveBtn} onClick={saveEdit} disabled={editLoading}>
                    {editLoading ? '…' : 'Save'}
                  </button>
                  <button type="button" className={s.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className={s.cardTop}>
                  <span className={s.cardName}>{svc.name}</span>
                  {svc.is_default && <span className={s.defaultBadge}>Default</span>}
                </div>
                {svc.description && <div className={s.cardDesc}>{svc.description}</div>}
                <div className={s.cardPrice}>
                  {svc.price_per_visit > 0
                    ? `${svc.price_per_visit.toLocaleString()} ${svc.currency} / visit`
                    : 'Included in plan'}
                  {svc.walkin_price > 0 && (
                    <span className={s.walkinPriceBadge}>
                      Walk-in: {svc.walkin_price.toLocaleString()} {svc.currency}
                    </span>
                  )}
                </div>
                <div className={s.cardActions}>
                  <button type="button" className={s.editBtn} onClick={() => {
                    setEditId(svc.id);
                    setEditName(svc.name);
                    setEditDesc(svc.description ?? '');
                    setEditPrice(String(svc.price_per_visit));
                    setEditWalkin(String(svc.walkin_price ?? 0));
                    setEditError('');
                  }}>Edit</button>
                  <button type="button" className={s.deactivateBtn} onClick={() => deactivateService(svc.id)}>
                    Deactivate
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── PLAN SERVICES ── */}
      {services.length > 0 && plans.length > 0 && (
        <div className={s.section}>
          <h3 className={s.subSectionTitle}>Plan Services</h3>
          <p className={s.sectionHint}>Check which services are included in each membership plan.</p>
          {plans.map(plan => (
            <div key={plan.id} className={s.planServiceCard}>
              <div className={s.planServiceName}>{plan.name}</div>
              <div className={s.checkboxRow}>
                {services.map(svc => {
                  const included = plan.services.some(ps => ps.id === svc.id);
                  return (
                    <label key={svc.id} className={s.serviceCheckbox}>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => togglePlanService(plan.id, svc.id, included)}
                      />
                      <span>{svc.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── INSTITUTION SERVICES ── */}
      {services.length > 0 && institutions.length > 0 && (
        <div className={s.section}>
          <h3 className={s.subSectionTitle}>Institution Service Access</h3>
          <p className={s.sectionHint}>Control which services each institution covers, and for whom. Click a cell to cycle: Both → Employees → Dependents → Remove.</p>
          {institutions.map(inst => {
            const iSvcs = instServices[inst.id] ?? [];
            return (
              <div key={inst.id} className={s.instServiceCard}>
                <div className={s.instName}>{inst.name}</div>
                <div className={s.instServiceGrid}>
                  <div className={s.instServiceHeader}>Service</div>
                  <div className={s.instServiceHeader}>Access</div>
                  {services.map(svc => {
                    const iSvc = iSvcs.find(is => is.id === svc.id);
                    const af = iSvc ? iSvc.allowed_for : null;
                    return (
                      <>
                        <div key={`n-${svc.id}`} className={s.instServiceCell}>{svc.name}</div>
                        <div key={`v-${svc.id}`} className={s.instServiceCell}>
                          <button
                            type="button"
                            className={`${s.afBtn} ${allowedForClass(af)}`}
                            onClick={() => toggleInstService(inst.id, svc.id, af)}
                          >
                            {allowedForLabel(af)}
                          </button>
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
