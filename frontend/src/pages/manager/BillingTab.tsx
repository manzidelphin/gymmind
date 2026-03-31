import { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../../api/api';
import { useToast } from '../../context/ToastContext';
import s from './BillingTab.module.css';

interface InstitutionBilling {
  id: number;
  name: string;
  rate_per_session: number;
  active_members: number;
  total_visits: number;
  calculated_amount: number;
  payment_id: number | null;
  payment_status: 'pending' | 'sent' | 'paid' | 'overdue' | null;
  paid_at: string | null;
  sent_at: string | null;
  paid_amount: number | null;
  payment_reference: string | null;
}

interface BreakdownRow {
  user_id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  service_id: number | null;
  service_name: string | null;
  service_price: number | null;
  visit_count: number;
  subtotal: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function isOverdue(inst: InstitutionBilling, month: string): boolean {
  if (inst.payment_status === 'paid') return false;
  const [y, m] = month.split('-').map(Number);
  return new Date() > new Date(y, m, 5); // after 5th of next month
}

export default function BillingTab() {
  const toast = useToast();

  const [month,        setMonth]        = useState(currentMonth());
  const [institutions, setInstitutions] = useState<InstitutionBilling[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  const [breakdown,        setBreakdown]        = useState<Record<number, BreakdownRow[]>>({});
  const [breakdownLoading, setBreakdownLoading] = useState<Record<number, boolean>>({});
  const [expanded,         setExpanded]         = useState<Set<number>>(new Set());

  // Send-to-HR state
  const [sendingToHr, setSendingToHr] = useState<Record<number, boolean>>({});

  // Mark-as-paid modal state
  const [modalInst, setModalInst] = useState<InstitutionBilling | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payRef,    setPayRef]    = useState('');
  const [payNotes,  setPayNotes]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState('');

  async function load(m: string) {
    setLoading(true); setError('');
    try {
      const { data } = await api.get<{ month: string; institutions: InstitutionBilling[] }>(
        `/billing/institutions?month=${m}`,
      );
      setInstitutions(data.institutions);
    } catch {
      setError('Failed to load billing data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setExpanded(new Set());
    setBreakdown({});
    load(month);
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleBreakdown(inst: InstitutionBilling) {
    if (expanded.has(inst.id)) {
      setExpanded(prev => { const n = new Set(prev); n.delete(inst.id); return n; });
      return;
    }
    setExpanded(prev => new Set(prev).add(inst.id));
    if (breakdown[inst.id]) return;
    setBreakdownLoading(prev => ({ ...prev, [inst.id]: true }));
    try {
      const { data } = await api.get<{ breakdown: BreakdownRow[] }>(
        `/billing/institutions/${inst.id}/breakdown?month=${month}`,
      );
      setBreakdown(prev => ({ ...prev, [inst.id]: data.breakdown }));
    } finally {
      setBreakdownLoading(prev => ({ ...prev, [inst.id]: false }));
    }
  }

  function openModal(inst: InstitutionBilling) {
    setModalInst(inst);
    setPayAmount(String(inst.calculated_amount));
    setPayRef('');
    setPayNotes('');
    setSaveError('');
  }

  async function sendToHr(inst: InstitutionBilling) {
    setSendingToHr(prev => ({ ...prev, [inst.id]: true }));
    try {
      const { data } = await api.post<{ success: boolean; sentTo: string[] }>(
        '/billing/send-to-hr',
        { institutionId: inst.id, month },
      );
      const phones = data.sentTo.join(', ');
      toast.success('Invoice sent to HR', `Sent to ${phones} via SMS ✅`);
      load(month);
    } catch (e: any) {
      const msg = e.response?.data?.error ?? 'Failed to send invoice to HR.';
      if (msg.toLowerCase().includes('no hr admin')) {
        toast.error('No HR admin found', `Add an HR admin to ${inst.name} first in the Institutions page`);
      } else {
        toast.error('Send failed', msg);
      }
    } finally {
      setSendingToHr(prev => ({ ...prev, [inst.id]: false }));
    }
  }

  async function submitPayment() {
    if (!modalInst) return;
    setSaving(true); setSaveError('');
    try {
      await api.post(`/billing/institutions/${modalInst.id}/mark-paid`, {
        month,
        totalAmount:      Number(payAmount),
        paymentReference: payRef   || undefined,
        notes:            payNotes || undefined,
      });
      setModalInst(null);
      load(month);
    } catch {
      setSaveError('Failed to record payment. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function generateInvoicePdf(inst: InstitutionBilling) {
    const monthLabel    = formatMonth(month);
    const generatedAt   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const invoiceNumber = `INV-${month.replace('-', '')}-${inst.id}`;
    const status        = effectiveStatus(inst);

    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const lm    = 20;
    const rm    = 190;
    const GREEN: [number, number, number] = [15, 110, 86];
    const GRAY:  [number, number, number] = [100, 116, 139];
    const DARK:  [number, number, number] = [15, 23, 42];

    let y = 20;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...GREEN);
    doc.text('GymMind', lm, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...GRAY);
    doc.text('INVOICE', rm, y, { align: 'right' });
    y += 6;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.line(lm, y, rm, y);
    y += 8;

    // Invoice meta
    const meta: [string, string][] = [
      ['Invoice #:',   invoiceNumber],
      ['To:',          inst.name],
      ['Period:',      monthLabel],
      ['Generated:',   generatedAt],
      ['Status:',      status.toUpperCase()],
    ];
    doc.setFontSize(10);
    for (const [label, value] of meta) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
      doc.text(label, lm, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);
      doc.text(value, lm + 36, y);
      y += 6;
    }
    y += 4;

    // Table
    autoTable(doc, {
      startY: y,
      head: [['DESCRIPTION', 'VISITS', 'RATE (RWF)', 'AMOUNT (RWF)']],
      body: [
        [
          `Gym access — ${monthLabel}`,
          String(inst.total_visits),
          inst.rate_per_session > 0 ? inst.rate_per_session.toLocaleString() : '—',
          inst.calculated_amount.toLocaleString(),
        ],
        ['TOTAL', '', '', inst.calculated_amount.toLocaleString()],
      ],
      margin: { left: lm, right: 20 },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 4, textColor: [55, 65, 81] },
      headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 80 }, 3: { halign: 'right' } },
      didParseCell(data) {
        if (data.row.index === 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [229, 231, 235];
          data.cell.styles.textColor = DARK;
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterY = (doc as any).lastAutoTable.finalY + 10;

    if (inst.payment_status === 'paid' && inst.paid_at) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GREEN);
      doc.text(`PAID on ${new Date(inst.paid_at).toLocaleDateString('en-GB')}${inst.payment_reference ? ` · Ref: ${inst.payment_reference}` : ''}`, lm, afterY);
    }

    // Footer
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(lm, 277, rm, 277);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`${inst.name} · ${monthLabel}`, lm, 282);
    doc.text('gymmind.rw', pageW / 2, 282, { align: 'center' });
    doc.text(generatedAt, rm, 282, { align: 'right' });

    doc.save(`Invoice-${inst.name.replace(/\s+/g, '-')}-${month}.pdf`);
  }

  function effectiveStatus(inst: InstitutionBilling): 'paid' | 'pending' | 'sent' | 'overdue' {
    if (inst.payment_status === 'paid') return 'paid';
    if (isOverdue(inst, month)) return 'overdue';
    if (inst.payment_status === 'sent') return 'sent';
    return 'pending';
  }

  const totalDue        = institutions.reduce((sum, i) => sum + i.calculated_amount, 0);
  const totalCollected  = institutions
    .filter(i => i.payment_status === 'paid')
    .reduce((sum, i) => sum + (i.paid_amount ?? i.calculated_amount), 0);
  const totalOutstanding = Math.max(0, totalDue - totalCollected);
  const isCurrentMonth   = month === currentMonth();

  return (
    <div className={s.section}>
      {/* Header */}
      <div className={s.header}>
        <h3 className={s.title}>Institutional Billing</h3>
        <div className={s.monthNav}>
          <button type="button" className={s.monthBtn} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <span className={s.monthLabel}>{formatMonth(month)}</span>
          <button
            type="button"
            className={s.monthBtn}
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={isCurrentMonth}
          >›</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className={s.summaryGrid}>
        <div className={`${s.summaryCard} ${s.cardBlue}`}>
          <div className={s.summaryNum}>{totalDue.toLocaleString()} RWF</div>
          <div className={s.summaryLabel}>Total due this month</div>
        </div>
        <div className={`${s.summaryCard} ${s.cardGreen}`}>
          <div className={s.summaryNum}>{totalCollected.toLocaleString()} RWF</div>
          <div className={s.summaryLabel}>Total collected</div>
        </div>
        <div className={`${s.summaryCard} ${s.cardAmber}`}>
          <div className={s.summaryNum}>{totalOutstanding.toLocaleString()} RWF</div>
          <div className={s.summaryLabel}>Outstanding</div>
        </div>
      </div>

      {loading && <p className={s.empty}>Loading…</p>}
      {!loading && institutions.length === 0 && (
        <p className={s.empty}>{error || 'No invoices yet. Add an institution to get started.'}</p>
      )}

      {!loading && institutions.map(inst => {
        const status     = effectiveStatus(inst);
        const isExpanded = expanded.has(inst.id);
        const bd         = breakdown[inst.id] ?? [];
        const bdLoading  = breakdownLoading[inst.id] ?? false;

        return (
          <div key={inst.id} className={s.instCard}>
            <div className={s.instCardHeader}>
              <div>
                <div className={s.instName}>{inst.name}</div>
                <div className={s.instMeta}>
                  {inst.active_members} active member{inst.active_members !== 1 ? 's' : ''} · {inst.total_visits} visit{inst.total_visits !== 1 ? 's' : ''} this month
                </div>
              </div>
              <div className={s.cardActions}>
                <button type="button" className={s.invoiceBtn} onClick={() => generateInvoicePdf(inst)}>
                  + Generate Invoice
                </button>
                {status !== 'paid' && (
                  <button
                    type="button"
                    className={status === 'sent' ? s.sendHrBtnSent : s.sendHrBtn}
                    onClick={() => sendToHr(inst)}
                    disabled={sendingToHr[inst.id]}
                  >
                    {sendingToHr[inst.id]
                      ? 'Sending…'
                      : status === 'sent'
                        ? '✅ Sent — Resend?'
                        : '📤 Send to HR'}
                  </button>
                )}
                <button type="button" className={s.breakdownBtn} onClick={() => toggleBreakdown(inst)}>
                  {isExpanded ? 'Hide' : 'Breakdown'}
                </button>
              </div>
            </div>

            <div className={s.instBody}>
              <div className={s.billingRow}>
                <span className={s.billingLabel}>Calculated amount</span>
                <span className={s.billingAmount}>{inst.calculated_amount.toLocaleString()} RWF</span>
              </div>
              {inst.rate_per_session > 0 && (
                <div className={s.rateNote}>
                  {inst.rate_per_session.toLocaleString()} RWF/session × {inst.total_visits} visits
                </div>
              )}

              <div className={s.statusRow}>
                <span className={s.statusLabel}>Status:</span>
                {status === 'paid' && (
                  <span className={`${s.badge} ${s.badgePaid}`}>
                    PAID ✓
                    {inst.paid_at && (
                      <span className={s.badgeSub}> · {new Date(inst.paid_at).toLocaleDateString()}</span>
                    )}
                  </span>
                )}
                {status === 'sent' && (
                  <span className={`${s.badge} ${s.badgeSent}`}>
                    SENT
                    {inst.sent_at && (
                      <span className={s.badgeSub}> · {new Date(inst.sent_at).toLocaleDateString()}</span>
                    )}
                  </span>
                )}
                {status === 'pending' && (
                  <span className={`${s.badge} ${s.badgePending}`}>PENDING</span>
                )}
                {status === 'overdue' && (
                  <span className={`${s.badge} ${s.badgeOverdue}`}>OVERDUE</span>
                )}
              </div>

              {inst.sent_at && status !== 'paid' && (
                <div className={s.refNote}>Last sent: {new Date(inst.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              )}
              {inst.payment_reference && (
                <div className={s.refNote}>Ref: {inst.payment_reference}</div>
              )}

              {status !== 'paid' && inst.total_visits > 0 && (
                <button type="button" className={s.markPaidBtn} onClick={() => openModal(inst)}>
                  ✓ Mark as Paid
                </button>
              )}
            </div>

            {/* Breakdown */}
            {isExpanded && (
              <div className={s.breakdownSection}>
                {bdLoading && <p className={s.empty}>Loading…</p>}
                {!bdLoading && bd.length === 0 && (
                  <p className={s.empty}>No visits recorded this month.</p>
                )}
                {!bdLoading && bd.length > 0 && (() => {
                  const bdTotalVisits = bd.reduce((n, r) => n + r.visit_count, 0);
                  const bdTotalAmount = bd.reduce((n, r) => n + r.subtotal, 0);
                  return (
                    <table className={s.bdTable}>
                      <thead>
                        <tr>
                          <th className={s.bdTh}>Name</th>
                          <th className={s.bdTh}>Type</th>
                          <th className={s.bdTh}>Service</th>
                          <th className={s.bdTh}>Visits</th>
                          <th className={s.bdTh}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bd.map((row, i) => (
                          <tr key={i} className={s.bdTr}>
                            <td className={s.bdTd}>
                              {row.name}
                              {row.parent_name && (
                                <div className={s.depLabel}>Dep. of {row.parent_name}</div>
                              )}
                            </td>
                            <td className={s.bdTd}>{row.parent_id ? 'Dependent' : 'Employee'}</td>
                            <td className={s.bdTd}>{row.service_name ?? '—'}</td>
                            <td className={s.bdTd}>{row.visit_count}</td>
                            <td className={s.bdTd}>
                              {row.subtotal > 0 ? `${row.subtotal.toLocaleString()} RWF` : '—'}
                            </td>
                          </tr>
                        ))}
                        <tr className={s.bdTotal}>
                          <td className={s.bdTd} colSpan={3}>TOTAL</td>
                          <td className={s.bdTd}>{bdTotalVisits}</td>
                          <td className={s.bdTd}>
                            {bdTotalAmount > 0
                              ? `${bdTotalAmount.toLocaleString()} RWF`
                              : `${inst.calculated_amount.toLocaleString()} RWF`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {/* Mark as Paid modal */}
      {modalInst && (
        <div className={s.overlay} onClick={e => e.target === e.currentTarget && setModalInst(null)}>
          <div className={s.modal}>
            <div className={s.modalHeader}>
              <h4 className={s.modalTitle}>Record Payment — {modalInst.name}</h4>
              <button type="button" className={s.modalClose} onClick={() => setModalInst(null)}>×</button>
            </div>
            <div className={s.modalBody}>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Amount (RWF)</label>
                <input
                  type="number"
                  className={s.formInput}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Payment Reference (optional)</label>
                <input
                  type="text"
                  className={s.formInput}
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  placeholder="MoMo transaction ID or bank reference"
                />
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Notes (optional)</label>
                <textarea
                  className={s.formTextarea}
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  rows={2}
                />
              </div>
              {saveError && <p className={s.saveError}>{saveError}</p>}
            </div>
            <div className={s.modalFooter}>
              <button type="button" className={s.cancelBtn} onClick={() => setModalInst(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={s.submitBtn}
                onClick={submitPayment}
                disabled={!payAmount || Number(payAmount) <= 0 || saving}
              >
                {saving ? 'Recording…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
