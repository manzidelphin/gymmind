import HRBillingReport from '../components/HRBillingReport';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { hrApi } from '../api/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import s from './HRDashboard.module.css';

// ── Types ─────────────────────────────────────────────────────────
type Tab = 'overview' | 'employees' | 'gyms' | 'attendance' | 'invoices' | 'reports' | 'settings';

interface GymEntry {
  gymId:           number;
  gymName:         string;
  gymSlug:         string;
  institutionId:   number;
  institutionName: string;
  ratePerSession:  number;
  employeeCount:   number;
  thisMonthVisits: number;
  invoiceAmount:   number;
  invoiceStatus:   'pending' | 'paid' | 'overdue' | null;
  invoiceToken:    string | null;
  invoiceId:       number | null;
  month:           string;
}

interface Employee {
  id:            number;
  name:          string;
  phone:         string | null;
  status:        string;
  days_attended: number;
  amount:        number;
  last_checkin:  string | null;
}

interface DetailData {
  gym_name:          string;
  institution:       { id: number; name: string; rate_per_session: number };
  month:             string;
  employees:         Employee[];
  total:             number;
  payment_status:    string | null;
  paid_at:           string | null;
  payment_reference: string | null;
  total_paid:        number | null;
  invoice_id?:       number;
}

interface AttendanceRow {
  user_id:    number;
  name:       string;
  days:       number[];
  total_days: number;
}

interface AttendanceRecord {
  id:               number;
  checked_in_at:    string;
  checkin_type:     string;
  service_name:     string | null;
  parent_name:      string | null;
  employee_id:      number;
  employee_name:    string;
  employee_phone:   string | null;
  gym_name:         string;
  gym_slug:         string;
  plan_name:        string | null;
  institution_name: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtRwf(n: number) {
  return n.toLocaleString('en-RW') + ' RWF';
}

function fmtMonth(ym: string) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function effStatus(e: GymEntry) {
  return e.invoiceStatus ?? (e.invoiceAmount > 0 ? 'pending' : null);
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function buildChartData(attendance: AttendanceRow[], month: string) {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => {
    const day = i + 1;
    return { day: String(day), checkins: attendance.filter(e => e.days.includes(day)).length };
  });
}

function exportCsv(employees: Employee[], month: string) {
  const rows = [
    ['Name', 'Phone', 'Days Attended', 'Amount (RWF)', 'Last Check-in', 'Status'],
    ...employees.map(e => [
      e.name, e.phone ?? '', String(e.days_attended), String(e.amount),
      e.last_checkin ? new Date(e.last_checkin).toLocaleString() : '', e.status,
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `attendance-${month}.csv`;
  a.click();
}

function exportAttendanceCsv(records: AttendanceRecord[], from: string, to: string) {
  const rows = [
    ['Employee Name', 'Phone', 'Gym', 'Date', 'Time', 'Type', 'Check-in ID'],
    ...records.map(r => [
      r.employee_name,
      r.employee_phone ?? '',
      r.gym_name,
      dayjs(r.checked_in_at).format('ddd, DD MMM YYYY'),
      dayjs(r.checked_in_at).format('hh:mm A'),
      r.checkin_type,
      String(r.id),
    ]),
  ];
  const csv  = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `GymMind-Attendance-${from}-${to}.csv`;
  a.click();
}

// ── PDF Invoice generator ─────────────────────────────────────────
function downloadInvoicePdf(e: GymEntry) {
  // Decode HR admin phone from JWT
  let hrPhone = '';
  try {
    const tok = localStorage.getItem('hr_token') ?? '';
    const payload = JSON.parse(atob(tok.split('.')[1]));
    hrPhone = payload.phone ?? '';
  } catch { /* ignore */ }

  const [year, mon] = e.month.split('-');
  const invoiceNum  = `INV-${year}-${mon}-${e.institutionId}`;
  const today       = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const dueDate     = new Date(+year, +mon, 0).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const subtotal    = e.invoiceAmount;
  const vat         = Math.round(subtotal * 0.18);
  const total       = subtotal + vat;

  const statusLabel = e.invoiceStatus === 'paid' ? 'PAID'
    : e.invoiceStatus === 'overdue' ? 'OVERDUE' : 'PENDING';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW  = 210;
  const ML  = 15;
  const MR  = 15;
  const CW  = PW - ML - MR; // 180mm

  // ── Navy header bar ──
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, PW, 28, 'F');

  // Brand mark (green square)
  doc.setFillColor(16, 185, 129);
  doc.roundedRect(ML, 8, 12, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('G', ML + 6, 16.5, { align: 'center' });

  // GymMind wordmark
  doc.setFontSize(16);
  doc.text('GymMind', ML + 15, 16);

  // OFFICIAL INVOICE (right-aligned)
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text('OFFICIAL INVOICE', PW - MR, 16, { align: 'right' });

  // ── Invoice meta ──
  let y = 38;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Invoice #: ${invoiceNum}`, ML, y);

  // Status pill (right)
  const pillColor: [number, number, number] =
    e.invoiceStatus === 'paid'    ? [16, 185, 129] :
    e.invoiceStatus === 'overdue' ? [220, 38, 38]  : [245, 158, 11];
  doc.setFillColor(...pillColor);
  const pillW = 28;
  doc.roundedRect(PW - MR - pillW, y - 6, pillW, 8, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(statusLabel, PW - MR - pillW / 2, y - 0.5, { align: 'center' });

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Date: ${today}`, ML, y);
  y += 6;
  doc.text(`Due: ${dueDate}`, ML, y);

  // ── Divider ──
  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);

  // ── Bill To / Bill By ──
  y += 8;
  const col2 = ML + CW / 2 + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('BILLED TO', ML, y);
  doc.text('BILLED BY', col2, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(e.institutionName, ML, y);
  doc.text('GymMind Platform', col2, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  if (hrPhone) doc.text(hrPhone, ML, y);
  doc.text('billing@gymmind.rw', col2, y);
  y += 5;
  doc.text('TIN: 143715478', col2, y);

  // ── Divider ──
  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(ML, y, PW - MR, y);

  // ── Services table ──
  y += 6;
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Description', 'Qty', 'Unit Price (RWF)', 'Total (RWF)']],
    body: [[
      `Gym access — ${e.gymName}`,
      String(e.thisMonthVisits),
      e.ratePerSession.toLocaleString('en-RW'),
      subtotal.toLocaleString('en-RW'),
    ]],
    headStyles: {
      fillColor:  [15, 23, 42],
      textColor:  [255, 255, 255],
      fontStyle:  'bold',
      fontSize:   9,
      cellPadding: 4,
    },
    bodyStyles: {
      fontSize:   10,
      cellPadding: 4,
      textColor:  [30, 41, 59],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 40, halign: 'right' },
      3: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
    },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
  });

  // ── Totals ──
  y = (doc as any).lastAutoTable.finalY + 8;
  const totX = PW - MR - 80;
  const valX = PW - MR;

  function totalRow(label: string, value: string, bold = false, green = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11 : 10);
    doc.setTextColor(green ? 16 : (bold ? 15 : 100), green ? 185 : (bold ? 23 : 116), green ? 129 : (bold ? 42 : 139));
    doc.text(label, totX, y, { align: 'left' });
    doc.text(value,  valX, y, { align: 'right' });
    y += bold ? 7 : 6;
  }

  totalRow('Subtotal:', `${subtotal.toLocaleString('en-RW')} RWF`);
  totalRow('VAT (18%):', `${vat.toLocaleString('en-RW')} RWF`);

  // Divider above total
  doc.setDrawColor(226, 232, 240);
  doc.line(totX, y - 1, valX, y - 1);
  y += 2;

  totalRow('TOTAL DUE:', `${total.toLocaleString('en-RW')} RWF`, true, true);

  // ── Payment instructions ──
  y += 6;
  doc.setFillColor(236, 253, 245);
  doc.roundedRect(ML, y, CW, 22, 3, 3, 'F');
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(ML, y, CW, 22, 3, 3, 'S');

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(5, 150, 105);
  doc.text('PAYMENT INSTRUCTIONS', ML + 5, y);

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(`Pay via MTN MoMo  ·  Reference: ${invoiceNum}`, ML + 5, y);

  y += 5;
  doc.setTextColor(100, 116, 139);
  doc.text('Contact the gym for their MTN MoMo number if not shown on your portal.', ML + 5, y);

  // ── Footer ──
  const footY = 280;
  doc.setDrawColor(226, 232, 240);
  doc.line(ML, footY - 4, PW - MR, footY - 4);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('"Thank you for investing in your employees\' wellness."', PW / 2, footY, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Powered by GymMind · gymmind.rw', PW / 2, footY + 5, { align: 'center' });

  // ── Save ──
  const safeName = e.institutionName.replace(/\s+/g, '-');
  doc.save(`GymMind-Invoice-${e.month}-${safeName}.pdf`);
}

// ── Skeleton ──────────────────────────────────────────────────────
function Sk({ h = 16, w = '100%' }: { h?: number; w?: string }) {
  return <div className={s.skeleton} style={{ height: h, width: w }} />;
}

// ── Badges ────────────────────────────────────────────────────────
function InvoiceBadge({ status }: { status: string | null }) {
  if (status === 'paid')    return <span className={`${s.badge} ${s.bPaid}`}>Paid</span>;
  if (status === 'overdue') return <span className={`${s.badge} ${s.bOverdue}`}>Overdue</span>;
  if (status === 'pending') return <span className={`${s.badge} ${s.bPending}`}>Pending</span>;
  return <span className={`${s.badge} ${s.bNone}`}>No Invoice</span>;
}

function EmpBadge({ status }: { status: string }) {
  if (status === 'active')    return <span className={`${s.badge} ${s.bPaid}`}>Active</span>;
  if (status === 'suspended') return <span className={`${s.badge} ${s.bOverdue}`}>Suspended</span>;
  return <span className={`${s.badge} ${s.bNone}`}>{status}</span>;
}

// ── Main component ────────────────────────────────────────────────
export default function HRDashboard() {
  const navigate = useNavigate();

  const [tab,           setTab]           = useState<Tab>('overview');
  const [entries,       setEntries]       = useState<GymEntry[]>([]);
  const [detail,        setDetail]        = useState<DetailData | null>(null);
  const [attendance,    setAttendance]    = useState<AttendanceRow[]>([]);
  const [attMonth,      setAttMonth]      = useState('');
  const [loadingDash,   setLoadingDash]   = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingAtt,    setLoadingAtt]    = useState(false);
  const [dashError,     setDashError]     = useState('');
  const [search,        setSearch]        = useState('');

  // MoMo modal
  const [momoEntry,   setMomoEntry]   = useState<GymEntry | null>(null);
  const [momoPhone,   setMomoPhone]   = useState('');
  const [momoLoading, setMomoLoading] = useState(false);
  const [momoConfirm, setMomoConfirm] = useState(false);
  const [momoSuccess, setMomoSuccess] = useState<{ message: string; reference: string } | null>(null);
  const [momoError,   setMomoError]   = useState('');

  // Add employee modal
  const [addOpen,    setAddOpen]    = useState(false);
  const [addName,    setAddName]    = useState('');
  const [addPhone,   setAddPhone]   = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState('');

  // Excel upload
  interface UploadRow { name: string; phone: string; valid: boolean }
  const [uploadPreview, setUploadPreview] = useState<UploadRow[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult,  setUploadResult]  = useState<{ created: number; skipped: number } | null>(null);
  const [uploadError,   setUploadError]   = useState('');
  const [dragOver,      setDragOver]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attendance log
  const todayStr     = dayjs().format('YYYY-MM-DD');
  const monthStart   = dayjs().startOf('month').format('YYYY-MM-DD');
  const [attRecords,   setAttRecords]   = useState<AttendanceRecord[]>([]);
  const [attTotal,     setAttTotal]     = useState(0);
  const [attLoading,   setAttLoading]   = useState(false);
  const [attPage,      setAttPage]      = useState(1);
  const [attFrom,      setAttFrom]      = useState(monthStart);
  const [attTo,        setAttTo]        = useState(todayStr);
  const [attSearch,    setAttSearch]    = useState('');
  const [attAutoRef,   setAttAutoRef]   = useState(false);
  const [attLastUpd,   setAttLastUpd]   = useState<Date | null>(null);
  const [attNewIds,    setAttNewIds]    = useState<Set<number>>(new Set());
  const attAutoTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIdsRef     = useRef<Set<number>>(new Set());
  const ATT_PAGE_SIZE  = 50;

  // ── Init ─────────────────────────────────────────────────────
  useEffect(() => {
    loadDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load detail + attendance on first non-empty entries ──────
  useEffect(() => {
    const e = entries[0];
    if (!e) return;
    if (!detail) loadDetail(e);
    if (!attendance.length) loadAttendance(String(e.institutionId), e.month);
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data fetchers ─────────────────────────────────────────────
  async function loadDashboard() {
    setLoadingDash(true); setDashError('');
    try {
      const { data } = await hrApi.get<GymEntry[]>('/hr/dashboard');
      setEntries(data);
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem('hr_token');
        navigate('/hr/login');
      } else {
        setDashError('Failed to load dashboard. Please refresh.');
      }
    } finally { setLoadingDash(false); }
  }

  async function loadDetail(e: GymEntry) {
    setLoadingDetail(true);
    try {
      const { data } = await hrApi.get<DetailData>(`/hr/${e.institutionId}`);
      setDetail(data);
    } catch { /* optional */ }
    finally { setLoadingDetail(false); }
  }

  async function loadAttendance(token: string, month: string) {
    setLoadingAtt(true);
    try {
      const { data } = await hrApi.get<{ month: string; attendance: AttendanceRow[] }>(
        `/hr/${token}/attendance?month=${month}`,
      );
      setAttendance(data.attendance);
      setAttMonth(data.month);
    } catch { /* optional */ }
    finally { setLoadingAtt(false); }
  }

  const loadAttendanceLog = useCallback(async (from: string, to: string, search: string) => {
    setAttLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (search.trim()) params.set('search', search.trim());
      const { data } = await hrApi.get<{ records: AttendanceRecord[]; total: number }>(
        `/hr/attendance?${params}`,
      );
      // Detect new rows for flash effect
      const incoming = new Set(data.records.map(r => r.id));
      const newOnes  = new Set([...incoming].filter(id => !prevIdsRef.current.has(id) && prevIdsRef.current.size > 0));
      setAttNewIds(newOnes);
      prevIdsRef.current = incoming;
      setTimeout(() => setAttNewIds(new Set()), 2500);

      setAttRecords(data.records);
      setAttTotal(data.total);
      setAttPage(1);
      setAttLastUpd(new Date());
    } catch { /* ignore */ }
    finally { setAttLoading(false); }
  }, []);

  // Auto-refresh for attendance tab
  useEffect(() => {
    if (tab === 'attendance' && attAutoRef) {
      attAutoTimer.current = setInterval(() => loadAttendanceLog(attFrom, attTo, attSearch), 30_000);
    } else {
      if (attAutoTimer.current) clearInterval(attAutoTimer.current);
    }
    return () => { if (attAutoTimer.current) clearInterval(attAutoTimer.current); };
  }, [tab, attAutoRef, attFrom, attTo, attSearch, loadAttendanceLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load attendance log when switching to tab
  useEffect(() => {
    if (tab === 'attendance' && attRecords.length === 0 && !attLoading) {
      loadAttendanceLog(attFrom, attTo, attSearch);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────
  function logout() { localStorage.removeItem('hr_token'); navigate('/hr/login'); }

  function openMomo(e: GymEntry) {
    setMomoEntry(e); setMomoPhone('');
    setMomoSuccess(null); setMomoError(''); setMomoConfirm(false);
  }

  async function submitPay() {
    if (!momoEntry || !momoPhone.trim() || !momoConfirm) return;
    setMomoLoading(true); setMomoError('');
    try {
      const { data } = await hrApi.post<{ success: boolean; message: string; referenceId: string }>(
        `/billing/institutions/${momoEntry.institutionId}/request-payment`,
        { momoPhone: momoPhone.trim() },
      );
      setMomoSuccess({
        message:   'Payment request sent! Check your phone for MTN MoMo prompt',
        reference: data.referenceId ?? '',
      });
      loadDashboard();
    } catch (e: any) {
      setMomoError(e.response?.data?.error ?? 'Payment failed. Try again.');
    } finally { setMomoLoading(false); }
  }

  // ── Upload helpers ────────────────────────────────────────────
  function downloadTemplate() {
    const csv = '"Name","Phone"\n"Jean-Paul Habimana","0788123456"\n"Alice Uwimana","0722345678"';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employees-template.csv';
    a.click();
  }

  function parseUploadFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const preview: UploadRow[] = rows.map((r) => {
          const name  = String(r['Name']  || r['name']  || r['NAME']  || '').trim();
          const phone = String(r['Phone'] || r['phone'] || r['PHONE'] || '').trim();
          return { name, phone, valid: name.length > 0 };
        }).filter(r => r.name || r.phone);
        setUploadPreview(preview);
        setUploadResult(null);
        setUploadError('');
      } catch {
        setUploadError('Could not parse the file. Please use the provided template.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleUploadDrop(ev: React.DragEvent) {
    ev.preventDefault(); setDragOver(false);
    const file = ev.dataTransfer.files[0];
    if (file) parseUploadFile(file);
  }

  function handleUploadChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (file) parseUploadFile(file);
    ev.target.value = '';
  }

  async function submitUpload() {
    const e = entries[0];
    const valid = uploadPreview.filter(r => r.valid);
    if (!e || !valid.length) return;
    setUploadLoading(true); setUploadError('');
    try {
      const { data } = await hrApi.post<{ created: number; skipped: number }>(
        `/hr/${e.institutionId}/employees/bulk`,
        { employees: valid.map(r => ({ name: r.name, phone: r.phone || undefined })) },
      );
      setUploadResult(data);
      setUploadPreview([]);
      if (e) loadDetail(e);
    } catch (err: any) {
      setUploadError(err.response?.data?.error ?? 'Upload failed. Please try again.');
    } finally { setUploadLoading(false); }
  }

  async function addEmployee() {
    const e = entries[0];
    if (!e || !addName.trim()) return;
    setAddLoading(true); setAddError('');
    try {
      await hrApi.post(`/hr/${e.institutionId}/employees`, { name: addName.trim(), phone: addPhone.trim() || undefined });
      setAddOpen(false); setAddName(''); setAddPhone('');
      loadDetail(e);
    } catch (err: any) {
      setAddError(err.response?.data?.error ?? 'Failed to add employee.');
    } finally { setAddLoading(false); }
  }

  async function removeEmployee(userId: number) {
    const e = entries[0];
    if (!e || !confirm('Remove this employee from the programme?')) return;
    try {
      await hrApi.delete(`/hr/${e.institutionId}/employees/${userId}`);
      loadDetail(e);
    } catch { /* ignore */ }
  }

  // ── Derived data ──────────────────────────────────────────────
  const totalEmployees  = entries.reduce((s, e) => s + e.employeeCount, 0);
  const totalVisits     = entries.reduce((s, e) => s + e.thisMonthVisits, 0);
  const totalInvoice    = entries.reduce((s, e) => s + e.invoiceAmount, 0);
  const activeThisMonth = detail?.employees.filter(e => e.days_attended > 0).length ?? 0;
  const complianceRate  = totalEmployees > 0 ? Math.round((activeThisMonth / totalEmployees) * 100) : 0;
  const month           = entries[0]?.month ?? '';

  const chartData = useMemo(
    () => attendance.length && attMonth ? buildChartData(attendance, attMonth) : [],
    [attendance, attMonth],
  );
  const topEmployees = useMemo(
    () => [...(detail?.employees ?? [])].sort((a, b) => b.days_attended - a.days_attended).slice(0, 5),
    [detail],
  );
  const recentCheckins = useMemo(
    () => [...(detail?.employees ?? [])]
      .filter(e => e.last_checkin)
      .sort((a, b) => new Date(b.last_checkin!).getTime() - new Date(a.last_checkin!).getTime())
      .slice(0, 8),
    [detail],
  );
  const filteredEmployees = useMemo(
    () => (detail?.employees ?? []).filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.phone ?? '').includes(search),
    ),
    [detail, search],
  );

  const entry = entries[0] ?? null;

  // ── Sidebar nav ───────────────────────────────────────────────
  const navItems: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview',   icon: '📊', label: 'Overview' },
    { id: 'employees',  icon: '👥', label: 'Employees' },
    { id: 'gyms',       icon: '🏋️', label: 'Gyms' },
    { id: 'attendance', icon: '📅', label: 'Attendance' },
    { id: 'invoices',   icon: '📄', label: 'Invoices' },
    { id: 'reports',    icon: '📊', label: 'Reports' },
    { id: 'settings',   icon: '⚙️', label: 'Settings' },
  ];

  // ── Auth guard — redirect immediately, never show loading for unauthenticated users ──
  if (!localStorage.getItem('hr_token')) {
    return <Navigate to="/hr/login" replace />;
  }

  // ── Loading / error screens ───────────────────────────────────
  if (loadingDash) {
    return (
      <div className={s.splash}>
        <div className={s.splashSpinner} />
        <p>Loading your dashboard…</p>
      </div>
    );
  }
  if (dashError) {
    return (
      <div className={s.splash}>
        <div className={s.splashError}>{dashError}</div>
        <button className={s.btnPrimary} onClick={loadDashboard}>Retry</button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={s.root}>

      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sideTop}>
          <div className={s.sideBrand}>
            <div className={s.sideMark}>G</div>
            <span className={s.sideBrandName}>GymMind</span>
          </div>

          {entry && (
            <div className={s.instBox}>
              <div className={s.instAvatar}>{entry.institutionName.slice(0, 2).toUpperCase()}</div>
              <div>
                <div className={s.instName}>{entry.institutionName}</div>
                <div className={s.instSub}>HR Portal</div>
              </div>
            </div>
          )}

          <nav className={s.nav}>
            {navItems.map(({ id, icon, label }) => (
              <button
                key={id}
                className={`${s.navItem} ${tab === id ? s.navActive : ''}`}
                onClick={() => setTab(id)}
              >
                <span className={s.navIcon}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className={s.sideBottom}>
          <button className={s.logoutBtn} onClick={logout}>
            <span>↩</span> Sign Out
          </button>
          <div className={s.poweredBy}>Powered by GymMind</div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className={s.main}>
        <header className={s.pageHeader}>
          <div>
            <h1 className={s.pageTitle}>
              {{ overview: 'Overview', employees: 'Employees', gyms: 'Partner Gyms',
                 attendance: 'Attendance', invoices: 'Invoices', reports: 'Reports', settings: 'Settings' }[tab]}
            </h1>
            {month && <div className={s.pageMonth}>{fmtMonth(month)}</div>}
          </div>
        </header>

        <div className={s.content}>

          {/* ══ OVERVIEW ══ */}
          {tab === 'overview' && (
            <>
              <div className={s.statGrid}>
                <StatCard
                  label="Total Enrolled"
                  value={String(totalEmployees)}
                  sub={`${activeThisMonth} active this month`}
                />
                <StatCard
                  label="Check-ins This Month"
                  value={String(totalVisits)}
                  sub="across all locations"
                />
                <StatCard
                  label="Compliance Rate"
                  value={`${complianceRate}%`}
                  sub="attended ≥1 session"
                  accent
                />
                <StatCard
                  label="Current Invoice"
                  value={fmtRwf(totalInvoice)}
                  sub={entry ? <InvoiceBadge status={entry.invoiceStatus} /> : 'not generated'}
                />
              </div>

              <div className={s.twoCol}>
                <div className={s.panel}>
                  <div className={s.panelHead}><h3>Attendance This Month</h3></div>
                  {loadingAtt ? <Sk h={220} /> : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }} tickLine={false} axisLine={false} interval={4} />
                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: '#0F172A', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13 }}
                          labelFormatter={d => `Day ${d}`}
                          formatter={(v: unknown) => [v, 'check-ins']}
                        />
                        <Bar dataKey="checkins" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <Empty icon="📊" title="No chart data yet" sub="Check-ins will appear as employees start attending." />}
                </div>

                <div className={s.panel}>
                  <div className={s.panelHead}><h3>Top Active Employees</h3></div>
                  {loadingDetail ? <div className={s.skStack}>{[...Array(5)].map((_, i) => <Sk key={i} h={40} />)}</div>
                    : topEmployees.length > 0 ? (
                      <table className={s.table}>
                        <thead><tr><th>#</th><th>Name</th><th>Check-ins</th><th>Last seen</th></tr></thead>
                        <tbody>
                          {topEmployees.map((emp, i) => (
                            <tr key={emp.id}>
                              <td><span className={s.rank}>{i + 1}</span></td>
                              <td className={s.tdName}>{emp.name}</td>
                              <td><span className={s.cnt}>{emp.days_attended}</span></td>
                              <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <Empty icon="👥" title="No data yet" sub="Employee rankings will appear here." />}
                </div>
              </div>

              <div className={s.panel}>
                <div className={s.panelHead}><h3>Recent Check-ins</h3></div>
                {loadingDetail ? <div className={s.skStack}>{[...Array(4)].map((_, i) => <Sk key={i} h={44} />)}</div>
                  : recentCheckins.length > 0 ? (
                    <table className={s.table}>
                      <thead><tr><th>Employee</th><th>Gym</th><th>Last check-in</th><th>Verified</th></tr></thead>
                      <tbody>
                        {recentCheckins.map(emp => (
                          <tr key={emp.id}>
                            <td className={s.tdName}>{emp.name}</td>
                            <td className={s.tdMuted}>{entry?.gymName ?? '—'}</td>
                            <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                            <td><span className={s.verifiedBadge}>✓ OTP</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <Empty icon="📋" title="No check-ins yet this month" sub="Employee activity will appear here once they start visiting." />}
              </div>
            </>
          )}

          {/* ══ EMPLOYEES ══ */}
          {tab === 'employees' && (
            <>
              {/* Upload zone */}
              <div className={s.panel}>
                <div className={s.panelHead}>
                  <h3>Bulk Upload via Excel / CSV</h3>
                  <button className={s.btnSecondary} onClick={downloadTemplate}>↓ Download Template</button>
                </div>
                <div
                  className={`${s.uploadZone} ${dragOver ? s.uploadZoneDrag : ''}`}
                  onDragOver={ev => { ev.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleUploadDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className={s.uploadIcon}>📊</div>
                  <div className={s.uploadTitle}>Drop your Excel or CSV file here</div>
                  <div className={s.uploadSub}>Supports .xlsx, .xls, .csv · Columns: Name, Phone</div>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className={s.hiddenInput} onChange={handleUploadChange} />
                </div>

                {uploadError && <div className={s.inlineError}>{uploadError}</div>}

                {uploadResult && (
                  <div className={s.uploadSuccess}>
                    ✓ Upload complete — <strong>{uploadResult.created}</strong> added
                    {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped (duplicates)`}
                  </div>
                )}

                {uploadPreview.length > 0 && (
                  <div className={s.uploadPreview}>
                    <div className={s.uploadPreviewHead}>
                      <span>{uploadPreview.filter(r => r.valid).length} valid employees ready to import</span>
                      <button className={s.clearBtn} onClick={() => setUploadPreview([])}>✕ Clear</button>
                    </div>
                    <table className={s.table}>
                      <thead><tr><th>Name</th><th>Phone</th><th>Status</th></tr></thead>
                      <tbody>
                        {uploadPreview.map((row, i) => (
                          <tr key={i}>
                            <td className={s.tdName}>{row.name || <span className={s.tdMuted}>—</span>}</td>
                            <td className={s.tdMuted}>{row.phone || '—'}</td>
                            <td>
                              {row.valid
                                ? <span className={`${s.badge} ${s.bPaid}`}>✓ Valid</span>
                                : <span className={`${s.badge} ${s.bOverdue}`}>⚠ Missing name</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className={s.uploadActions}>
                      <button
                        className={s.btnPrimary}
                        onClick={submitUpload}
                        disabled={uploadLoading || uploadPreview.filter(r => r.valid).length === 0}
                      >
                        {uploadLoading ? 'Uploading…' : `Import ${uploadPreview.filter(r => r.valid).length} Employees`}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={s.toolbar}>
                <input
                  className={s.searchInput}
                  type="search"
                  placeholder="Search by name or phone…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className={s.toolbarRight}>
                  <button className={s.btnSecondary} onClick={() => detail && exportCsv(detail.employees, month)}>
                    ↓ Export CSV
                  </button>
                  <button className={s.btnPrimary} onClick={() => setAddOpen(true)}>
                    + Add Employee
                  </button>
                </div>
              </div>
              <div className={s.panel}>
                {loadingDetail
                  ? <div className={s.skStack}>{[...Array(6)].map((_, i) => <Sk key={i} h={48} />)}</div>
                  : filteredEmployees.length > 0
                    ? (
                      <table className={s.table}>
                        <thead><tr><th>Name</th><th>Phone</th><th>Check-ins</th><th>Amount</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                          {filteredEmployees.map(emp => (
                            <tr key={emp.id}>
                              <td className={s.tdName}>{emp.name}</td>
                              <td className={s.tdMuted}>{emp.phone ?? '—'}</td>
                              <td><span className={s.cnt}>{emp.days_attended}</span></td>
                              <td>{fmtRwf(emp.amount)}</td>
                              <td className={s.tdMuted}>{timeAgo(emp.last_checkin)}</td>
                              <td><EmpBadge status={emp.status} /></td>
                              <td>
                                <button className={s.btnDanger} onClick={() => removeEmployee(emp.id)} title="Remove">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                    : <Empty icon="👥" title={search ? 'No matching employees' : 'No employees enrolled yet'} sub={search ? 'Try a different search term.' : 'Click "+ Add Employee" to get started.'} />
                }
              </div>
            </>
          )}

          {/* ══ GYMS ══ */}
          {tab === 'gyms' && (
            <>
              {entries.length === 0
                ? <Empty icon="🏋️" title="No gym partnerships" sub="Contact GymMind to set up gym access for your employees." />
                : (
                  <div className={s.gymGrid}>
                    {entries.map(e => (
                      <div key={`${e.gymId}-${e.institutionId}`} className={s.gymCard}>
                        <div className={s.gymCardTop}>
                          <div className={s.gymAvatar}>{e.gymName.slice(0, 2).toUpperCase()}</div>
                          <div className={s.gymInfo}>
                            <div className={s.gymName}>{e.gymName}</div>
                            <div className={s.gymSub}>{e.institutionName}</div>
                          </div>
                          <InvoiceBadge status={e.invoiceStatus} />
                        </div>
                        <div className={s.gymStats}>
                          <div className={s.gymStat}><span className={s.gymStatN}>{e.employeeCount}</span><span className={s.gymStatL}>employees</span></div>
                          <div className={s.gymStatDiv} />
                          <div className={s.gymStat}><span className={s.gymStatN}>{e.thisMonthVisits}</span><span className={s.gymStatL}>visits</span></div>
                          <div className={s.gymStatDiv} />
                          <div className={s.gymStat}><span className={s.gymStatN}>{fmtRwf(e.ratePerSession)}</span><span className={s.gymStatL}>per visit</span></div>
                        </div>
                        <div className={s.gymCardFoot}>
                          {e.invoiceToken && <a href={`/hr/${e.invoiceToken}`} className={s.btnSecondary}>View Invoice</a>}
                          {(effStatus(e) === 'pending' || effStatus(e) === 'overdue') && (
                            <button className={s.btnPrimary} onClick={() => openMomo(e)}>Pay Now</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
              <div className={s.partnerCta}>
                <span>Want to add another gym location?</span>
                <a href="mailto:hello@gymmind.app" className={s.btnSecondary}>Request Partnership →</a>
              </div>
            </>
          )}

          {/* ══ ATTENDANCE ══ */}
          {tab === 'attendance' && (() => {
            const pageStart  = (attPage - 1) * ATT_PAGE_SIZE;
            const pageSlice  = attRecords.slice(pageStart, pageStart + ATT_PAGE_SIZE);
            const totalPages = Math.max(1, Math.ceil(attRecords.length / ATT_PAGE_SIZE));
            const uniqueEmps = new Set(attRecords.map(r => r.employee_id)).size;
            const topEmp     = attRecords.length > 0
              ? Object.entries(attRecords.reduce((acc, r) => {
                  acc[r.employee_name] = (acc[r.employee_name] ?? 0) + 1; return acc;
                }, {} as Record<string, number>))
                  .sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
              : '—';
            const lastCheckin = attRecords[0]?.checked_in_at ?? null;

            return (
              <>
                {/* ── Filters bar ── */}
                <div className={s.attFilters}>
                  <div className={s.attFilterLeft}>
                    <div className={s.attDateRange}>
                      <input
                        type="date" className={s.attDateInput}
                        value={attFrom} onChange={e => setAttFrom(e.target.value)}
                      />
                      <span className={s.attDateSep}>→</span>
                      <input
                        type="date" className={s.attDateInput}
                        value={attTo} onChange={e => setAttTo(e.target.value)}
                      />
                    </div>
                    <input
                      type="search" className={s.attSearchInput}
                      placeholder="Search employee name or phone…"
                      value={attSearch}
                      onChange={e => setAttSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && loadAttendanceLog(attFrom, attTo, attSearch)}
                    />
                    <button
                      className={s.btnPrimary}
                      onClick={() => loadAttendanceLog(attFrom, attTo, attSearch)}
                      disabled={attLoading}
                    >
                      {attLoading ? <span className={s.miniSpinner} /> : '🔍 Apply'}
                    </button>
                  </div>
                  <div className={s.attFilterRight}>
                    <label className={s.autoRefLabel}>
                      <input
                        type="checkbox" checked={attAutoRef}
                        onChange={e => setAttAutoRef(e.target.checked)}
                        className={s.autoRefCheck}
                      />
                      Auto-refresh 30s
                    </label>
                    <button
                      className={s.btnSecondary}
                      onClick={() => exportAttendanceCsv(attRecords, attFrom, attTo)}
                      disabled={attRecords.length === 0}
                    >
                      ↓ Export CSV
                    </button>
                  </div>
                </div>

                {/* ── Last updated bar ── */}
                {attLastUpd && (
                  <div className={s.attUpdBar}>
                    {attAutoRef && <span className={s.attPulseDot} />}
                    Last updated: {timeAgo(attLastUpd.toISOString())}
                    {attAutoRef && <span className={s.attLiveTag}>● LIVE</span>}
                  </div>
                )}

                {/* ── Summary cards ── */}
                <div className={s.attSummaryGrid}>
                  <div className={s.attSummaryCard}>
                    <div className={s.attSumN}>{attTotal}</div>
                    <div className={s.attSumL}>Total Check-ins</div>
                  </div>
                  <div className={s.attSummaryCard}>
                    <div className={s.attSumN}>{uniqueEmps}</div>
                    <div className={s.attSumL}>Unique Employees</div>
                  </div>
                  <div className={s.attSummaryCard}>
                    <div className={s.attSumN} title={topEmp} style={{ fontSize: topEmp.length > 14 ? 13 : undefined }}>{topEmp}</div>
                    <div className={s.attSumL}>Most Active</div>
                  </div>
                  <div className={s.attSummaryCard}>
                    <div className={s.attSumN}>{timeAgo(lastCheckin)}</div>
                    <div className={s.attSumL}>Last Check-in</div>
                  </div>
                </div>

                {/* ── Main table ── */}
                <div className={s.panel}>
                  <div className={s.panelHead}>
                    <h3>Attendance Log</h3>
                    <span className={s.attCount}>
                      {attRecords.length > 0
                        ? `Showing ${pageStart + 1}–${Math.min(pageStart + ATT_PAGE_SIZE, attRecords.length)} of ${attRecords.length}`
                        : '0 records'}
                    </span>
                  </div>

                  {attLoading ? (
                    <div className={s.skStack}>{[...Array(8)].map((_, i) => <Sk key={i} h={48} />)}</div>
                  ) : pageSlice.length > 0 ? (
                    <>
                      <table className={`${s.table} ${s.attTable}`}>
                        <thead>
                          <tr>
                            <th className={s.thNum}>#</th>
                            <th>Employee</th>
                            <th>Phone</th>
                            <th>Gym</th>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Service</th>
                            <th>Role</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageSlice.map((rec, idx) => (
                            <tr
                              key={rec.id}
                              className={`${s.attRow} ${attNewIds.has(rec.id) ? s.attRowFlash : ''}`}
                            >
                              <td className={s.tdNum}>{pageStart + idx + 1}</td>
                              <td>
                                <div className={s.empCell}>
                                  <div className={s.empAvatar}>
                                    {rec.employee_name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <span className={s.tdName}>{rec.employee_name}</span>
                                </div>
                              </td>
                              <td className={s.tdMuted}>{rec.employee_phone ?? '—'}</td>
                              <td className={s.tdMuted}>{rec.gym_name}</td>
                              <td className={s.tdDate}>{dayjs(rec.checked_in_at).format('ddd, DD MMM YYYY')}</td>
                              <td className={s.tdTime}>{dayjs(rec.checked_in_at).format('hh:mm A')}</td>
                              <td className={s.tdMuted}>{rec.service_name ?? '—'}</td>
                              <td>
                                {rec.parent_name
                                  ? <span style={{background:'#fef3c7',color:'#92400e',padding:'2px 8px',borderRadius:'99px',fontSize:'12px',fontWeight:600}}>Dep. of {rec.parent_name}</span>
                                  : <span style={{background:'#eff6ff',color:'#1d4ed8',padding:'2px 8px',borderRadius:'99px',fontSize:'12px',fontWeight:600}}>Employee</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className={s.attPagination}>
                          <button
                            className={s.btnSecondary}
                            onClick={() => setAttPage(p => Math.max(1, p - 1))}
                            disabled={attPage === 1}
                          >
                            ← Previous
                          </button>
                          <span className={s.attPageInfo}>
                            Page {attPage} of {totalPages}
                          </span>
                          <button
                            className={s.btnSecondary}
                            onClick={() => setAttPage(p => Math.min(totalPages, p + 1))}
                            disabled={attPage === totalPages}
                          >
                            Next →
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <Empty icon="📅" title="No check-ins found for this period" sub="Adjust the date range or search filters and click Apply." />
                  )}
                </div>
              </>
            );
          })()}

          {/* ══ INVOICES ══ */}
          {tab === 'invoices' && (
            <>
              <div className={s.invoiceSummary}>
                <div>
                  <div className={s.invoiceSumLabel}>Current Month Estimate</div>
                  <div className={s.invoiceSumAmount}>{fmtRwf(totalInvoice)}</div>
                  <div className={s.invoiceSumSub}>
                    Based on {totalVisits} check-ins at {fmtRwf(entry?.ratePerSession ?? 0)} per visit
                  </div>
                </div>
                {entry && (
                  <a
                    href={`/api/hr/${entry.institutionId}/invoice.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className={s.btnPrimary}
                  >
                    ↓ Download PDF
                  </a>
                )}
              </div>

              <div className={s.panel}>
                <div className={s.panelHead}><h3>Invoice History</h3></div>
                {entries.length > 0
                  ? (
                    <table className={s.table}>
                      <thead><tr><th>Period</th><th>Institution</th><th>Gym</th><th>Check-ins</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
                      <tbody>
                        {entries.map(e => (
                          <tr key={`${e.gymId}-${e.institutionId}`}>
                            <td>{e.month ? fmtMonth(e.month) : '—'}</td>
                            <td className={s.tdName}>{e.institutionName}</td>
                            <td>{e.gymName}</td>
                            <td><span className={s.cnt}>{e.thisMonthVisits}</span></td>
                            <td className={s.tdAmount}>{fmtRwf(e.invoiceAmount)}</td>
                            <td><InvoiceBadge status={effStatus(e)} /></td>
                            <td>
                              <div className={s.invActions}>
                                <button className={s.btnOutline} onClick={() => downloadInvoicePdf(e)}>📄 PDF</button>
                                {(effStatus(e) === 'pending' || effStatus(e) === 'overdue') && (
                                  <button className={s.btnPrimary} onClick={() => openMomo(e)}>💳 Pay</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  : <Empty icon="📄" title="No invoices yet" sub="Invoices are generated automatically each month." />
                }
              </div>
            </>
          )}

          {/* ══ SETTINGS ══ */}
          
          {tab === 'reports' && entry && (() => {
            return <HRBillingReport entry={entry} hrApi={hrApi} />;
          })()}

          {tab === 'settings' && entry && (
            <div className={s.settingsGrid}>
              <div className={s.panel}>
                <div className={s.panelHead}><h3>Company Profile</h3></div>
                <SettingsRow label="Company Name"   value={entry.institutionName} />
                <SettingsRow label="Partner Gym"    value={entry.gymName} />
                <SettingsRow label="Rate Per Visit" value={fmtRwf(entry.ratePerSession)} />
                <div className={s.settingsNote}>
                  To update company details, contact{' '}
                  <a href="mailto:hello@gymmind.app">hello@gymmind.app</a>
                </div>
              </div>
              <div className={s.panel}>
                <div className={s.panelHead}><h3>Billing Summary</h3></div>
                <SettingsRow label="Current Period"   value={fmtMonth(month)} />
                <SettingsRow label="Invoice Status"   value={<InvoiceBadge status={effStatus(entry)} />} />
                <SettingsRow label="Total Employees"  value={`${entry.employeeCount} enrolled`} />
                <SettingsRow label="Total This Month" value={fmtRwf(entry.invoiceAmount)} />
                <div className={s.settingsNote}>
                  For billing queries, email{' '}
                  <a href="mailto:billing@gymmind.app">billing@gymmind.app</a>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ══ MOMO MODAL ══ */}
      {momoEntry && (
        <div className={s.overlay} onClick={() => !momoLoading && setMomoEntry(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h2>Pay via MTN MoMo</h2>
              <button className={s.modalClose} onClick={() => setMomoEntry(null)} disabled={momoLoading}>✕</button>
            </div>
            <div className={s.modalBody}>

              {momoSuccess ? (
                /* ── Success screen ── */
                <div className={s.momoSuccessScreen}>
                  <div className={s.successCheckWrap}>
                    <div className={s.successCheck}>
                      <svg viewBox="0 0 52 52" className={s.checkSvg}>
                        <circle cx="26" cy="26" r="25" fill="none" className={s.checkCircle} />
                        <path d="M14 27l8 8 16-16" fill="none" className={s.checkMark} />
                      </svg>
                    </div>
                  </div>
                  <div className={s.successTitle}>Payment Initiated!</div>
                  <div className={s.successSub}>Check your MTN MoMo phone for a USSD prompt to approve the payment.</div>
                  <div className={s.successRef}>Ref: {momoSuccess.reference}</div>
                  <button className={s.btnPrimary} onClick={() => setMomoEntry(null)}>Done</button>
                </div>
              ) : momoLoading ? (
                /* ── Loading screen ── */
                <div className={s.momoLoadingScreen}>
                  <div className={s.momoSpinner} />
                  <div className={s.momoLoadingText}>Sending payment request…</div>
                  <div className={s.momoLoadingSub}>A USSD prompt will appear on {momoPhone}</div>
                </div>
              ) : (
                /* ── Form ── */
                <>
                  <div className={s.modalInvoice}>
                    <div>
                      <div className={s.modalInvoiceGym}>{momoEntry.gymName}</div>
                      <div className={s.modalInvoiceInst}>{momoEntry.institutionName} · {fmtMonth(momoEntry.month)}</div>
                    </div>
                    <span className={s.modalAmt}>{fmtRwf(momoEntry.invoiceAmount)}</span>
                  </div>
                  <div className={s.momoNote}>
                    You will receive a USSD prompt on your MTN MoMo phone to approve this payment.
                  </div>
                  <label className={s.lbl}>MoMo Phone Number</label>
                  <input
                    className={s.inp}
                    type="tel"
                    placeholder="07XX XXX XXX"
                    value={momoPhone}
                    onChange={e => setMomoPhone(e.target.value)}
                    autoFocus
                  />
                  <label className={s.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={momoConfirm}
                      onChange={e => setMomoConfirm(e.target.checked)}
                      className={s.checkboxInput}
                    />
                    <span className={s.checkboxLabel}>
                      I confirm this payment of <strong>{fmtRwf(momoEntry.invoiceAmount)}</strong> for {fmtMonth(momoEntry.month)}
                    </span>
                  </label>
                  {momoError && <div className={s.inlineError}>{momoError}</div>}
                  <div className={s.modalFoot}>
                    <button className={s.btnSecondary} onClick={() => setMomoEntry(null)}>Cancel</button>
                    <button
                      className={s.btnPrimary}
                      onClick={submitPay}
                      disabled={!momoPhone.trim() || !momoConfirm}
                    >
                      Pay Now
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD EMPLOYEE MODAL ══ */}
      {addOpen && (
        <div className={s.overlay} onClick={() => !addLoading && setAddOpen(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h2>Add Employee</h2>
              <button className={s.modalClose} onClick={() => setAddOpen(false)} disabled={addLoading}>✕</button>
            </div>
            <div className={s.modalBody}>
              <label className={s.lbl}>Full Name</label>
              <input className={s.inp} placeholder="e.g. Jean-Paul Habimana" value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
              <label className={s.lbl}>Phone (optional)</label>
              <input className={s.inp} type="tel" placeholder="07XX XXX XXX" value={addPhone} onChange={e => setAddPhone(e.target.value)} />
              {addError && <div className={s.inlineError}>{addError}</div>}
              <div className={s.modalFoot}>
                <button className={s.btnSecondary} onClick={() => setAddOpen(false)} disabled={addLoading}>Cancel</button>
                <button className={s.btnPrimary} onClick={addEmployee} disabled={addLoading || !addName.trim()}>
                  {addLoading ? 'Adding…' : 'Add Employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`${s.statCard} ${accent ? s.statCardAccent : ''}`}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
      <div className={s.statSub}>{sub}</div>
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={s.settingsRow}>
      <div className={s.settingsLabel}>{label}</div>
      <div className={s.settingsValue}>{value}</div>
    </div>
  );
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <div className={s.emptyTitle}>{title}</div>
      <div className={s.emptySub}>{sub}</div>
    </div>
  );
}

// function CheckinTypeBadge({ type }: { type: string }) {
  if (type === 'institutional') return <span className={`${s.badge} ${s.bTypeInst}`}>Institutional</span>;
  if (type === 'dependent')     return <span className={`${s.badge} ${s.bTypeDep}`}>Dependent</span>;
  if (type === 'walkin')        return <span className={`${s.badge} ${s.bTypeWalk}`}>Walk-in</span>;
  return <span className={`${s.badge} ${s.bTypeInd}`}>Individual</span>;
}
