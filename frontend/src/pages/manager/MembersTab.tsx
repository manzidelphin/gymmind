import * as XLSX from 'xlsx';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/api';
import { useGym } from '../../hooks/useGym';
import s from './MembersTab.module.css';

interface Member {
  id: number; name: string; phone: string | null; role: string; status: string;
  active_plan_name: string | null; active_plan_type: string | null;
  end_date: string | null; remaining_sessions: number | null;
  institution_name: string | null;
}
interface Plan { id: number; name: string; type: string; duration_days: number | null; sessions: number | null; }
interface Institution { id: number; name: string; }

export default function MembersTab() {
  const { gymSlug } = useGym();
  const navigate = useNavigate();
  const [members,      setMembers]      = useState<Member[]>([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading,      setLoading]      = useState(false);
  const limit = 20;

  // Assign modal
  const [assignTarget, setAssignTarget] = useState<Member | null>(null);
  const [plans,        setPlans]        = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [startDate,    setStartDate]    = useState(new Date().toISOString().slice(0, 10));
  const [assigning,    setAssigning]    = useState(false);
  const [assignError,  setAssignError]  = useState('');

  // Add member modal
  const [showAdd,       setShowAdd]       = useState(false);
  const [institutions,  setInstitutions]  = useState<Institution[]>([]);
  const [newName,       setNewName]       = useState('');
  const [newPhone,      setNewPhone]      = useState('');
  const [newInstId,     setNewInstId]     = useState('');
  const [addLoading,    setAddLoading]    = useState(false);
  const [addError,      setAddError]      = useState('');

  // Import Excel modal
  const [showImport,    setShowImport]    = useState(false);
  const [xlsxRows,      setXlsxRows]      = useState<{name:string; phone?:string; institutionName?:string}[]>([]);
  const [xlsxError,     setXlsxError]     = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult,  setImportResult]  = useState<{created:number; skipped:number; errors:string[]} | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search)       params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/users?${params}`);
      setMembers(data.data);
      setTotal(data.total);
    } catch { /* handled by error boundary */ }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  // Debounce search
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  async function openAssign(member: Member) {
    setAssignTarget(member);
    setAssignError('');
    setSelectedPlan('');
    setStartDate(new Date().toISOString().slice(0, 10));
    if (plans.length === 0) {
      const { data } = await api.get<Plan[]>('/membership-plans');
      setPlans(data);
    }
  }

  async function confirmAssign() {
    if (!assignTarget || !selectedPlan) return;
    setAssigning(true); setAssignError('');
    try {
      await api.post(`/users/${assignTarget.id}/membership`, {
        planId: parseInt(selectedPlan), startDate,
      });
      setAssignTarget(null);
      fetchMembers();
    } catch (e: any) { setAssignError(e.response?.data?.error ?? 'Failed to assign.'); }
    finally { setAssigning(false); }
  }

  async function toggleStatus(member: Member) {
    const newStatus = member.status === 'suspended' ? 'active' : 'suspended';
    await api.patch(`/users/${member.id}`, { status: newStatus });
    fetchMembers();
  }

  async function openAddModal() {
    setNewName(''); setNewPhone(''); setNewInstId(''); setAddError('');
    if (institutions.length === 0) {
      try {
        const { data } = await api.get<Institution[]>('/institutions');
        setInstitutions(data);
      } catch { /* non-critical */ }
    }
    setShowAdd(true);
  }

  async function confirmAddMember() {
    if (!newName.trim()) return;
    setAddLoading(true); setAddError('');
    try {
      const body: Record<string, unknown> = { name: newName.trim() };
      if (newPhone.trim()) body.phone = newPhone.trim();
      if (newInstId) body.institutionId = parseInt(newInstId);
      await api.post('/users', body);
      setShowAdd(false);
      fetchMembers();
    } catch (e: any) {
      setAddError(e.response?.data?.error ?? 'Failed to add member.');
    } finally { setAddLoading(false); }
  }

  function handleXlsxFile(file: File) {
    setXlsxError(''); setXlsxRows([]); setImportResult(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

        if (raw.length === 0) { setXlsxError('The file appears to be empty.'); return; }

        const norm = (k: string) => k.toLowerCase().replace(/[\s_]/g, '');
        const headers = Object.keys(raw[0]).map(k => ({ raw: k, key: norm(k) }));
        const col = (k: string) => headers.find(h => h.key === k || h.key.includes(k))?.raw ?? '';

        const nameCol = col('name') || col('fullname');
        const phoneCol = col('phone') || col('tel') || col('mobile');
        const instCol  = col('institution') || col('company') || col('org');

        if (!nameCol) { setXlsxError('Excel must have a "Name" column.'); return; }

        const rows = raw
          .map(row => {
            const r: { name: string; phone?: string; institutionName?: string } = {
              name: String(row[nameCol] ?? '').trim(),
            };
            if (phoneCol && String(row[phoneCol] ?? '').trim()) r.phone = String(row[phoneCol]).trim();
            if (instCol  && String(row[instCol]  ?? '').trim()) r.institutionName = String(row[instCol]).trim();
            return r;
          })
          .filter(r => r.name);

        setXlsxRows(rows);
      } catch {
        setXlsxError('Could not read the file. Make sure it is a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmImport() {
    if (!xlsxRows.length) return;
    setImportLoading(true);
    try {
      const { data } = await api.post<{created:number; skipped:number; errors:string[]}>('/users/import', { members: xlsxRows });
      setImportResult(data);
      if (data.created > 0) fetchMembers();
    } catch (e: any) {
      setXlsxError(e.response?.data?.error ?? 'Import failed.');
    } finally { setImportLoading(false); }
  }

  function downloadMemberTemplate() {
    const data = [
      { Name: 'Jean Paul Habimana', Phone: '0788100001', Institution: '' },
      { Name: 'Sarah Niyonsaba',    Phone: '0788100002', Institution: 'MMI' },
      { Name: 'Emmanuel Ndayish',   Phone: '',           Institution: '' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.writeFile(wb, 'members_import_template.xlsx');
  }

  const badgeClass = (status: string) => {
    if (status === 'active')    return s.badgeActive;
    if (status === 'suspended') return s.badgeSuspended;
    if (status === 'unclaimed') return s.badgeUnclaimed;
    return s.badgePending;
  };

  function planSummary(m: Member) {
    if (!m.active_plan_name) {
      if (m.institution_name) {
        return <span className={s.planPill}>{m.institution_name} · Corporate</span>;
      }
      return <span className={s.noplan}>No plan</span>;
    }
    let detail = '';
    if (m.active_plan_type === 'time_based' && m.end_date) {
      const days = Math.ceil((new Date(m.end_date).getTime() - Date.now()) / 86400000);
      detail = ` · ${days}d left`;
    } else if (m.active_plan_type === 'session_based') {
      detail = ` · ${m.remaining_sessions ?? 0} sessions`;
    }
    return <span className={s.planPill}>{m.active_plan_name}{detail}</span>;
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      <div className={s.toolbar}>
        <input
          type="search"
          placeholder="Search name or phone…"
          className={s.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search members"
        />
        <select
          className={s.filterSelect}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="unclaimed">Unclaimed</option>
          <option value="pending">Pending</option>
        </select>
        <button type="button" className={s.addBtn} onClick={openAddModal}>
          + Add Member
        </button>
        <button type="button" className={s.importBtn} onClick={() => { setShowImport(true); setXlsxRows([]); setXlsxError(''); setImportResult(null); }}>
          ↑ Import Excel
        </button>
      </div>

      {loading && <p className={s.loadingMsg}>Loading…</p>}

      {!loading && members.length === 0 && (
        <div className={s.empty}>No members found.</div>
      )}

      {!loading && members.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>Name</th>
              <th className={s.th}>Phone</th>
              <th className={s.th}>Role</th>
              <th className={s.th}>Status</th>
              <th className={s.th}>Membership</th>
              <th className={s.th}>Institution</th>
              <th className={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className={s.tr}>
                <td className={s.td}>{m.name}</td>
                <td className={s.td}>{m.phone ?? <span className={s.noplan}>—</span>}</td>
                <td className={s.td}>{m.role.replace('_', ' ')}</td>
                <td className={s.td}>
                  <span className={`${s.badge} ${badgeClass(m.status)}`}>{m.status}</span>
                </td>
                <td className={s.td}>{planSummary(m)}</td>
                <td className={s.td}>{m.institution_name ?? <span className={s.noplan}>—</span>}</td>
                <td className={s.td}>
                  <button
                    type="button"
                    className={`${s.actionBtn} ${s.viewBtn}`}
                    onClick={() => navigate(`/${gymSlug}/member?userId=${m.id}`)}
                  >
                    View
                  </button>
                  <button type="button" className={`${s.actionBtn} ${s.assignBtn}`} onClick={() => openAssign(m)}>
                    Assign Plan
                  </button>
                  <button
                    type="button"
                    className={`${s.actionBtn} ${m.status === 'suspended' ? s.activateBtn : s.suspendBtn}`}
                    onClick={() => toggleStatus(m)}
                  >
                    {m.status === 'suspended' ? 'Activate' : 'Suspend'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={s.pagination}>
        <span>Showing {members.length} of {total}</span>
        <div className={s.pageGroup}>
          <button
            type="button"
            className={`${s.pageBtn} ${page <= 1 ? s.pageBtnDisabled : ''}`}
            onClick={() => setPage(p => p - 1)}
            disabled={page <= 1}
          >
            ← Prev
          </button>
          <span className={s.pageCurrent}>Page {page} / {totalPages || 1}</span>
          <button
            type="button"
            className={`${s.pageBtn} ${page >= totalPages ? s.pageBtnDisabled : ''}`}
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Import Excel Modal */}
      {showImport && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && setShowImport(false)}>
          <div className={s.modal}>
            <p className={s.modalTitle}>Import Members from Excel</p>
            <p className={s.modalSub}>
              Columns: <strong>Name</strong> (required), <strong>Phone</strong>, <strong>Institution</strong> (optional).
            </p>

            {!importResult && (
              <>
                <div className={s.templateRow}>
                  <span />
                  <button type="button" className={s.templateBtn} onClick={downloadMemberTemplate}>
                    ↓ Download template
                  </button>
                </div>

                <label htmlFor="xlsx-member-file" className={s.csvDropZone}>
                  <span className={s.csvDropIcon}>📊</span>
                  <span>
                    {xlsxRows.length > 0
                      ? `${xlsxRows.length} row${xlsxRows.length !== 1 ? 's' : ''} parsed`
                      : 'Click to choose an Excel file (.xlsx)'}
                  </span>
                  <input
                    id="xlsx-member-file"
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className={s.csvFileInput}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleXlsxFile(f); }}
                  />
                </label>

                {xlsxError && <p className={s.modalError}>{xlsxError}</p>}

                {xlsxRows.length > 0 && (
                  <>
                    <p className={s.csvCount}>{xlsxRows.length} row{xlsxRows.length !== 1 ? 's' : ''} — preview:</p>
                    <div className={s.csvPreview}>
                      <table className={s.csvTable}>
                        <thead>
                          <tr>
                            <th className={s.csvTh}>Name</th>
                            <th className={s.csvTh}>Phone</th>
                            <th className={s.csvTh}>Institution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {xlsxRows.slice(0, 8).map((r, i) => (
                            <tr key={i}>
                              <td className={s.csvTd}>{r.name}</td>
                              <td className={s.csvTd}>{r.phone ?? <span className={s.noplan}>—</span>}</td>
                              <td className={s.csvTd}>{r.institutionName ?? <span className={s.noplan}>—</span>}</td>
                            </tr>
                          ))}
                          {xlsxRows.length > 8 && (
                            <tr>
                              <td className={s.csvTdMore} colSpan={3}>+{xlsxRows.length - 8} more rows…</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className={s.modalActions}>
                  <button type="button" className={s.modalCancel} onClick={() => setShowImport(false)}>Cancel</button>
                  <button
                    type="button"
                    className={`${s.modalConfirm} ${(!xlsxRows.length || importLoading) ? s.modalConfirmDisabled : ''}`}
                    onClick={confirmImport}
                    disabled={!xlsxRows.length || importLoading}
                  >
                    {importLoading ? 'Importing…' : `Import ${xlsxRows.length} member${xlsxRows.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </>
            )}

            {importResult && (
              <>
                <div className={s.importSummary}>
                  <div className={s.importStat}>
                    <span className={s.importStatNum}>{importResult.created}</span>
                    <span className={s.importStatLabel}>Created</span>
                  </div>
                  <div className={s.importStat}>
                    <span className={`${s.importStatNum} ${s.importStatSkipped}`}>{importResult.skipped}</span>
                    <span className={s.importStatLabel}>Skipped</span>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <ul className={s.importErrors}>
                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
                <button type="button" className={s.modalConfirm} onClick={() => setShowImport(false)}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAdd && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className={s.modal}>
            <p className={s.modalTitle}>Add Member</p>
            <p className={s.modalSub}>Leave phone blank to create an unclaimed account the member activates themselves.</p>

            <label htmlFor="new-name" className={s.formLabel}>Full name *</label>
            <input
              id="new-name"
              type="text"
              placeholder="e.g. Alice Uwimana"
              className={s.formInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />

            <label htmlFor="new-phone" className={s.formLabel}>Phone (optional)</label>
            <input
              id="new-phone"
              type="tel"
              placeholder="07XX XXX XXX"
              className={s.formInput}
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
            />

            {institutions.length > 0 && (
              <>
                <label htmlFor="new-inst" className={s.formLabel}>Institution (optional)</label>
                <select
                  id="new-inst"
                  className={s.formSelect}
                  value={newInstId}
                  onChange={e => setNewInstId(e.target.value)}
                >
                  <option value="">No institution</option>
                  {institutions.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </>
            )}

            {addError && <p className={s.modalError}>{addError}</p>}

            <div className={s.modalActions}>
              <button type="button" className={s.modalCancel} onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                type="button"
                className={`${s.modalConfirm} ${(!newName.trim() || addLoading) ? s.modalConfirmDisabled : ''}`}
                onClick={confirmAddMember}
                disabled={!newName.trim() || addLoading}
              >
                {addLoading ? 'Adding…' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Membership Modal */}
      {assignTarget && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && setAssignTarget(null)}>
          <div className={s.modal}>
            <p className={s.modalTitle}>Assign Membership</p>
            <p className={s.modalSub}>{assignTarget.name} · {assignTarget.phone}</p>

            <label htmlFor="plan-select" className={s.formLabel}>Plan</label>
            <select
              id="plan-select"
              className={s.formSelect}
              value={selectedPlan}
              onChange={e => setSelectedPlan(e.target.value)}
            >
              <option value="">Select a plan…</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.type === 'time_based' ? `${p.duration_days} days` : `${p.sessions} sessions`}
                </option>
              ))}
            </select>

            <label htmlFor="start-date" className={s.formLabel}>Start date</label>
            <input
              id="start-date"
              type="date"
              className={s.formInput}
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />

            {assignError && <p className={s.modalError}>{assignError}</p>}

            <div className={s.modalActions}>
              <button type="button" className={s.modalCancel} onClick={() => setAssignTarget(null)}>Cancel</button>
              <button
                type="button"
                className={`${s.modalConfirm} ${(!selectedPlan || assigning) ? s.modalConfirmDisabled : ''}`}
                onClick={confirmAssign}
                disabled={!selectedPlan || assigning}
              >
                {assigning ? 'Assigning…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
