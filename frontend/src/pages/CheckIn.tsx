import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/api';
import { useGym } from '../hooks/useGym';
import PhoneInput, { isPhoneValid } from '../components/PhoneInput';
import GymMindLogo from '../components/GymMindLogo';
import { useToast } from '../context/ToastContext';
import s from './CheckIn.module.css';

// ── Types ──────────────────────────────────────────────────────
type Step = 'phone' | 'otp' | 'service' | 'result';

interface ServiceItem {
  id: number;
  name: string;
  description: string | null;
  price_per_visit: number;
  walkin_price: number;
  currency: string;
  is_default: boolean;
}

type CheckinResponse =
  | { allowed: true;  checkin_type: 'individual' | 'institutional' | 'dependent'; message: string; user: { name: string }; membership?: { plan_name: string; remaining?: string }; service_name?: string }
  | { allowed: false; reason: 'no_membership' | 'membership_expired' | 'no_sessions' | 'user_suspended' | 'user_not_found' | 'already_checked_in' | 'service_not_covered' | 'service_not_in_plan' | 'pending_approval'; message: string; user?: { id: number; name: string }; expiredOn?: string; planName?: string; pendingPlan?: string; service_name?: string };

interface MembershipPlan {
  id: number;
  name: string;
  type: 'time_based' | 'session_based';
  duration_days?: number;
  sessions?: number;
  price: number;
}

// ── Component ──────────────────────────────────────────────────
export default function CheckIn() {
  const { gymSlug } = useGym();
  const toast = useToast();

  const [step,       setStep]       = useState<Step>('phone');
  const [phone,      setPhone]      = useState('');
  const [phoneValid, setPhoneValid] = useState(false);
  const [otp,        setOtp]        = useState(['', '', '', '', '', '']);
  const [devCode,    setDevCode]    = useState<string | null>(null);
  const [result,     setResult]     = useState<CheckinResponse | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [services,   setServices]   = useState<ServiceItem[]>([]);
  const [pendingOtp, setPendingOtp] = useState<string>('');

  const otpRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    phoneRef.current?.focus();
    // Pre-fetch services for service selection step
    api.get<ServiceItem[]>('/services/public')
      .then(r => setServices(r.data))
      .catch(() => {});
  }, []);

  function reset() {
    setStep('phone');
    setPhone('');
    setPhoneValid(false);
    setOtp(['', '', '', '', '', '']);
    setDevCode(null);
    setResult(null);
    setError('');
    setPendingOtp('');
    setTimeout(() => phoneRef.current?.focus(), 50);
  }

  async function handleSendOtp() {
    if (!phone.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone: phone.trim() });
      setDevCode(data.devCode ?? null);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...otp];
      if (next[idx]) {
        next[idx] = ''; setOtp(next);
      } else if (idx > 0) {
        next[idx - 1] = ''; setOtp(next);
        otpRefs.current[idx - 1]?.focus();
      }
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    e.preventDefault();
    const next = [...otp];
    next[idx] = e.key;
    setOtp(next);
    if (idx < 5) otpRefs.current[idx + 1]?.focus();
    else proceedAfterOtp(next.join(''));
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return;
    setOtp(digits.split(''));
    otpRefs.current[5]?.focus();
    proceedAfterOtp(digits);
  }

  async function handleCheckin(code: string, serviceId?: number) {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = { phone: phone.trim(), otp: code };
      if (serviceId !== undefined) body.serviceId = serviceId;
      const { data } = await api.post<CheckinResponse>('/checkin', body);
      setResult(data);
      setStep('result');
      if (data.allowed) {
        toast.success('Check-in confirmed!', `${data.user?.name ?? ''} — ${data.service_name ?? data.membership?.plan_name ?? ''}`);
      }
    } catch (err) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      const msg = e.response?.data?.message ?? e.response?.data?.error ?? 'Check-in failed. Please try again.';
      setError(msg);
      toast.error('Check-in failed', msg);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }

  // Called when OTP is complete — decides whether to show service selection.
  // Service selection only makes sense for members: we peek first (OTP not
  // consumed) so walk-in users skip straight to check-in and reach the
  // DeniedResult which has its own service selector.
  async function proceedAfterOtp(code: string) {
    if (services.length <= 1) {
      // 0 or 1 service — no selection needed
      const autoService = services.length === 1 ? services[0].id : undefined;
      handleCheckin(code, autoService);
      return;
    }

    // Multiple services: peek to see if caller has an active membership.
    // peekOTP does NOT consume the OTP — the real /checkin call does that.
    setLoading(true);
    try {
      const { data } = await api.post<{ hasMembership: boolean }>(
        '/checkin/peek',
        { phone: phone.trim(), otp: code }
      );
      setLoading(false);
      if (data.hasMembership) {
        // Known member — show service selection before the check-in call
        setPendingOtp(code);
        setStep('service');
      } else {
        // Not a member — skip service selection; DeniedResult handles walk-in services
        handleCheckin(code);
      }
    } catch {
      // Peek unavailable — fall back to direct check-in (no double-selection)
      setLoading(false);
      handleCheckin(code);
    }
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>
          <GymMindLogo size={56} variant="color" />
          <div className={s.logoText}>GymMind</div>
          <div className={s.logoSub}>{gymSlug || 'Check-in'}</div>
        </div>

        {step === 'phone' && <PhoneStep
          phone={phone}
          onPhoneChange={(v, valid) => { setPhone(v); setPhoneValid(valid); }}
          phoneValid={phoneValid}
          onSubmit={handleSendOtp}
          loading={loading}
          error={error}
          inputRef={phoneRef}
        />}

        {step === 'otp' && <OtpStep
          otp={otp}
          otpRefs={otpRefs}
          onKey={handleOtpKey}
          onPaste={handleOtpPaste}
          onSubmit={() => proceedAfterOtp(otp.join(''))}
          onBack={reset}
          loading={loading}
          error={error}
          devCode={devCode}
          phone={phone}
        />}

        {step === 'service' && <ServiceStep
          services={services}
          onSelect={(id) => handleCheckin(pendingOtp, id)}
          onBack={() => { setStep('otp'); setError(''); }}
          loading={loading}
          error={error}
        />}

        {step === 'result' && result && <ResultStep result={result} onReset={reset} phone={phone} walkinServices={services} />}

        {step === 'phone' && (
          <div className={s.signupLink}>
            Are you a gym owner?{' '}
            <Link to="/signup">Sign up free →</Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────
function PhoneStep({ phone, onPhoneChange, phoneValid, onSubmit, loading, error, inputRef }: {
  phone: string;
  onPhoneChange: (value: string, isValid: boolean) => void;
  phoneValid: boolean;
  onSubmit: () => void;
  loading: boolean;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <label className={s.label}>Member phone number</label>
      <PhoneInput
        value={phone}
        onChange={onPhoneChange}
        inputClassName={s.phoneInput}
        inputRef={inputRef}
        onEnter={onSubmit}
      />
      <button
        type="button"
        className={`${s.btn} ${(!phoneValid || loading) ? s.btnDisabled : ''}`}
        onClick={onSubmit}
        disabled={!phoneValid || loading}
      >
        {loading ? 'Sending…' : 'Send Code →'}
      </button>
      {error && <div className={s.error}>{error}</div>}
      <p className={s.hint}>A 6-digit code will be sent to this number</p>
    </>
  );
}

function OtpStep({ otp, otpRefs, onKey, onPaste, onSubmit, onBack, loading, error, devCode, phone }: {
  otp: string[];
  otpRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onKey: (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
  error: string;
  devCode: string | null;
  phone: string;
}) {
  const filled = otp.every(d => d !== '');
  return (
    <>
      <label className={s.label}>Enter 6-digit code for {phone}</label>
      <div className={s.otpGrid} onPaste={onPaste}>
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={el => { otpRefs.current[i] = el; }}
            aria-label={`Digit ${i + 1}`}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={() => {}}
            onKeyDown={e => onKey(i, e)}
            onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className={`${s.otpCell} ${digit ? s.otpCellFilled : ''}`}
          />
        ))}
      </div>
      {devCode && <div className={s.devBadge}>DEV code: {devCode}</div>}
      {error && <div className={s.error}>{error}</div>}
      <button
        type="button"
        className={`${s.btn} ${(!filled || loading) ? s.btnDisabled : ''}`}
        onClick={onSubmit}
        disabled={!filled || loading}
      >
        {loading ? 'Checking in…' : 'Check In →'}
      </button>
      <button type="button" className={s.backBtn} onClick={onBack}>← Back</button>
    </>
  );
}

function ServiceStep({ services, onSelect, onBack, loading, error }: {
  services: ServiceItem[];
  onSelect: (serviceId: number) => void;
  onBack: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <>
      <label className={s.label}>Select a service</label>
      <div className={s.serviceSelectGrid}>
        {services.map(svc => (
          <button
            key={svc.id}
            type="button"
            className={s.serviceSelectCard}
            onClick={() => onSelect(svc.id)}
            disabled={loading}
          >
            <div className={s.serviceSelectName}>{svc.name}</div>
            {svc.description && <div className={s.serviceSelectDesc}>{svc.description}</div>}
            <div className={s.serviceSelectPrice}>
              {svc.price_per_visit > 0
                ? `${svc.price_per_visit.toLocaleString()} ${svc.currency}`
                : 'Included'}
            </div>
          </button>
        ))}
      </div>
      {error && <div className={s.error}>{error}</div>}
      {loading && <div className={s.hint}>Checking access…</div>}
      <button type="button" className={s.backBtn} onClick={onBack}>← Back</button>
    </>
  );
}

function ResultStep({ result, onReset, phone, walkinServices }: { result: CheckinResponse; onReset: () => void; phone: string; walkinServices: ServiceItem[] }) {
  if (result.allowed) return <AllowedResult result={result} onReset={onReset} />;
  return <DeniedResult result={result} onReset={onReset} phone={phone} walkinServices={walkinServices} />;
}

// ── Success screen ────────────────────────────────────────────
function AllowedResult({ result, onReset }: {
  result: Extract<CheckinResponse, { allowed: true }>;
  onReset: () => void;
}) {
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); onReset(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bgClass =
    result.checkin_type === 'institutional' ? s.bgEmerald :
    result.checkin_type === 'dependent'     ? s.bgBlue    :
                                              s.bgGreen;

  const typeLabel =
    result.checkin_type === 'institutional' ? 'Corporate Access' :
    result.checkin_type === 'dependent'     ? 'Dependent Access' :
                                              'Member';

  // Membership/access line
  const { plan_name, remaining } = result.membership ?? {};
  const accessLine = plan_name
    ? remaining ? `${plan_name} · ${remaining}` : plan_name
    : typeLabel;

  // Low-balance warnings
  const remainingNum  = remaining ? parseInt(remaining, 10) : null;
  const isLowSessions = !!remaining?.includes('session') && remainingNum !== null && remainingNum <= 1;
  const isLowDays     = !!remaining?.includes('day')     && remainingNum !== null && remainingNum <= 7;
  const showWarning   = isLowSessions || isLowDays;
  const warningText   = isLowSessions
    ? '⚠ Last session — please renew your membership'
    : `⚠ Membership expires in ${remainingNum} day${remainingNum !== 1 ? 's' : ''} — please renew soon`;

  // Date/time at moment of render
  const now      = new Date();
  const datePart = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const checkinTime = `${datePart}  ·  ${timePart}`;

  return (
    <>
      <div className={`${s.successBox} ${bgClass}`}>
        {/* White circle with green checkmark */}
        <div className={s.successCheckCircle}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <polyline
              points="6,18 15,27 30,10"
              stroke="#0F6E56"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className={s.successName}>{result.user.name}</div>

        <div className={s.successDivider} />

        {result.service_name && (
          <>
            <div className={s.successServiceLabel}>SERVICE</div>
            <div className={s.successServiceBadge}>{result.service_name}</div>
          </>
        )}

        <div className={s.successDateTime}>{checkinTime}</div>

        <div className={s.successMeta}>{accessLine}</div>
      </div>

      {showWarning && (
        <div className={s.warnBanner}>{warningText}</div>
      )}

      <div className={s.successCountdown}>Returning in {countdown}…</div>
      <button type="button" className={s.successBtn} onClick={onReset}>
        Check in another →
      </button>
    </>
  );
}

// ── Fixes 1, 2, 4: Denied screen with countdown + plan browser + walk-in ───
type DeniedSubScreen = 'default' | 'plans' | 'planConfirm' | 'walkIn' | 'walkInPayment' | 'walkInSuccess' | 'walkInFailed' | 'walkInTimeout' | 'walkInReception' | 'nameSearch' | 'register' | 'chooseType' | 'requestSubmitted' | 'payment' | 'paymentSuccess' | 'paymentFailed' | 'paymentTimeout';

function formatPrice(price: number) {
  return `${price.toLocaleString()} RWF`;
}

function formatDuration(plan: MembershipPlan) {
  if (plan.type === 'session_based') return `${plan.sessions ?? '?'} sessions`;
  const d = plan.duration_days ?? 0;
  if (d >= 365) return `${Math.round(d / 365)} year${d >= 730 ? 's' : ''}`;
  if (d >= 30)  return `${Math.round(d / 30)} month${d > 30 ? 's' : ''}`;
  return `${d} days`;
}

function DeniedResult({ result, onReset, phone, walkinServices }: {
  result: Extract<CheckinResponse, { allowed: false }>;
  onReset: () => void;
  phone: string;
  walkinServices: ServiceItem[];
}) {
  const navigate    = useNavigate();
  const { gymSlug } = useGym();
  const toast       = useToast();

  const initialCountdown = 60;

  const [countdown, setCountdown] = useState(initialCountdown);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(initialCountdown);
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timerRef.current!); timerRef.current = null; onReset(); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  function pauseCountdown() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => {
    if (result.reason !== 'user_not_found') startCountdown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    switch (result.reason) {
      case 'no_membership':
        toast.warning('No active membership', 'Please buy a plan or pay for today');
        break;
      case 'membership_expired':
        toast.warning('Membership expired', 'Expired — please renew');
        break;
      case 'no_sessions':
        toast.warning('No sessions remaining', 'Please buy more sessions to continue');
        break;
      case 'user_suspended':
        toast.error('Account suspended', 'Please contact reception');
        break;
      case 'pending_approval':
        toast.warning('Membership pending', 'Your request is waiting for manager approval');
        break;
      case 'service_not_covered':
        toast.warning('Service not included', 'This service is not covered by your plan');
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fix 1, 2: sub-screen state
  const [subScreen,     setSubScreen]     = useState<DeniedSubScreen>(result.reason === 'user_not_found' ? 'chooseType' : 'default');
  const [plans,         setPlans]         = useState<MembershipPlan[]>([]);
  const [plansLoading,  setPlansLoading]  = useState(false);
  const [selectedPlan,  setSelectedPlan]  = useState<MembershipPlan | null>(null);

  // Screen A registration state
  const [regName,        setRegName]       = useState('');
  const [regPhone,       setRegPhone]      = useState(phone);
  const [regPhoneValid,  setRegPhoneValid] = useState(() => isPhoneValid(phone));
  const [regPlanId,      setRegPlanId]     = useState<number | ''>('');
  const [regLoading,     setRegLoading]    = useState(false);
  const [regError,       setRegError]      = useState('');

  // Screen B plan-request state
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError,   setConfirmError]  = useState('');

  // Screen C countdown
  const [reqCountdown,   setReqCountdown]  = useState(8);
  const reqTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Payment flow state (Screens D–G)
  const [requestId,         setRequestId]         = useState<number | null>(null);
  const [planAmount,        setPlanAmount]         = useState<number>(0);
  const [planName,          setPlanName]           = useState<string>('');
  const [memberName,        setMemberName]         = useState<string>('');
  const [momoPhone,         setMomoPhone]          = useState(phone);
  const [momoPhoneValid,    setMomoPhoneValid]     = useState(() => isPhoneValid(phone));
  const [referenceId,       setReferenceId]        = useState<string | null>(null);
  const [paymentLoading,    setPaymentLoading]     = useState(false);
  const [paymentError,      setPaymentError]       = useState('');
  const [paymentCountdown,  setPaymentCountdown]   = useState(60);
  const [paySuccessCountdown, setPaySuccessCountdown] = useState(60);

  // Walk-in day pass state
  const [walkinSelected,         setWalkinSelected]         = useState<number[]>([]);
  const [walkinReferenceId,      setWalkinReferenceId]      = useState<string | null>(null);
  const [walkinMomoPhone,        setWalkinMomoPhone]        = useState(phone);
  const [walkinMomoPhoneValid,   setWalkinMomoPhoneValid]   = useState(() => isPhoneValid(phone));
  const [walkinPaymentLoading,   setWalkinPaymentLoading]   = useState(false);
  const [walkinPaymentError,     setWalkinPaymentError]     = useState('');
  const [walkinPaymentCountdown, setWalkinPaymentCountdown] = useState(60);
  const [walkinSuccessCountdown, setWalkinSuccessCountdown] = useState(60);
  const [walkinSuccessServices,  setWalkinSuccessServices]  = useState<string[]>([]);
  const [walkinTotal,            setWalkinTotal]            = useState(0);

  // Existing inline name search
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; institution_name?: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (subScreen === 'nameSearch') setTimeout(() => searchRef.current?.focus(), 50);
  }, [subScreen]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data } = await api.get(`/auth/claim-search?name=${encodeURIComponent(searchQuery.trim())}`);
        setSearchResults(data);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Pre-fetch plans for Screen A (new member registration)
  useEffect(() => {
    if (result.reason === 'user_not_found') {
      setPlansLoading(true);
      api.get<MembershipPlan[]>('/checkin/plans')
        .then(r => setPlans(r.data))
        .catch(() => setPlans([]))
        .finally(() => setPlansLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Screen C auto-reset countdown
  useEffect(() => {
    if (subScreen !== 'requestSubmitted') return;
    setReqCountdown(8);
    reqTimerRef.current = setInterval(() => {
      setReqCountdown(c => {
        if (c <= 1) { clearInterval(reqTimerRef.current!); reqTimerRef.current = null; onReset(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => { if (reqTimerRef.current) clearInterval(reqTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subScreen]);

  // ── Payment: poll MTN status while referenceId is set ──────────
  useEffect(() => {
    if (!referenceId) return;
    setPaymentCountdown(60);

    const countInterval = setInterval(() => {
      setPaymentCountdown(c => Math.max(0, c - 1));
    }, 1000);

    const pollInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/payments/${referenceId}/status`);
        if (data.status === 'successful') {
          if (data.user?.name) setMemberName(data.user.name);
          setSubScreen('paymentSuccess');
          setPaymentLoading(false);
        } else if (data.status === 'failed') {
          setSubScreen('paymentFailed');
          setPaymentError(data.message ?? 'Payment was declined.');
          setPaymentLoading(false);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);

    const timeoutId = setTimeout(() => {
      setSubScreen('paymentTimeout');
      setPaymentLoading(false);
    }, 60000);

    return () => {
      clearInterval(countInterval);
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceId]);

  // ── Payment success auto-reset ───────────────────────────────
  useEffect(() => {
    if (subScreen !== 'paymentSuccess') return;
    setPaySuccessCountdown(60);
    const t = setInterval(() => {
      setPaySuccessCountdown(c => {
        if (c <= 1) { clearInterval(t); onReset(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subScreen]);

  // ── Walk-in: poll MTN while walkinReferenceId is set ────────
  useEffect(() => {
    if (!walkinReferenceId) return;
    setWalkinPaymentCountdown(60);

    const countInterval = setInterval(() => {
      setWalkinPaymentCountdown(c => Math.max(0, c - 1));
    }, 1000);

    const pollInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/payments/walkin/${walkinReferenceId}/status`);
        if (data.status === 'successful') {
          clearInterval(pollInterval);
          clearInterval(countInterval);
          const serviceNames = (data.services ?? []).map((svc: { name?: string } | string) => typeof svc === 'string' ? svc : (svc?.name ?? ''));
          setWalkinSuccessServices(serviceNames);
          setSubScreen('walkInSuccess');
          setWalkinPaymentLoading(false);
          toast.success('Walk-in payment confirmed!', `${serviceNames.join(', ')} · ${Number(data.total || data.totalAmount || 0).toLocaleString()} RWF`);
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          clearInterval(countInterval);
          setSubScreen('walkInFailed');
          setWalkinPaymentError(data.message ?? 'Payment was declined.');
          setWalkinPaymentLoading(false);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);

    const timeoutId = setTimeout(() => {
      setSubScreen('walkInTimeout');
      setWalkinPaymentLoading(false);
    }, 60000);

    return () => {
      clearInterval(countInterval);
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkinReferenceId]);

  // ── Walk-in success auto-reset ───────────────────────────────
  useEffect(() => {
    if (subScreen !== 'walkInSuccess') return;
    setWalkinSuccessCountdown(60);
    const t = setInterval(() => {
      setWalkinSuccessCountdown(c => {
        if (c <= 1) { clearInterval(t); onReset(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subScreen]);

  async function initiateWalkinPayment() {
    if (!walkinMomoPhoneValid || walkinSelected.length === 0) return;
    setWalkinPaymentLoading(true); setWalkinPaymentError('');
    try {
      const { data } = await api.post('/payments/walkin/initiate', {
        payerPhone: walkinMomoPhone.trim(),
        serviceIds: walkinSelected,
        userPhone:  phone.trim() || undefined,
      });
      setWalkinReferenceId(data.referenceId);
      setWalkinTotal(Number(data.totalAmount) || 0);
      // walkinPaymentLoading stays true — polling clears it on result
    } catch (err: any) {
      setWalkinPaymentError(err.response?.data?.error ?? 'Failed to send payment request. Please try again.');
      setWalkinPaymentLoading(false);
    }
  }

  async function initiatePayment() {
    if (!requestId || !momoPhone.trim() || !momoPhoneValid) return;
    setPaymentLoading(true); setPaymentError('');
    try {
      const { data } = await api.post('/payments/initiate', {
        membershipRequestId: requestId,
        payerPhone: momoPhone.trim(),
      });
      setReferenceId(data.referenceId);
      // paymentLoading stays true — polling will clear it on result
    } catch (err: any) {
      setPaymentError(err.response?.data?.error ?? 'Failed to send payment request. Please try again.');
      setPaymentLoading(false);
    }
  }

  async function checkPaymentStatus() {
    if (!referenceId) return;
    setPaymentLoading(true); setPaymentError('');
    try {
      const { data } = await api.get(`/payments/${referenceId}/status`);
      if (data.status === 'successful') {
        if (data.user?.name) setMemberName(data.user.name);
        setSubScreen('paymentSuccess');
      } else if (data.status === 'failed') {
        setSubScreen('paymentFailed');
        setPaymentError(data.message ?? 'Payment was declined.');
      } else {
        setPaymentError('Payment is still pending. Please wait a moment.');
      }
    } catch {
      setPaymentError('Failed to check status. Please try again.');
    } finally {
      setPaymentLoading(false);
    }
  }

  async function openBuyMembership() {
    pauseCountdown();
    setSubScreen('plans');
    setPlansLoading(true);
    try {
      const { data } = await api.get<MembershipPlan[]>('/checkin/plans');
      setPlans(data);
    } catch { setPlans([]); }
    finally { setPlansLoading(false); }
  }

  function openWalkIn() {
    pauseCountdown();
    setWalkinSelected([]);
    setWalkinReferenceId(null);
    setWalkinPaymentError('');
    setSubScreen('walkIn');
  }

  function toggleWalkinService(id: number) {
    setWalkinSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function openNameSearch() {
    pauseCountdown();
    setSubScreen('nameSearch');
  }

  function backToDefault() {
    setSubScreen('default');
    setSelectedPlan(null);
    setSearchQuery('');
    startCountdown();
  }

  function selectPlan(plan: MembershipPlan) {
    setSelectedPlan(plan);
    setSubScreen('planConfirm');
  }

  async function submitRegistration() {
    if (!regName.trim() || regName.trim().length < 2 || !regPhone.trim() || !regPlanId) return;
    setRegLoading(true); setRegError('');
    try {
      const { data } = await api.post('/membership-requests', {
        newMemberName:  regName.trim(),
        newMemberPhone: regPhone.trim(),
        planId:         Number(regPlanId),
      });
      const chosenPlan = plans.find(p => p.id === Number(regPlanId));
      setRequestId(data.requestId);
      setPlanAmount(chosenPlan?.price ?? 0);
      setPlanName(chosenPlan?.name ?? '');
      setMomoPhone(regPhone.trim());
      setMomoPhoneValid(isPhoneValid(regPhone.trim()));
      setSubScreen('payment');
    } catch (err: any) {
      setRegError(err.response?.data?.error ?? 'Failed to submit. Please try again.');
    } finally {
      setRegLoading(false);
    }
  }

  async function submitPlanRequest() {
    if (!selectedPlan) return;
    setConfirmLoading(true); setConfirmError('');
    try {
      const { data } = await api.post('/membership-requests', {
        userId: result.user?.id,
        planId: selectedPlan.id,
      });
      setRequestId(data.requestId);
      setPlanAmount(selectedPlan.price);
      setPlanName(selectedPlan.name);
      // momoPhone stays as the check-in phone
      setSubScreen('payment');
    } catch (err: any) {
      setConfirmError(err.response?.data?.error ?? 'Failed to submit. Please try again.');
    } finally {
      setConfirmLoading(false);
    }
  }

  const expiredDateStr = result.reason === 'membership_expired' && result.expiredOn
    ? new Date(result.expiredOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const serviceLabel = result.service_name ? `${result.service_name} ` : '';
  const config: Record<string, { bgClass: string; icon: string; title: string; sub: string }> = {
    no_membership:         { bgClass: s.bgRed,    icon: '🚫', title: 'No Membership Found',  sub: "You don't have an active membership." },
    membership_expired:    { bgClass: s.bgOrange, icon: '⏰', title: 'Membership Expired',   sub: result.planName && expiredDateStr ? `Your ${result.planName} membership expired on ${expiredDateStr}.` : 'The membership period has ended.' },
    no_sessions:           { bgClass: s.bgOrange, icon: '0️⃣', title: 'No Sessions Left',     sub: 'You have used all your sessions.' },
    user_suspended:        { bgClass: s.bgPurple, icon: '🔒', title: 'Account Suspended',    sub: 'Your account has been suspended. Please contact the gym reception for assistance.' },
    pending_approval:      { bgClass: s.bgAmber,  icon: '⏳', title: 'Almost there!',         sub: result.pendingPlan ? `Your ${result.pendingPlan} membership request is waiting for manager approval. You'll receive an SMS once your account is activated.` : "Your membership request is waiting for manager approval. You'll receive an SMS once your account is activated." },
    user_not_found:        { bgClass: s.bgSlate,  icon: '❓', title: 'Not Found',            sub: 'No account linked to this phone number.' },
    already_checked_in:    { bgClass: s.bgSlate,  icon: '✋', title: 'Already Checked In',  sub: 'This member checked in less than 30 minutes ago.' },
    service_not_covered:   { bgClass: s.bgRed,    icon: '🚫', title: `${serviceLabel}Not Covered`,  sub: 'Your company does not cover this service.' },
    service_not_in_plan:   { bgClass: s.bgAmber,  icon: '🔒', title: `${serviceLabel}Not in Plan`, sub: result.planName ? `Upgrade from ${result.planName} to access this service.` : 'Upgrade your plan to access this service.' },
  };
  const c = config[result.reason] ?? config['user_not_found'];

  const isMembershipIssue =
    result.reason === 'no_membership' ||
    result.reason === 'membership_expired' ||
    result.reason === 'no_sessions';

  return (
    <>
      {/* Result card — hidden for user_not_found (register form shown instead) */}
      {result.reason !== 'user_not_found' && (
        <div className={`${s.resultBox} ${c.bgClass}`}>
          <GymMindLogo size={40} variant="white" />
          <div className={s.resultIcon}>{c.icon}</div>
          {result.user && <div className={s.resultName}>{result.user.name}</div>}
          <div className={s.resultTitle}>{c.title}</div>
          <div className={s.resultSub}>{c.sub}</div>
        </div>
      )}

      {/* ── DEFAULT sub-screen ── */}
      {subScreen === 'default' && (
        <>
          {/* Fix 4: countdown */}
          <div className={s.countdownBar}>
            Returning in {countdown}…
          </div>

          {/* Membership actions */}
          {isMembershipIssue && (
            <>
              <p className={s.hint}>
                {result.reason === 'membership_expired' && 'Renew your membership to continue.'}
                {result.reason === 'no_sessions'        && 'Buy more sessions to continue.'}
                {result.reason === 'no_membership'      && 'Get a membership to start training.'}
              </p>
              <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`} onClick={openBuyMembership}>
                {result.reason === 'no_membership' ? 'Buy a Membership' : result.reason === 'no_sessions' ? 'Buy Sessions' : 'Renew Now'}
              </button>
              {result.reason === 'no_membership' && (
                <>
                  <button type="button" className={`${s.actionBtn} ${s.actionBtnWalkin}`} onClick={openWalkIn}>
                    <span className={s.actionBtnWalkinMain}>Pay for today →</span>
                    <span className={s.actionBtnWalkinSub}>Walk-in — pay per service</span>
                  </button>
                  <button type="button" className={s.receptionBtn}
                    onClick={() => { pauseCountdown(); setSubScreen('walkInReception'); }}>
                    Pay at reception
                  </button>
                </>
              )}
            </>
          )}

          {result.reason === 'user_suspended' && (
            <p className={s.receptionNote}>Please direct this member to reception</p>
          )}

          {/* user_not_found: claim + search */}
          {result.reason === 'user_not_found' && (
            <>
              <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`}
                onClick={() => navigate(`/${gymSlug}/claim?phone=${encodeURIComponent(phone)}`)}>
                Claim your account
              </button>
              <button type="button" className={`${s.actionBtn} ${s.actionBtnCyan}`} onClick={openNameSearch}>
                Search by name
              </button>
            </>
          )}

          {result.reason === 'pending_approval' ? (
            <button type="button" className={s.pendingBtn} onClick={onReset}>
              Check in another →
            </button>
          ) : (
            <button type="button" className={s.backBtn} onClick={onReset}>
              ← New check-in
            </button>
          )}
        </>
      )}

      {/* ── PLANS sub-screen (Fix 1) ── */}
      {subScreen === 'plans' && (
        <div className={s.plansPanel}>
          <div className={s.panelTitle}>Choose a plan</div>
          {plansLoading && <p className={s.hint}>Loading plans…</p>}
          {!plansLoading && plans.length === 0 && (
            <p className={s.hint}>No plans available. Please see reception.</p>
          )}
          {plans.map(plan => (
            <button key={plan.id} type="button" className={s.planCard} onClick={() => selectPlan(plan)}>
              <span className={s.planName}>{plan.name}</span>
              <span className={s.planMeta}>{formatDuration(plan)}</span>
              <span className={s.planPrice}>{formatPrice(plan.price)}</span>
            </button>
          ))}
          <button type="button" className={s.backBtn} onClick={backToDefault}>← Back</button>
        </div>
      )}

      {/* ── PLAN CONFIRM sub-screen (Fix 1) ── */}
      {subScreen === 'planConfirm' && selectedPlan && (
        <div className={s.planConfirm}>
          <div className={s.confirmIcon}>🎫</div>
          <div className={s.confirmTitle}>Plan Selected</div>
          <div className={s.confirmDetails}>
            <div className={s.confirmPlanName}>{selectedPlan.name}</div>
            <div className={s.confirmPlanDuration}>{formatDuration(selectedPlan)}</div>
            <div className={s.confirmPlanPrice}>{formatPrice(selectedPlan.price)}</div>
          </div>
          <div className={s.confirmMsg}>
            Please review your plan selection.<br />
            A manager will approve your membership request.
          </div>
          {confirmError && <div className={s.error}>{confirmError}</div>}
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`} onClick={submitPlanRequest} disabled={confirmLoading}>
            {confirmLoading ? 'Submitting…' : 'Submit Request →'}
          </button>
          <button type="button" className={s.backBtn} onClick={() => setSubScreen('plans')}>← Change plan</button>
        </div>
      )}

      {/* ── WALK-IN W1: service multi-select ── */}
      {subScreen === 'walkIn' && (() => {
        const walkinCapable = (walkinServices ?? []).filter(s => Number(s.walkin_price) > 0);
        const total = walkinCapable
          .filter(s => walkinSelected.includes(s.id))
          .reduce((sum, s) => sum + Number(s.walkin_price), 0);
        if (walkinCapable.length === 0) {
          return (
            <div className={s.walkInPanel}>
              <div className={s.walkInTitle}>Day Pass</div>
              <div className={s.walkInMsg}>
                Walk-in payments are not configured yet.<br />
                Please see reception to pay for a session.
              </div>
              <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`} onClick={onReset}>Done</button>
              <button type="button" className={s.backBtn}
                onClick={() => result.reason === 'user_not_found' ? setSubScreen('chooseType') : backToDefault()}>
                ← Back
              </button>
            </div>
          );
        }
        return (
          <>
            <label className={s.label}>Select services</label>
            <div className={s.walkinServiceGrid}>
              {walkinCapable.map(svc => {
                const checked = walkinSelected.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    className={`${s.walkinServiceCard} ${checked ? s.walkinServiceCardSelected : ''}`}
                    onClick={() => toggleWalkinService(svc.id)}
                  >
                    <div className={s.walkinServiceCheck}>{checked ? '✓' : ''}</div>
                    <div className={s.walkinServiceName}>{svc.name}</div>
                    <div className={s.walkinServicePrice}>
                      {svc.walkin_price.toLocaleString()} {svc.currency}
                    </div>
                  </button>
                );
              })}
            </div>
            {walkinSelected.length > 0 && (
              <div className={s.walkinTotal}>Total: {total.toLocaleString()} RWF</div>
            )}
            <button
              type="button"
              className={`${s.actionBtn} ${s.actionBtnBlue} ${walkinSelected.length === 0 ? s.btnDisabled : ''}`}
              onClick={() => {
                setWalkinTotal(total);
                setSubScreen('walkInPayment');
              }}
              disabled={walkinSelected.length === 0}
            >
              {walkinSelected.length === 0 ? 'Select a service' : `Pay ${total.toLocaleString()} RWF →`}
            </button>
            <button type="button" className={s.backBtn}
              onClick={() => result.reason === 'user_not_found' ? setSubScreen('chooseType') : backToDefault()}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── WALK-IN: pay at reception ── */}
      {subScreen === 'walkInReception' && (
        <div className={s.walkInPanel}>
          <div className={s.walkInTitle}>Pay at Reception</div>
          <div className={s.walkInMsg}>
            Please pay the day pass fee at the reception desk.<br />
            Reception will check you in manually.
          </div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`} onClick={onReset}>Done</button>
          <button type="button" className={s.backBtn}
            onClick={() => result.reason === 'user_not_found' ? setSubScreen('chooseType') : backToDefault()}>
            ← Back
          </button>
        </div>
      )}

      {/* ── WALK-IN W2: MoMo payment ── */}
      {subScreen === 'walkInPayment' && (
        <div className={s.paymentPanel}>
          <div className={s.confirmIcon}>💳</div>
          <div className={s.confirmTitle}>Pay with MTN MoMo</div>
          <div className={s.confirmMsg}>
            Pay <strong>{walkinTotal.toLocaleString()} RWF</strong> via MTN Mobile Money
          </div>
          <label className={s.label}>Your MTN MoMo number</label>
          <PhoneInput
            value={walkinMomoPhone}
            onChange={(v, valid) => { setWalkinMomoPhone(v); setWalkinMomoPhoneValid(valid); }}
            inputClassName={s.inlineSearchInput}
          />
          {walkinReferenceId && walkinPaymentLoading ? (
            <div className={s.paymentWaiting}>
              <p>Waiting for confirmation on your phone… ({walkinPaymentCountdown}s)</p>
              <p className={s.hint}>Approve the prompt on your MTN phone</p>
            </div>
          ) : (
            <button
              type="button"
              className={`${s.actionBtn} ${s.actionBtnBlue} ${(!walkinMomoPhoneValid || walkinPaymentLoading) ? s.btnDisabled : ''}`}
              onClick={initiateWalkinPayment}
              disabled={!walkinMomoPhoneValid || walkinPaymentLoading}
            >
              {walkinPaymentLoading ? 'Sending request…' : `Pay ${walkinTotal.toLocaleString()} RWF →`}
            </button>
          )}
          {walkinPaymentError && <div className={s.error}>{walkinPaymentError}</div>}
          <button type="button" className={s.backBtn} onClick={() => {
            setWalkinReferenceId(null);
            setWalkinPaymentLoading(false);
            setSubScreen('walkIn');
          }}>
            ← Change services
          </button>
        </div>
      )}

      {/* ── WALK-IN W3: success ── */}
      {subScreen === 'walkInSuccess' && (
        <>
          <div className={`${s.successBox} ${s.bgGreen}`}>
            <div className={s.successCheckCircle}>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                <polyline points="6,18 15,27 30,10" stroke="#0F6E56" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className={s.successName}>Access Granted</div>
            <div className={s.successDivider} />
            {walkinSuccessServices.length > 0 && (
              <div className={s.walkinSuccessPills}>
                {walkinSuccessServices.map(name => (
                  <span key={name} className={s.walkinSuccessPill}>{name}</span>
                ))}
              </div>
            )}
            <div className={s.successDateTime}>
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            <div className={s.successMeta}>Day Pass · {walkinTotal.toLocaleString()} RWF</div>
          </div>
          <div className={s.successCountdown}>Returning in {walkinSuccessCountdown}…</div>
          <button type="button" className={s.successBtn} onClick={onReset}>
            Check in another →
          </button>
        </>
      )}

      {/* ── WALK-IN W4: failed ── */}
      {subScreen === 'walkInFailed' && (
        <>
          <div className={`${s.resultBox} ${s.bgRed}`}>
            <div className={s.resultIcon}>❌</div>
            <div className={s.resultName}>Payment Failed</div>
            {walkinPaymentError && <div className={s.resultSub}>{walkinPaymentError}</div>}
          </div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`}
            onClick={() => { setWalkinPaymentError(''); setWalkinReferenceId(null); setSubScreen('walkInPayment'); }}>
            Try Again
          </button>
          <button type="button" className={s.backBtn} onClick={() => setSubScreen('walkIn')}>
            ← Change services
          </button>
        </>
      )}

      {/* ── WALK-IN W4b: timeout / pending ── */}
      {subScreen === 'walkInTimeout' && (
        <>
          <div className={`${s.resultBox} ${s.bgAmber}`}>
            <div className={s.resultIcon}>⏳</div>
            <div className={s.resultName}>Payment Pending</div>
            <div className={s.resultSub}>We haven't received confirmation yet.</div>
          </div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`}
            onClick={async () => {
              if (!walkinReferenceId) return;
              setWalkinPaymentLoading(true); setWalkinPaymentError('');
              try {
                const { data } = await api.get(`/payments/walkin/${walkinReferenceId}/status`);
                if (data.status === 'successful') {
                  setWalkinSuccessServices((data.services ?? []).map((svc: { name?: string } | string) => typeof svc === 'string' ? svc : (svc?.name ?? '')));
                  setSubScreen('walkInSuccess');
                } else if (data.status === 'failed') {
                  setSubScreen('walkInFailed');
                  setWalkinPaymentError(data.message ?? 'Payment was declined.');
                } else {
                  setWalkinPaymentError('Payment is still pending. Please wait a moment.');
                }
              } catch {
                setWalkinPaymentError('Failed to check status. Please try again.');
              } finally { setWalkinPaymentLoading(false); }
            }}
            disabled={walkinPaymentLoading}
          >
            {walkinPaymentLoading ? 'Checking…' : 'Check Status'}
          </button>
          <button type="button" className={s.backBtn} onClick={onReset}>← New check-in</button>
        </>
      )}

      {/* ── NAME SEARCH sub-screen (user_not_found) ── */}
      {subScreen === 'nameSearch' && (
        <div className={s.inlineSearch}>
          <input
            ref={searchRef}
            type="search"
            placeholder="Type your name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={s.inlineSearchInput}
          />
          {searchLoading && <p className={s.hint}>Searching…</p>}
          {searchResults.length > 0 && (
            <ul className={s.inlineResultList}>
              {searchResults.map(u => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={s.inlineResultItem}
                    onClick={() => navigate(`/${gymSlug}/claim?phone=${encodeURIComponent(phone)}&userId=${u.id}&name=${encodeURIComponent(u.name)}`)}
                  >
                    <span>{u.name}</span>
                    {u.institution_name && <span className={s.inlineResultInst}>{u.institution_name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchQuery.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
            <p className={s.hint}>No match — see reception to register.</p>
          )}
          <button type="button" className={s.backBtn} onClick={backToDefault}>← Cancel</button>
        </div>
      )}

      {/* ── CHOOSE TYPE sub-screen (user_not_found entry point) ── */}
      {subScreen === 'chooseType' && (
        <div className={s.chooseTypePanel}>
          <div className={s.panelTitle}>Welcome! How are you joining?</div>
          <button
            type="button"
            className={s.chooseTypeCard}
            onClick={() => navigate(`/${gymSlug}/claim?phone=${encodeURIComponent(phone)}&type=institutional`)}
          >
            <span className={s.chooseTypeIcon}>🏢</span>
            <span className={s.chooseTypeLabel}>I work for a company</span>
            <span className={s.chooseTypeSub}>Find your pre-registered account</span>
          </button>
          <button
            type="button"
            className={s.chooseTypeCard}
            onClick={() => navigate(`/${gymSlug}/claim?phone=${encodeURIComponent(phone)}&type=individual`)}
          >
            <span className={s.chooseTypeIcon}>👤</span>
            <span className={s.chooseTypeLabel}>I'm joining personally</span>
            <span className={s.chooseTypeSub}>Register as a new member</span>
          </button>
          <button
            type="button"
            className={`${s.chooseTypeCard} ${s.chooseTypeCardTeal}`}
            onClick={openWalkIn}
          >
            <span className={s.chooseTypeIcon}>💳</span>
            <span className={s.chooseTypeLabel}>Walk-in — Pay &amp; Enter →</span>
            <span className={s.chooseTypeSubTeal}>No account needed · Pay per service</span>
          </button>
          <button type="button" className={s.backBtn} onClick={onReset}>← Cancel</button>
        </div>
      )}

      {/* ── REGISTER sub-screen (Screen A — new member walk-in) ── */}
      {subScreen === 'register' && (
        <div className={s.inlineSearch}>
          <div className={s.panelTitle}>Welcome to {gymSlug || 'the gym'}!</div>
          <p className={s.hint}>Create your account to get started</p>
          <input
            type="text"
            placeholder="Full name"
            value={regName}
            onChange={e => setRegName(e.target.value)}
            className={s.inlineSearchInput}
          />
          <PhoneInput
            value={regPhone}
            onChange={(v, valid) => { setRegPhone(v); setRegPhoneValid(valid); }}
            inputClassName={s.inlineSearchInput}
          />
          {plansLoading && <p className={s.hint}>Loading plans…</p>}
          {!plansLoading && (
            <select
              value={regPlanId}
              onChange={e => setRegPlanId(e.target.value === '' ? '' : Number(e.target.value))}
              className={s.inlineSearchInput}
            >
              <option value="">-- Select a membership plan --</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} – {formatDuration(p)} – {formatPrice(p.price)}
                </option>
              ))}
            </select>
          )}
          {regError && <div className={s.error}>{regError}</div>}
          <button
            type="button"
            className={`${s.actionBtn} ${s.actionBtnBlue}`}
            onClick={submitRegistration}
            disabled={!regName.trim() || regName.trim().length < 2 || !regPhoneValid || !regPlanId || regLoading}
          >
            {regLoading ? 'Submitting…' : 'Submit Request →'}
          </button>
          <button type="button" className={s.backBtn} onClick={onReset}>← Cancel</button>
        </div>
      )}

      {/* ── REQUEST SUBMITTED sub-screen (Screen C) ── */}
      {subScreen === 'requestSubmitted' && (() => {
        const isNew     = regName.trim().length > 0;
        const newPlan   = isNew ? plans.find(p => p.id === Number(regPlanId)) : null;
        return (
        <div className={s.planConfirm}>
          <div className={s.confirmIcon}>🎉</div>
          <div className={s.confirmTitle}>Request Submitted!</div>
          <div className={s.confirmMsg}>
            {isNew ? (
              <>
                Welcome {regName.trim()}! Your membership request has been sent.<br />
                Please pay at the reception desk to complete your registration.<br />
                Once payment is confirmed, the manager will approve your membership and you will receive an SMS confirmation.
                {newPlan && <><br /><br /><strong>{newPlan.name}</strong> — {newPlan.price.toLocaleString()} RWF</>}
              </>
            ) : (
              <>
                Your <strong>{selectedPlan?.name}</strong> membership request has been sent.<br />
                Please pay {selectedPlan?.price.toLocaleString()} RWF at the reception desk.<br />
                Once payment is confirmed, the manager will approve your membership and you will receive an SMS confirmation.
              </>
            )}
          </div>
          <div className={s.paymentNote}>
            💳 Payment required at reception before approval
          </div>
          <div className={s.countdownBar}>Returning to home in {reqCountdown}…</div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`} onClick={onReset}>
            Done
          </button>
        </div>
        );
      })()}

      {/* ── SCREEN D — Payment form ── */}
      {subScreen === 'payment' && (
        <div className={s.paymentPanel}>
          <div className={s.confirmIcon}>💳</div>
          <div className={s.confirmTitle}>Pay with MTN MoMo</div>
          <div className={s.confirmMsg}>
            Pay <strong>{planAmount.toLocaleString()} RWF</strong> via MTN Mobile Money
          </div>
          <label className={s.label}>Your MTN MoMo number</label>
          <PhoneInput
            value={momoPhone}
            onChange={(v, valid) => { setMomoPhone(v); setMomoPhoneValid(valid); }}
            inputClassName={s.inlineSearchInput}
          />
          {referenceId && paymentLoading ? (
            <div className={s.paymentWaiting}>
              <p>Waiting for confirmation on your phone… ({paymentCountdown}s)</p>
              <p className={s.hint}>Approve the prompt on your MTN phone</p>
            </div>
          ) : (
            <button
              type="button"
              className={`${s.actionBtn} ${s.actionBtnBlue} ${(!momoPhoneValid || paymentLoading) ? s.btnDisabled : ''}`}
              onClick={initiatePayment}
              disabled={!momoPhoneValid || paymentLoading}
            >
              {paymentLoading ? 'Sending request…' : `Pay ${planAmount.toLocaleString()} RWF →`}
            </button>
          )}
          {paymentError && <div className={s.error}>{paymentError}</div>}
          <button type="button" className={s.backBtn}
            onClick={() => setSubScreen('requestSubmitted')}>
            ← Pay at reception instead
          </button>
        </div>
      )}

      {/* ── SCREEN E — Payment + auto check-in success ── */}
      {subScreen === 'paymentSuccess' && (
        <>
          <div className={`${s.resultBox} ${s.bgGreen}`}>
            <GymMindLogo size={40} variant="white" />
            <div className={s.resultIcon}>✅</div>
            <div className={s.resultName}>Payment Confirmed!</div>
            <div className={s.resultSub}>Membership activated — {planName}</div>
            <hr className={s.resultDivider} />
            <div className={s.resultCheckin}>You are now checked in!</div>
            <div className={s.resultBadge}>Welcome to {gymSlug}, {memberName || 'Member'}!</div>
          </div>
          <div className={s.countdownBar}>Returning in {paySuccessCountdown}…</div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnGhost}`} onClick={onReset}>
            Done
          </button>
        </>
      )}

      {/* ── SCREEN F — Payment failed ── */}
      {subScreen === 'paymentFailed' && (
        <>
          <div className={`${s.resultBox} ${s.bgRed}`}>
            <div className={s.resultIcon}>❌</div>
            <div className={s.resultName}>Payment Failed</div>
            {paymentError && <div className={s.resultSub}>{paymentError}</div>}
          </div>
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`}
            onClick={() => { setPaymentError(''); setReferenceId(null); setSubScreen('payment'); }}>
            Try Again
          </button>
          <button type="button" className={s.backBtn}
            onClick={() => setSubScreen('requestSubmitted')}>
            Pay at Reception
          </button>
        </>
      )}

      {/* ── SCREEN G — Payment timeout / pending ── */}
      {subScreen === 'paymentTimeout' && (
        <>
          <div className={`${s.resultBox} ${s.bgAmber}`}>
            <div className={s.resultIcon}>⏳</div>
            <div className={s.resultName}>Payment Pending</div>
            <div className={s.resultSub}>We haven't received confirmation yet.</div>
            <div className={s.resultBadge}>Your membership will activate automatically once confirmed.</div>
          </div>
          {paymentError && <div className={s.error}>{paymentError}</div>}
          <button type="button" className={`${s.actionBtn} ${s.actionBtnBlue}`}
            onClick={checkPaymentStatus}
            disabled={paymentLoading}>
            {paymentLoading ? 'Checking…' : 'Check Status'}
          </button>
          <button type="button" className={s.backBtn}
            onClick={() => setSubScreen('requestSubmitted')}>
            Pay at Reception
          </button>
        </>
      )}
    </>
  );
}
