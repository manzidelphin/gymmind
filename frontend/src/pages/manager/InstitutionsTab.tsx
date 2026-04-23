import * as XLSX from 'xlsx';
import { useEffect, useRef, useState } from 'react';
import api from '../../api/api';
import PhoneInput from '../../components/PhoneInput';
import s from './InstitutionsTab.module.css';

interface HrAdmin {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

interface Institution {
  id: number; name: string; allows_dependents: boolean;
  rate_per_session: number; employee_count: number; member_count: number;
  slug: string | null; admin_phone: string | null; admin_name: string | null;
  hr_admins: HrAdmin[];
}

interface Employee { name: string; phone?: string; dependents: { name: string }[]; }

function parseExcelFile(file: File): Promise<{ employees: Employee[]; error?: string }> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

        if (rows.length === 0) {
          resolve({ employees: [], error: 'The file appears to be empty.' });
          return;
        }

        // Normalise header names: lowercase, strip spaces/underscores
        const norm = (k: string) => k.toLowerCase().replace(/[\s_]/g, '');
        const firstRow = rows[0];
        const headers = Object.keys(firstRow).map(k => ({ raw: k, key: norm(k) }));
        const col = (k: string) => headers.find(h => h.key === k || h.key.includes(k))?.raw ?? '';

        const nameCol   = col('name');
        const phoneCol  = col('phone') || col('tel') || col('mobile');
        const parentCol = col('parentname') || col('parent') || col('parentmember');

        if (!nameCol) {
          resolve({ employees: [], error: 'Excel must have a "Name" column.' });
          return;
        }

        // Build employee map: name → Employee
        const empMap = new Map<string, Employee>();
        const ordered: Employee[] = [];

        for (const row of rows) {
          const name   = String(row[nameCol] ?? '').trim();
          const phone  = phoneCol ? String(row[phoneCol] ?? '').trim() : '';
          const parent = parentCol ? String(row[parentCol] ?? '').trim() : '';

          if (!name) continue;

          if (parent) {
            // This is a dependent — find or create the parent employee
            const parentEmp = empMap.get(parent.toLowerCase());
            if (parentEmp) {
              parentEmp.dependents.push({ name });
            }
            // If parent not found yet, skip (they must come before the dependent)
          } else {
            // This is a primary employee
            const emp: Employee = { name, dependents: [] };
            if (phone) emp.phone = phone;
            empMap.set(name.toLowerCase(), emp);
            ordered.push(emp);
          }
        }

        resolve({ employees: ordered });
      } catch {
        resolve({ employees: [], error: 'Could not read the file. Make sure it is a valid .xlsx file.' });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function downloadTemplate(allowsDependents: boolean) {
  const data = allowsDependents
    ? [
        { Name: 'GAKWISI Alphonse', Phone: '0788100001', 'Parent Name': '' },
        { Name: 'Delphin Manzi',    Phone: '',            'Parent Name': 'GAKWISI Alphonse' },
        { Name: 'Eric Manzi',       Phone: '',            'Parent Name': 'GAKWISI Alphonse' },
        { Name: 'Alice Mutesi',     Phone: '0788100002',  'Parent Name': '' },
      ]
    : [
        { Name: 'Jean Paul Habimana', Phone: '0788100001' },
        { Name: 'Sarah Niyonsaba',    Phone: '0788100002' },
        { Name: 'Emmanuel Ndayishimiye', Phone: '' },
      ];

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  XLSX.writeFile(wb, 'members_template.xlsx');
}

export default function InstitutionsTab() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading,      setLoading]      = useState(false);

  // Create form
  const [showCreate,    setShowCreate]    = useState(false);
  const [newName,       setNewName]       = useState('');
  const [newAllowsDeps, setNewAllowsDeps] = useState(false);
  const [newRate,       setNewRate]       = useState('0');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError,   setCreateError]   = useState('');

  // Inline rate editing
  const [editRateId,    setEditRateId]    = useState<number | null>(null);
  const [editRateValue, setEditRateValue] = useState('');
  const rateInputRef = useRef<HTMLInputElement>(null);

  // Invite admin modal
  const [inviteInst,      setInviteInst]      = useState<Institution | null>(null);
  const [inviteName,      setInviteName]      = useState('');
  const [invitePhone,     setInvitePhone]     = useState('');
  const [invitePhoneOk,   setInvitePhoneOk]   = useState(false);
  const [inviteLoading,   setInviteLoading]   = useState(false);
  const [inviteError,     setInviteError]     = useState('');
  const [inviteResult,    setInviteResult]    = useState<{ portalUrl: string; slug: string } | null>(null);

  // Add HR admin modal
  const [addAdminInst,    setAddAdminInst]    = useState<Institution | null>(null);
  const [addAdminName,    setAddAdminName]    = useState('');
  const [addAdminPhone,   setAddAdminPhone]   = useState('');
  const [addAdminPhoneOk, setAddAdminPhoneOk] = useState(false);
  const [addAdminEmail,   setAddAdminEmail]   = useState('');
  const [addAdminLoading, setAddAdminLoading] = useState(false);
  const [addAdminError,   setAddAdminError]   = useState('');

  // Upload modal
  const [uploadInst,    setUploadInst]    = useState<Institution | null>(null);
  const [uploadParsed,  setUploadParsed]  = useState<Employee[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult,  setUploadResult]  = useState<{created:number;skipped:number;errors:string[]} | null>(null);
  const [uploadError,   setUploadError]   = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchInstitutions() {
    setLoading(true);
    try {
      const { data } = await api.get<Institution[]>('/institutions');
      setInstitutions(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchInstitutions(); }, []);

  async function createInstitution() {
    if (!newName.trim()) return;
    setCreateLoading(true); setCreateError('');
    try {
      await api.post('/institutions', {
        name: newName.trim(),
        allows_dependents: newAllowsDeps,
        rate_per_session: parseFloat(newRate) || 0,
      });
      setShowCreate(false); setNewName(''); setNewAllowsDeps(false); setNewRate('0');
      fetchInstitutions();
    } catch (e: any) {
      setCreateError(e.response?.data?.error ?? 'Failed to create institution.');
    } finally { setCreateLoading(false); }
  }

  function startEditRate(inst: Institution) {
    setEditRateId(inst.id);
    setEditRateValue(String(inst.rate_per_session));
    setTimeout(() => rateInputRef.current?.focus(), 50);
  }

  async function saveRate(instId: number) {
    const rate = parseFloat(editRateValue);
    if (isNaN(rate)) { setEditRateId(null); return; }
    await api.patch(`/institutions/${instId}`, { rate_per_session: rate });
    setEditRateId(null);
    fetchInstitutions();
  }


  async function confirmInvite() {
    if (!inviteInst || !inviteName.trim() || !invitePhoneOk) return;
    setInviteLoading(true); setInviteError('');
    try {
      const { data } = await api.post(`/institutions/${inviteInst.id}/invite-admin`, {
        adminName:  inviteName.trim(),
        adminPhone: invitePhone,
      });
      setInviteResult(data);
      fetchInstitutions();
    } catch (e: any) {
      setInviteError(e.response?.data?.error ?? 'Failed to invite admin.');
    } finally { setInviteLoading(false); }
  }

  function openAddAdmin(inst: Institution) {
    setAddAdminInst(inst);
    setAddAdminName('');
    setAddAdminPhone('');
    setAddAdminPhoneOk(false);
    setAddAdminEmail('');
    setAddAdminError('');
  }

  async function confirmAddAdmin() {
    if (!addAdminInst || !addAdminName.trim() || !addAdminPhoneOk) return;
    setAddAdminLoading(true); setAddAdminError('');
    try {
      await api.post(`/institutions/${addAdminInst.id}/hr-admins`, {
        name:  addAdminName.trim(),
        phone: addAdminPhone,
        email: addAdminEmail.trim() || undefined,
      });
      setAddAdminInst(null);
      fetchInstitutions();
    } catch (e: any) {
      setAddAdminError(e.response?.data?.error ?? 'Failed to add HR admin.');
    } finally { setAddAdminLoading(false); }
  }

  const [deleteTarget, setDeleteTarget] = useState<Institution | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function deleteInstitution(inst: Institution) {
    setDeleteTarget(inst);
    setDeleteConfirmText('');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/institutions/${deleteTarget.id}`);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      fetchInstitutions();
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed to delete institution.');
    } finally { setDeleting(false); }
  }

  function openUpload(inst: Institution) {
    setUploadInst(inst); setUploadParsed([]);
    setUploadResult(null); setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    const { employees, error } = await parseExcelFile(file);
    if (error) { setUploadError(error); setUploadParsed([]); return; }
    setUploadParsed(employees);
  }

  async function confirmUpload() {
    if (!uploadInst || uploadParsed.length === 0) return;
    setUploadLoading(true); setUploadError('');
    try {
      const { data } = await api.post(`/institutions/${uploadInst.id}/upload-members`, {
        employees: uploadParsed,
      });
      setUploadResult(data);
      fetchInstitutions();
    } catch (e: any) {
      setUploadError(e.response?.data?.error ?? 'Upload failed.');
    } finally { setUploadLoading(false); }
  }

  const totalDeps = uploadParsed.reduce((n, e) => n + e.dependents.length, 0);

  return (
    <div>
      {/* Toolbar */}
      <div className={s.toolbar}>
        <h2 className={s.heading}>Institutions</h2>
        <button type="button" className={s.createBtn} onClick={() => { setShowCreate(true); setCreateError(''); }}>
          + New Institution
        </button>
      </div>

      {loading && <div className={s.loadingMsg}>Loading…</div>}

      {!loading && institutions.length === 0 && (
        <div className={s.empty}>No institutions yet. Create one to get started.</div>
      )}

      {institutions.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>Name</th>
              <th className={s.th}>Type</th>
              <th className={s.th}>Employees</th>
              <th className={s.th}>Total Members</th>
              <th className={s.th}>Rate / Session (RWF)</th>
              <th className={s.th}>Admin</th>
              <th className={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {institutions.map(inst => (
              <tr key={inst.id} className={s.tr}>
                <td className={s.td}><span className={s.instName}>{inst.name}</span></td>
                <td className={s.td}>
                  <span className={inst.allows_dependents ? s.badgeDeps : s.badgeEmp}>
                    {inst.allows_dependents ? 'Employee + Dependents' : 'Employee Only'}
                  </span>
                </td>
                <td className={s.td}>{inst.employee_count}</td>
                <td className={s.td}>{inst.member_count}</td>
                <td className={s.td}>
                  {editRateId === inst.id ? (
                    <div className={s.rateEdit}>
                      <input
                        ref={rateInputRef} type="number" min="0" step="100"
                        value={editRateValue}
                        onChange={e => setEditRateValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRate(inst.id); if (e.key === 'Escape') setEditRateId(null); }}
                        className={s.rateInput}
                      />
                      <button type="button" className={s.rateSaveBtn} onClick={() => saveRate(inst.id)}>✓</button>
                      <button type="button" className={s.rateCancelBtn} onClick={() => setEditRateId(null)}>✕</button>
                    </div>
                  ) : (
                    <button type="button" className={s.rateBtn} onClick={() => startEditRate(inst)}>
                      {inst.rate_per_session > 0 ? inst.rate_per_session.toLocaleString() : '—'}
                      <span className={s.rateEdit_icon}>✎</span>
                    </button>
                  )}
                </td>
                <td className={s.td}>
                  <div className={s.hrAdminCell}>
                    {inst.hr_admins.length > 0 ? (
                      <div className={s.hrAdminList}>
                        {inst.hr_admins.map(a => (
                          <div key={a.id} className={s.hrAdminRow}>
                            <span className={s.hrAdminName}>{a.name}</span>
                            {a.phone && <span className={s.hrAdminPhone}>{a.phone}</span>}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button type="button" className={s.addAdminBtn} onClick={() => openAddAdmin(inst)}>
                      + Add HR Admin
                    </button>
                  </div>
                </td>
                <td className={s.td}>
                  <button type="button" className={s.uploadBtn} onClick={() => openUpload(inst)}>
                    ↑ Upload Members
                  </button>
                  <button type="button" onClick={() => deleteInstitution(inst)}
                    style={{marginTop:'6px',display:'block',width:'100%',padding:'6px 10px',background:'#fff',color:'#ef4444',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                    🗑 Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create Institution Modal */}
      {showCreate && (
        <div className={s.overlay} onClick={() => setShowCreate(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <p className={s.modalTitle}>New Institution</p>
            <label className={s.formLabel}>Name</label>
            <input type="text" placeholder="e.g. MMI, BK Rwanda…"
              value={newName} onChange={e => setNewName(e.target.value)}
              className={s.formInput}
              onKeyDown={e => e.key === 'Enter' && createInstitution()}
              autoFocus
            />
            <label className={s.formLabel}>Rate per Session (RWF)</label>
            <input type="number" min="0" step="100" placeholder="0"
              value={newRate} onChange={e => setNewRate(e.target.value)}
              className={s.formInput}
            />
            <label className={s.checkLabel}>
              <input type="checkbox" checked={newAllowsDeps}
                onChange={e => setNewAllowsDeps(e.target.checked)}
                className={s.checkbox}
              />
              Allow dependents (family members)
            </label>
            {createError && <div className={s.modalError}>{createError}</div>}
            <div className={s.modalActions}>
              <button type="button" className={s.modalConfirm}
                disabled={!newName.trim() || createLoading}
                onClick={createInstitution}
              >
                {createLoading ? 'Creating…' : 'Create'}
              </button>
              <button type="button" className={s.modalCancel} onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Admin Modal */}
      {inviteInst && (
        <div className={s.overlay} onClick={() => setInviteInst(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <p className={s.modalTitle}>Invite {inviteInst.name} Admin</p>
            {!inviteResult ? (
              <>
                <label className={s.formLabel}>Admin name</label>
                <input
                  type="text"
                  placeholder="e.g. Jean Paul Habimana"
                  className={s.formInput}
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  autoFocus
                />
                <label className={s.formLabel}>Admin phone</label>
                <PhoneInput
                  value={invitePhone}
                  onChange={(v, valid) => { setInvitePhone(v); setInvitePhoneOk(valid); }}
                  inputClassName={s.formInput}
                  onEnter={confirmInvite}
                />
                {inviteError && <div className={s.modalError}>{inviteError}</div>}
                <div className={s.modalActions}>
                  <button
                    type="button"
                    className={s.modalConfirm}
                    disabled={!inviteName.trim() || !invitePhoneOk || inviteLoading}
                    onClick={confirmInvite}
                  >
                    {inviteLoading ? 'Sending…' : 'Send Invitation'}
                  </button>
                  <button type="button" className={s.modalCancel} onClick={() => setInviteInst(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={s.inviteSuccess}>
                  <p>Portal ready at:</p>
                  <code className={s.portalUrl}>gymmind.rw/institution/{inviteResult.slug}</code>
                  <p style={{ fontSize: '13px', color: '#64748b', marginTop: '8px' }}>
                    Share this URL with the admin. They log in with their phone number.
                  </p>
                </div>
                <button type="button" className={s.modalConfirm} onClick={() => setInviteInst(null)}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add HR Admin Modal */}
      {addAdminInst && (
        <div className={s.overlay} onClick={() => setAddAdminInst(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <p className={s.modalTitle}>Add HR Admin — {addAdminInst.name}</p>
            <label className={s.formLabel}>Name</label>
            <input
              type="text"
              placeholder="e.g. Jean Paul Habimana"
              className={s.formInput}
              value={addAdminName}
              onChange={e => setAddAdminName(e.target.value)}
              autoFocus
            />
            <label className={s.formLabel}>Phone</label>
            <PhoneInput
              value={addAdminPhone}
              onChange={(v, valid) => { setAddAdminPhone(v); setAddAdminPhoneOk(valid); }}
              inputClassName={s.formInput}
              onEnter={confirmAddAdmin}
            />
            <label className={s.formLabel}>Email (optional)</label>
            <input
              type="email"
              placeholder="admin@company.com"
              className={s.formInput}
              value={addAdminEmail}
              onChange={e => setAddAdminEmail(e.target.value)}
            />
            {addAdminError && <div className={s.modalError}>{addAdminError}</div>}
            <div className={s.modalActions}>
              <button
                type="button"
                className={s.modalConfirm}
                disabled={!addAdminName.trim() || !addAdminPhoneOk || addAdminLoading}
                onClick={confirmAddAdmin}
              >
                {addAdminLoading ? 'Adding…' : 'Add HR Admin'}
              </button>
              <button type="button" className={s.modalCancel} onClick={() => setAddAdminInst(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Members Modal */}
      {uploadInst && (
        <div className={s.overlay} onClick={() => setUploadInst(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <p className={s.modalTitle}>Upload Members — {uploadInst.name}</p>

            {!uploadResult ? (
              <>
                {/* Template download */}
                <div className={s.templateRow}>
                  <span className={s.templateHint}>
                    Excel columns: <strong>Name</strong>, <strong>Phone</strong>
                    {uploadInst.allows_dependents && <>, <strong>Parent Name</strong> (for dependents)</>}
                  </span>
                  <button type="button" className={s.templateBtn}
                    onClick={() => downloadTemplate(uploadInst.allows_dependents)}>
                    ↓ Download template
                  </button>
                </div>

                {/* File drop zone */}
                <label className={s.dropZone} htmlFor="xlsx-upload">
                  <span className={s.dropIcon}>📊</span>
                  <span className={s.dropText}>
                    {uploadParsed.length > 0
                      ? `${uploadParsed.length} employee${uploadParsed.length !== 1 ? 's' : ''} parsed`
                      : 'Click to select an Excel file (.xlsx)'}
                  </span>
                  <span className={s.dropSub}>Accepts .xlsx and .xls</span>
                  <input
                    id="xlsx-upload"
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className={s.fileInput}
                    onChange={handleFileChange}
                  />
                </label>

                {/* Preview */}
                {uploadParsed.length > 0 && (
                  <div className={s.previewWrap}>
                    <p className={s.previewCount}>
                      {uploadParsed.length} employee{uploadParsed.length !== 1 ? 's' : ''}
                      {totalDeps > 0 && `, ${totalDeps} dependent${totalDeps !== 1 ? 's' : ''}`}
                    </p>
                    <div className={s.previewList}>
                      {uploadParsed.slice(0, 8).map((emp, i) => (
                        <div key={i} className={s.previewEmp}>
                          <span className={s.previewEmpName}>👤 {emp.name}{emp.phone && ` · ${emp.phone}`}</span>
                          {emp.dependents.map((d, j) => (
                            <span key={j} className={s.previewDep}>↳ {d.name}</span>
                          ))}
                        </div>
                      ))}
                      {uploadParsed.length > 8 && (
                        <p className={s.previewMore}>…and {uploadParsed.length - 8} more employees</p>
                      )}
                    </div>
                  </div>
                )}

                {uploadError && <div className={s.modalError}>{uploadError}</div>}
                <div className={s.modalActions}>
                  <button type="button" className={s.modalConfirm}
                    disabled={uploadParsed.length === 0 || uploadLoading}
                    onClick={confirmUpload}
                  >
                    {uploadLoading ? 'Uploading…' : `Upload ${uploadParsed.length > 0 ? uploadParsed.length + ' employees' : ''}`}
                  </button>
                  <button type="button" className={s.modalCancel} onClick={() => setUploadInst(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={s.resultSummary}>
                  <div className={s.resultStat}>
                    <span className={s.resultNum}>{uploadResult.created}</span>
                    <span className={s.resultLabel}>Created</span>
                  </div>
                  <div className={s.resultStat}>
                    <span className={`${s.resultNum} ${s.resultNumSkipped}`}>{uploadResult.skipped}</span>
                    <span className={s.resultLabel}>Skipped</span>
                  </div>
                </div>
                {uploadResult.errors.length > 0 && (
                  <ul className={s.uploadErrors}>
                    {uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
                <button type="button" className={s.modalConfirm} onClick={() => setUploadInst(null)}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
