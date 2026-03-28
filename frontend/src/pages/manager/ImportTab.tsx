import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../../api/api';
import s from './ImportTab.module.css';

interface ImportRow {
  name: string;
  phone: string;
  institutionName: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]/g, '');
}

function parseSheet(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = e.target?.result;
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        const rows: ImportRow[] = raw.map(r => {
          const normalized: Record<string, string> = {};
          for (const key of Object.keys(r)) {
            normalized[normalizeHeader(key)] = String(r[key] ?? '').trim();
          }
          return {
            name:            normalized['name']        ?? normalized['fullname'] ?? '',
            phone:           normalized['phone']       ?? normalized['phonenumber'] ?? normalized['mobile'] ?? '',
            institutionName: normalized['institution'] ?? normalized['institutionname'] ?? normalized['company'] ?? '',
          };
        }).filter(r => r.name.length > 0);

        resolve(rows);
      } catch (err) {
        reject(new Error('Could not parse file. Make sure it has a "Name" column.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

export default function ImportTab() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows,      setRows]      = useState<ImportRow[]>([]);
  const [parseErr,  setParseErr]  = useState('');
  const [importing, setImporting] = useState(false);
  const [result,    setResult]    = useState<ImportResult | null>(null);
  const [fileName,  setFileName]  = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseErr(''); setResult(null); setRows([]);
    setFileName(file.name);
    try {
      const parsed = await parseSheet(file);
      if (parsed.length === 0) {
        setParseErr('No valid rows found. Make sure the file has a "Name" column.');
        return;
      }
      setRows(parsed);
    } catch (err: unknown) {
      setParseErr(err instanceof Error ? err.message : 'Parse error');
    }
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const { data } = await api.post<ImportResult>('/users/import', {
        members: rows.map(r => ({
          name:            r.name,
          phone:           r.phone  || undefined,
          institutionName: r.institutionName || undefined,
        })),
      });
      setResult(data);
      setRows([]);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setParseErr(e.response?.data?.error ?? 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Phone', 'Institution'],
      ['Alice Uwera', '0781234567', 'RwandAir'],
      ['Bob Nkurunziza', '', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.writeFile(wb, 'member_import_template.xlsx');
  }

  function reset() {
    setRows([]); setParseErr(''); setResult(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <div>
          <h2 className={s.title}>Bulk Import Members</h2>
          <p className={s.sub}>Upload an Excel (.xlsx) or CSV file to create multiple members at once. Members without a phone number will be created as <strong>unclaimed</strong> — they activate their account later via the Claim page.</p>
        </div>
        <button type="button" className={s.templateBtn} onClick={downloadTemplate}>
          Download Template
        </button>
      </div>

      {/* Upload area */}
      {rows.length === 0 && !result && (
        <div className={s.dropZone} onClick={() => fileRef.current?.click()}>
          <div className={s.dropIcon}>📂</div>
          <div className={s.dropText}>
            {fileName ? `Parsing "${fileName}"…` : 'Click to choose file'}
          </div>
          <div className={s.dropHint}>.xlsx, .xls, or .csv · Required column: Name</div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className={s.fileInput}
            onChange={handleFile}
          />
        </div>
      )}

      {parseErr && <div className={s.error}>{parseErr}</div>}

      {/* Preview */}
      {rows.length > 0 && (
        <>
          <div className={s.previewHeader}>
            <span className={s.previewCount}>{rows.length} members ready to import</span>
            <button type="button" className={s.resetBtn} onClick={reset}>Clear</button>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Name</th>
                  <th className={s.th}>Phone</th>
                  <th className={s.th}>Institution</th>
                  <th className={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={s.tr}>
                    <td className={s.td}>{r.name}</td>
                    <td className={s.td}>{r.phone || <span className={s.empty}>—</span>}</td>
                    <td className={s.td}>{r.institutionName || <span className={s.empty}>—</span>}</td>
                    <td className={s.td}>
                      <button type="button" className={s.removeBtn} onClick={() => removeRow(i)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.actions}>
            <button type="button" className={s.cancelBtn} onClick={reset}>Cancel</button>
            <button
              type="button"
              className={`${s.importBtn} ${importing ? s.importBtnDisabled : ''}`}
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? `Importing ${rows.length} members…` : `Import ${rows.length} members`}
            </button>
          </div>
        </>
      )}

      {/* Result */}
      {result && (
        <div className={s.resultBox}>
          <div className={s.resultRow}>
            <div className={`${s.resultStat} ${s.statGreen}`}>
              <div className={s.statNum}>{result.created}</div>
              <div className={s.statLabel}>Created</div>
            </div>
            <div className={`${s.resultStat} ${s.statGray}`}>
              <div className={s.statNum}>{result.skipped}</div>
              <div className={s.statLabel}>Skipped</div>
            </div>
            <div className={`${s.resultStat} ${result.errors.length ? s.statRed : s.statGray}`}>
              <div className={s.statNum}>{result.errors.length}</div>
              <div className={s.statLabel}>Errors</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <ul className={s.errorList}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <button type="button" className={s.importBtn} onClick={reset}>Import Another File</button>
        </div>
      )}
    </div>
  );
}
