import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/api';
import { useGym } from '../hooks/useGym';
import PhoneInput, { isPhoneValid } from '../components/PhoneInput';
import s from './ClaimAccount.module.css';
import GymMindLogo from '../components/GymMindLogo';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClaimStep = 'search' | 'phone' | 'otp' | 'success';
type InstStep  = 'selectInstitution' | 'selectMember' | 'phone' | 'otp' | 'success';

interface Institution     { id: number; name: string; }
interface UnclaimedMember { id: number; name: string; parent_id: number | null; parent_name?: string; }
interface UnclaimedUser   { id: number; name: string; parent_name?: string; institution_name?: string; }
interface ClaimedUser     { id: number; name: string; phone: string; }
interface MembershipPlan  { id: number; name: string; type: string; duration_days?: number; sessions?: number; price: number; }

function formatPlanDuration(plan: MembershipPlan) {
  if (plan.type === 'session_based') return `${plan.sessions ?? '?'} sessions`;
  const d = plan.duration_days ?? 0;
  if (d >= 365) return `${Math.round(d / 365)} yr${d >= 730 ? 's' : ''}`;
  if (d >= 30)  return `${Math.round(d / 30)} mo`;
  return `${d} days`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClaimAccount() {
  const { gymSlug } = useGym();
  const [searchParams] = useSearchParams();
  const type     = searchParams.get('type'); // 'institutional' | 'individual' | null
  const prePhone = searchParams.get('phone') ?? '';

  // ── Institutional flow state ──────────────────────────────────────────────
  const [instStep,          setInstStep]         = useState<InstStep>('selectInstitution');
  const [institutions,      setInstitutions]     = useState<Institution[]>([]);
  const [instLoading,       setInstLoading]      = useState(false);
  const [selectedInst,      setSelectedInst]     = useState<Institution | null>(null);
  const [unclaimedMembers,  setUnclaimedMembers] = useState<UnclaimedMember[]>([]);
  const [membersLoading,    setMembersLoading]   = useState(false);
  const [memberQuery,       setMemberQuery]      = useState('');
  const [selectedMember,    setSelectedMember]   = useState<UnclaimedMember | null>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const [instPhone,         setInstPhone]        = useState(prePhone);
  const [instPhoneValid,    setInstPhoneValid]   = useState(() => isPhoneValid(prePhone));
  const [instOtp,           setInstOtp]          = useState(['', '', '', '', '', '']);
  const [instDevCode,       setInstDevCode]      = useState<string | null>(null);
  const [instBusy,          setInstBusy]         = useState(false);
  const [instError,         setInstError]        = useState('');
  const [instClaimed,       setInstClaimed]      = useState<ClaimedUser | null>(null);
  const instPhoneRef = useRef<HTMLInputElement>(null);
  const instOtpRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  // ── Individual flow state ─────────────────────────────────────────────────
  const [indivName,         setIndivName]        = useState('');
  const [indivPhone,        setIndivPhone]       = useState(prePhone);
  const [indivPhoneValid,   setIndivPhoneValid]  = useState(() => isPhoneValid(prePhone));
  const [indivPlanId,       setIndivPlanId]      = useState<number | ''>('');
  const [indivPlans,        setIndivPlans]       = useState<MembershipPlan[]>([]);
  const [indivPlansLoading, setIndivPlansLoading]= useState(false);
  const [indivLoading,      setIndivLoading]     = useState(false);
  const [indivError,        setIndivError]       = useState('');
  const [indivSubmitted,    setIndivSubmitted]   = useState(false);
  const [indivPending,      setIndivPending]     = useState(false);

  // ── Search/claim flow state (no type param — existing flow) ──────────────
  const [step,       setStep]       = useState<ClaimStep>('search');
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState<UnclaimedUser[]>([]);
  const [selected,   setSelected]   = useState<UnclaimedUser | null>(null);
  const [phone,      setPhone]      = useState(prePhone);
  const [phoneValid, setPhoneValid] = useState(() => isPhoneValid(prePhone));
  const [devCode,    setDevCode]    = useState<string | null>(null);
  const [otp,        setOtp]        = useState(['', '', '', '', '', '']);
  const [claimedUser,setClaimedUser]= useState<ClaimedUser | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef  = useRef<HTMLInputElement>(null);
  const otpRefs   = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  // ── Institutional: load institutions on mount ─────────────────────────────
  useEffect(() => {
    if (type !== 'institutional') return;
    setInstLoading(true);
    api.get<Institution[]>('/institutions/public')
      .then(r => setInstitutions(r.data))
      .catch(() => setInstitutions([]))
      .finally(() => setInstLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Individual: load plans on mount ──────────────────────────────────────
  useEffect(() => {
    if (type !== 'individual') return;
    setIndivPlansLoading(true);
    api.get<MembershipPlan[]>('/checkin/plans')
      .then(r => setIndivPlans(r.data))
      .catch(() => setIndivPlans([]))
      .finally(() => setIndivPlansLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Search claim: pre-select from URL params ──────────────────────────────
  useEffect(() => {
    if (type) return;
    const userId = searchParams.get('userId');
    const name   = searchParams.get('name');
    if (userId && name) {
      setSelected({ id: parseInt(userId), name, parent_name: undefined, institution_name: undefined });
      setStep('phone');
      setTimeout(() => phoneRef.current?.focus(), 50);
    } else {
      searchRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Search: debounced query ───────────────────────────────────────────────
  useEffect(() => {
    if (type) return;
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get<UnclaimedUser[]>(`/auth/claim-search?name=${encodeURIComponent(query.trim())}`);
        setResults(data);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, type]);

  // ── Institutional helpers ─────────────────────────────────────────────────

  async function selectInstitution(inst: Institution) {
    setSelectedInst(inst);
    setMemberQuery('');
    setInstStep('selectMember');
    setMembersLoading(true);
    try {
      const { data } = await api.get<UnclaimedMember[]>(`/institutions/${inst.id}/members/unclaimed`);
      setUnclaimedMembers(data);
    } catch { setUnclaimedMembers([]); }
    finally {
      setMembersLoading(false);
      setTimeout(() => memberSearchRef.current?.focus(), 50);
    }
  }

  function selectMember(m: UnclaimedMember) {
    setSelectedMember(m);
    setInstStep('phone');
    setInstError('');
    setTimeout(() => instPhoneRef.current?.focus(), 50);
  }

  async function instSendOtp() {
    if (!instPhone.trim()) return;
    setInstBusy(true); setInstError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone: instPhone.trim() });
      setInstDevCode(data.devCode ?? null);
      setInstStep('otp');
      setTimeout(() => instOtpRefs.current[0]?.focus(), 50);
    } catch (e: any) {
      setInstError(e.response?.data?.error ?? 'Failed to send OTP.');
    } finally { setInstBusy(false); }
  }

  async function instClaim(code: string) {
    if (code.length !== 6 || !selectedMember) return;
    setInstBusy(true); setInstError('');
    try {
      const { data } = await api.post('/auth/claim-account', {
        userId: selectedMember.id,
        phone:  instPhone.trim(),
        code,
      });
      setInstClaimed(data.user);
      setInstStep('success');
    } catch (e: any) {
      setInstError(e.response?.data?.error ?? 'Invalid or expired code.');
      setInstOtp(['', '', '', '', '', '']);
      setTimeout(() => instOtpRefs.current[0]?.focus(), 50);
    } finally { setInstBusy(false); }
  }

  function instHandleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...instOtp];
      if (next[idx]) { next[idx] = ''; setInstOtp(next); }
      else if (idx > 0) { next[idx - 1] = ''; setInstOtp(next); instOtpRefs.current[idx - 1]?.focus(); }
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    const next = [...instOtp];
    next[idx] = e.key;
    setInstOtp(next);
    if (idx < 5) instOtpRefs.current[idx + 1]?.focus();
    else instClaim(next.join(''));
  }

  function instHandleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return;
    setInstOtp(digits.split(''));
    instOtpRefs.current[5]?.focus();
    instClaim(digits);
  }

  // ── Individual helpers ────────────────────────────────────────────────────

  async function submitIndividual() {
    if (!indivName.trim() || !indivPhoneValid || !indivPlanId) return;
    setIndivLoading(true); setIndivError('');
    try {
      await api.post('/membership-requests', {
        newMemberName:  indivName.trim(),
        newMemberPhone: indivPhone.trim(),
        planId:         Number(indivPlanId),
      });
      setIndivSubmitted(true);
    } catch (e: any) {
      const msg: string = e.response?.data?.error ?? 'Failed to submit. Please try again.';
      if (msg.toLowerCase().includes('pending') || msg.toLowerCase().includes('already registered')) {
        setIndivPending(true);
      } else {
        setIndivError(msg);
      }
    } finally { setIndivLoading(false); }
  }

  // ── Search/claim helpers ──────────────────────────────────────────────────

  function selectUser(u: UnclaimedUser) {
    setSelected(u);
    setStep('phone');
    setError('');
    setTimeout(() => phoneRef.current?.focus(), 50);
  }

  async function handleSendOtp() {
    if (!phone.trim()) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone: phone.trim() });
      setDevCode(data.devCode ?? null);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to send OTP.');
    } finally { setLoading(false); }
  }

  async function handleClaim(code: string) {
    if (code.length !== 6 || !selected) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/claim-account', {
        userId: selected.id,
        phone:  phone.trim(),
        code,
      });
      setClaimedUser(data.user);
      setStep('success');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Invalid or expired code.');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally { setLoading(false); }
  }

  function handleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...otp];
      if (next[idx]) { next[idx] = ''; setOtp(next); }
      else if (idx > 0) { next[idx - 1] = ''; setOtp(next); otpRefs.current[idx - 1]?.focus(); }
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    const next = [...otp];
    next[idx] = e.key;
    setOtp(next);
    if (idx < 5) otpRefs.current[idx + 1]?.focus();
    else handleClaim(next.join(''));
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return;
    setOtp(digits.split(''));
    otpRefs.current[5]?.focus();
    handleClaim(digits);
  }

  function reset() {
    setStep('search'); setQuery(''); setResults([]); setSelected(null);
    setPhone(prePhone); setPhoneValid(isPhoneValid(prePhone));
    setDevCode(null); setOtp(['', '', '', '', '', '']);
    setClaimedUser(null); setError('');
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  const stepIndex     = { search: 0, phone: 1, otp: 2, success: 3 }[step];
  const instStepIndex = { selectInstitution: 0, selectMember: 1, phone: 2, otp: 3, success: 4 }[instStep];

  return (
    <div className={s.page}>
      <div className={s.card}>

        <div className={s.logo}>
          <GymMindLogo size={56} variant="color" />
          <div className={s.logoText}>GymMind</div>
          <div className={s.logoSub}>
            {type === 'institutional' ? 'Activate your company membership'
              : type === 'individual' ? 'Join the gym'
              : 'Activate your membership'} · {gymSlug}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
            INSTITUTIONAL FLOW
        ══════════════════════════════════════════════════════ */}
        {type === 'institutional' && (
          <>
            {instStep !== 'success' && (
              <div className={s.stepIndicator}>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={
                    instStepIndex > i ? s.dotDone : instStepIndex === i ? s.dotActive : s.dot
                  } />
                ))}
              </div>
            )}

            {/* Step 1: Select institution */}
            {instStep === 'selectInstitution' && (
              <>
                <div className={s.stepHeading}>Select your company</div>
                {instLoading && <p className={s.hint}>Loading…</p>}
                {!instLoading && institutions.length === 0 && (
                  <p className={s.hint}>No corporate memberships found. Contact reception.</p>
                )}
                <ul className={s.instList}>
                  {institutions.map(inst => (
                    <li key={inst.id}>
                      <button type="button" className={s.instItem} onClick={() => selectInstitution(inst)}>
                        <span className={s.instAvatar}>{inst.name[0].toUpperCase()}</span>
                        <span className={s.instName}>{inst.name}</span>
                        <span className={s.resultArrow}>→</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className={s.backBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  ← Back
                </button>
              </>
            )}

            {/* Step 2: Search unclaimed members */}
            {instStep === 'selectMember' && (() => {
              const filtered = memberQuery.trim().length >= 2
                ? unclaimedMembers.filter(m =>
                    m.name.toLowerCase().includes(memberQuery.trim().toLowerCase())
                  )
                : [];
              return (
                <>
                  <div className={s.selectedCard}>
                    <span className={s.selectedLabel}>Company</span>
                    <span className={s.selectedName}>{selectedInst?.name}</span>
                  </div>
                  <input
                    ref={memberSearchRef}
                    type="search"
                    placeholder="Type your name…"
                    value={memberQuery}
                    onChange={e => setMemberQuery(e.target.value)}
                    className={s.memberSearchInput}
                    autoComplete="off"
                  />
                  {membersLoading && <p className={s.hint}>Loading members…</p>}
                  {!membersLoading && memberQuery.trim().length < 2 && (
                    <p className={s.hint}>Start typing your name to search</p>
                  )}
                  {!membersLoading && memberQuery.trim().length >= 2 && filtered.length > 0 && (
                    <ul className={s.resultList}>
                      {filtered.map(m => (
                        <li key={m.id}>
                          <button type="button" className={s.resultItem} onClick={() => selectMember(m)}>
                            <div className={s.resultInfo}>
                              <span className={s.resultName}>{m.name}</span>
                              <span className={s.resultMeta}>
                                {m.parent_name ? `Dependent of ${m.parent_name}` : 'Employee'}
                              </span>
                            </div>
                            <span className={s.resultArrow}>→</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!membersLoading && memberQuery.trim().length >= 2 && filtered.length === 0 && (
                    <div className={s.notFound}>
                      No match found for "{memberQuery.trim()}".
                      <br />
                      <button type="button" className={s.newMemberBtn}
                        onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                        My name is not here →
                      </button>
                    </div>
                  )}
                  <button type="button" className={s.backBtn}
                    onClick={() => { setInstStep('selectInstitution'); setInstError(''); }}>
                    ← Back
                  </button>
                </>
              );
            })()}

            {/* Step 3: Phone */}
            {instStep === 'phone' && selectedMember && (
              <>
                <div className={s.selectedCard}>
                  <span className={s.selectedLabel}>Claiming account for</span>
                  <span className={s.selectedName}>{selectedMember.name}</span>
                </div>
                <label className={s.label}>Your phone number</label>
                <PhoneInput
                  value={instPhone}
                  onChange={(v, valid) => { setInstPhone(v); setInstPhoneValid(valid); }}
                  inputClassName={s.input}
                  inputRef={instPhoneRef}
                  onEnter={instSendOtp}
                />
                {instError && <div className={s.error}>{instError}</div>}
                <button
                  type="button"
                  className={`${s.btn} ${(!instPhoneValid || instBusy) ? s.btnDisabled : ''}`}
                  onClick={instSendOtp}
                  disabled={!instPhoneValid || instBusy}
                >
                  {instBusy ? 'Sending…' : 'Send Code →'}
                </button>
                <button type="button" className={s.backBtn}
                  onClick={() => { setInstStep('selectMember'); setInstError(''); }}>
                  ← Back
                </button>
              </>
            )}

            {/* Step 4: OTP */}
            {instStep === 'otp' && (
              <>
                <div className={s.selectedCard}>
                  <span className={s.selectedLabel}>Activating account for</span>
                  <span className={s.selectedName}>{selectedMember?.name}</span>
                </div>
                <label className={s.label}>Enter code sent to {instPhone}</label>
                <div className={s.otpGrid} onPaste={instHandleOtpPaste}>
                  {instOtp.map((d, i) => (
                    <input
                      key={i}
                      ref={el => { instOtpRefs.current[i] = el; }}
                      aria-label={`Digit ${i + 1}`}
                      type="text" inputMode="numeric" maxLength={1}
                      value={d} onChange={() => {}}
                      onKeyDown={e => instHandleOtpKey(i, e)}
                      className={`${s.otpCell} ${d ? s.otpCellFilled : ''}`}
                    />
                  ))}
                </div>
                {instDevCode && <div className={s.devBadge}>DEV code: {instDevCode}</div>}
                {instError && <div className={s.error}>{instError}</div>}
                <button
                  type="button"
                  className={`${s.btn} ${(!instOtp.every(d => d) || instBusy) ? s.btnDisabled : ''}`}
                  onClick={() => instClaim(instOtp.join(''))}
                  disabled={!instOtp.every(d => d) || instBusy}
                >
                  {instBusy ? 'Activating…' : 'Activate Account →'}
                </button>
                <button type="button" className={s.backBtn}
                  onClick={() => { setInstStep('phone'); setInstError(''); setInstOtp(['', '', '', '', '', '']); }}>
                  ← Change number
                </button>
              </>
            )}

            {/* Success */}
            {instStep === 'success' && instClaimed && (
              <div className={s.successBox}>
                <div className={s.successIcon}>🎉</div>
                <div className={s.successTitle}>Welcome, {instClaimed.name}!</div>
                <div className={s.successSub}>Your account is now active. You can check in with your phone number.</div>
                <div className={s.memberCard}>
                  <div className={s.memberCardRow}>
                    <span>Name</span><span className={s.memberCardValue}>{instClaimed.name}</span>
                  </div>
                  <div className={`${s.memberCardRow} ${s.memberCardRowLast}`}>
                    <span>Phone</span><span className={s.memberCardValue}>{instClaimed.phone}</span>
                  </div>
                </div>
                <button type="button" className={s.checkinBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  Go to Check-in
                </button>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════
            INDIVIDUAL FLOW
        ══════════════════════════════════════════════════════ */}
        {type === 'individual' && (
          <>
            {indivPending ? (
              <div className={s.successBox}>
                <div className={s.successIcon}>⏳</div>
                <div className={s.successTitle}>Request Pending</div>
                <div className={s.successSub}>
                  Your membership request has been submitted.<br />
                  Please wait for the gym manager to approve it.<br />
                  You&apos;ll receive an SMS when approved.
                </div>
                <button type="button" className={s.checkinBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  ← Go back to check-in
                </button>
              </div>
            ) : !indivSubmitted ? (
              <>
                <div className={s.stepHeading}>Join as a new member</div>
                <p className={s.hint}>Fill in your details and select a plan to get started.</p>

                <label className={s.label}>Your full name</label>
                <input
                  type="text"
                  placeholder="Jean-Paul Habimana"
                  value={indivName}
                  onChange={e => setIndivName(e.target.value)}
                  className={s.input}
                  autoFocus
                />

                <label className={`${s.label} ${s.labelSpaced}`}>Phone number</label>
                <PhoneInput
                  value={indivPhone}
                  onChange={(v, valid) => { setIndivPhone(v); setIndivPhoneValid(valid); }}
                  inputClassName={s.input}
                />

                <label className={`${s.label} ${s.labelSpaced}`}>Membership plan</label>
                {indivPlansLoading ? (
                  <p className={s.hint}>Loading plans…</p>
                ) : (
                  <select
                    value={indivPlanId}
                    onChange={e => setIndivPlanId(e.target.value === '' ? '' : Number(e.target.value))}
                    className={s.select}
                  >
                    <option value="">-- Choose a plan --</option>
                    {indivPlans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} – {formatPlanDuration(p)} – {p.price.toLocaleString()} RWF
                      </option>
                    ))}
                  </select>
                )}

                {indivError && <div className={s.error}>{indivError}</div>}
                <button
                  type="button"
                  className={`${s.btn} ${(!indivName.trim() || !indivPhoneValid || !indivPlanId || indivLoading) ? s.btnDisabled : ''}`}
                  onClick={submitIndividual}
                  disabled={!indivName.trim() || !indivPhoneValid || !indivPlanId || indivLoading}
                >
                  {indivLoading ? 'Submitting…' : 'Submit Request →'}
                </button>
                <button type="button" className={s.backBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  ← Cancel
                </button>
              </>
            ) : (
              <div className={s.successBox}>
                <div className={s.successIcon}>🎉</div>
                <div className={s.successTitle}>Request Submitted!</div>
                <div className={s.successSub}>
                  Welcome {indivName}! Your membership request has been sent.
                  Please pay at the reception desk to complete your registration.
                </div>
                <button type="button" className={s.checkinBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  Back to Check-in
                </button>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════
            SEARCH / CLAIM FLOW  (no ?type param — existing flow)
        ══════════════════════════════════════════════════════ */}
        {!type && (
          <>
            {step !== 'success' && (
              <div className={s.stepIndicator}>
                {(['search', 'phone', 'otp'] as const).map((st, i) => (
                  <div key={st} className={
                    stepIndex > i ? s.dotDone : stepIndex === i ? s.dotActive : s.dot
                  } />
                ))}
              </div>
            )}

            {/* Search */}
            {step === 'search' && (
              <>
                <label className={s.label}>Search your name</label>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Type at least 2 letters…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className={s.input}
                />
                <p className={s.hint}>Your name should already be registered by the gym manager.</p>

                {results.length > 0 && (
                  <ul className={s.resultList}>
                    {results.map(u => (
                      <li key={u.id}>
                        <button type="button" className={s.resultItem} onClick={() => selectUser(u)}>
                          <div className={s.resultInfo}>
                            <span className={s.resultName}>{u.name}</span>
                            <span className={s.resultMeta}>
                              {u.parent_name && u.institution_name
                                ? `${u.parent_name} · ${u.institution_name}`
                                : u.institution_name
                                ? `${u.institution_name} employee`
                                : 'Individual member'}
                            </span>
                          </div>
                          <span className={s.resultArrow}>→</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {query.trim().length >= 2 && results.length === 0 && (
                  <div className={s.notFound}>
                    No pre-loaded account found for "{query.trim()}".
                    <br />
                    <button
                      type="button"
                      className={s.newMemberBtn}
                      onClick={() => window.location.href = `/${gymSlug}/manager`}
                    >
                      I'm a new member → see reception
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Phone */}
            {step === 'phone' && selected && (
              <>
                <div className={s.selectedCard}>
                  <span className={s.selectedLabel}>Claiming account for</span>
                  <span className={s.selectedName}>{selected.name}</span>
                </div>
                <label className={s.label}>Your phone number</label>
                <PhoneInput
                  value={phone}
                  onChange={(v, valid) => { setPhone(v); setPhoneValid(valid); }}
                  inputClassName={s.input}
                  inputRef={phoneRef}
                  onEnter={handleSendOtp}
                />
                {error && <div className={s.error}>{error}</div>}
                <button
                  type="button"
                  className={`${s.btn} ${(!phoneValid || loading) ? s.btnDisabled : ''}`}
                  onClick={handleSendOtp}
                  disabled={!phoneValid || loading}
                >
                  {loading ? 'Sending…' : 'Send Code →'}
                </button>
                <button type="button" className={s.backBtn}
                  onClick={() => { setStep('search'); setError(''); }}>
                  ← Back to search
                </button>
              </>
            )}

            {/* OTP */}
            {step === 'otp' && (
              <>
                <div className={s.selectedCard}>
                  <span className={s.selectedLabel}>Activating account for</span>
                  <span className={s.selectedName}>{selected?.name}</span>
                </div>
                <label className={s.label}>Enter code sent to {phone}</label>
                <div className={s.otpGrid} onPaste={handleOtpPaste}>
                  {otp.map((d, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el; }}
                      aria-label={`Digit ${i + 1}`}
                      type="text" inputMode="numeric" maxLength={1}
                      value={d} onChange={() => {}}
                      onKeyDown={e => handleOtpKey(i, e)}
                      className={`${s.otpCell} ${d ? s.otpCellFilled : ''}`}
                    />
                  ))}
                </div>
                {devCode && <div className={s.devBadge}>DEV code: {devCode}</div>}
                {error && <div className={s.error}>{error}</div>}
                <button
                  type="button"
                  className={`${s.btn} ${(!otp.every(d => d) || loading) ? s.btnDisabled : ''}`}
                  onClick={() => handleClaim(otp.join(''))}
                  disabled={!otp.every(d => d) || loading}
                >
                  {loading ? 'Activating…' : 'Activate Account →'}
                </button>
                <button type="button" className={s.backBtn}
                  onClick={() => { setStep('phone'); setError(''); setOtp(['', '', '', '', '', '']); }}>
                  ← Change number
                </button>
              </>
            )}

            {/* Success */}
            {step === 'success' && claimedUser && (
              <div className={s.successBox}>
                <div className={s.successIcon}>🎉</div>
                <div className={s.successTitle}>Welcome, {claimedUser.name}!</div>
                <div className={s.successSub}>Your account is now active. You can check in with your phone number.</div>
                <div className={s.memberCard}>
                  <div className={s.memberCardRow}>
                    <span>Name</span><span className={s.memberCardValue}>{claimedUser.name}</span>
                  </div>
                  <div className={`${s.memberCardRow} ${s.memberCardRowLast}`}>
                    <span>Phone</span><span className={s.memberCardValue}>{claimedUser.phone}</span>
                  </div>
                </div>
                <button type="button" className={s.checkinBtn}
                  onClick={() => window.location.href = `/${gymSlug}/checkin`}>
                  Go to Check-in
                </button>
                <button type="button" className={s.newBtn} onClick={reset}>
                  Activate another account
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
