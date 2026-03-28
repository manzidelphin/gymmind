import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import api from '../../api/api';
import { useGym } from '../../hooks/useGym';
import PhoneInput from '../../components/PhoneInput';
import s from './SettingsTab.module.css';

interface GymData {
  id: number;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  subscription_plan: string;
  momo_number: string | null;
  momo_api_user_id: string | null;
}

export default function SettingsTab() {
  const { gymSlug } = useGym();
  const [loading, setLoading] = useState(true);

  // QR code
  const [copied, setCopied] = useState(false);
  const checkinUrl = window.location.hostname === 'localhost'
    ? `http://localhost:5173/${gymSlug}/checkin`
    : `https://gymmind.rw/${gymSlug}/checkin`;

  // Callback ref: draws as soon as the canvas element mounts,
  // bypassing the early-return loading guard that breaks useEffect.
  function setCanvasRef(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    QRCode.toCanvas(canvas, checkinUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#0F6E56', light: '#FFFFFF' },
    }).catch(console.error);
  }

  async function handleDownload() {
    try {
      const dataUrl = await QRCode.toDataURL(checkinUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#0F6E56', light: '#FFFFFF' },
      });
      const link = document.createElement('a');
      link.download = `${gymSlug}-checkin-qr.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('QR download failed:', e);
    }
  }

  // Profile
  const [gymName,  setGymName]  = useState('');
  const [gymPhone, setGymPhone] = useState('');
  const [address,  setAddress]  = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // MoMo
  const [momoNumber,    setMomoNumber]    = useState('');
  const [momoApiUserId, setMomoApiUserId] = useState('');
  const [momoApiKey,    setMomoApiKey]    = useState('');
  const [momoSubKey,    setMomoSubKey]    = useState('');
  const [showApiKey,    setShowApiKey]    = useState(false);
  const [showSubKey,    setShowSubKey]    = useState(false);
  const [momoSaving,    setMomoSaving]    = useState(false);

  // Toast
  const [toast,   setToast]   = useState('');
  const [toastOk, setToastOk] = useState(true);

  function showToast(msg: string, ok: boolean) {
    setToast(msg); setToastOk(ok);
    setTimeout(() => setToast(''), 3500);
  }

  useEffect(() => {
    api.get<GymData>('/gyms/me')
      .then(({ data }) => {
        setGymName(data.name ?? '');
        setGymPhone(data.phone ?? '');
        setAddress(data.address ?? '');
        setMomoNumber(data.momo_number ?? '');
        setMomoApiUserId(data.momo_api_user_id ?? '');
      })
      .catch(() => showToast('Failed to load gym settings.', false))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    try {
      await api.patch('/gyms/me', {
        name:    gymName    || undefined,
        phone:   gymPhone   || undefined,
        address: address    || undefined,
      });
      showToast('Gym profile saved!', true);
    } catch (e: any) {
      showToast(e.response?.data?.error ?? 'Failed to save profile.', false);
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveMomo() {
    setMomoSaving(true);
    try {
      const body: Record<string, string> = {};
      if (momoNumber)    body.momoNumber          = momoNumber;
      if (momoApiUserId) body.momoApiUserId        = momoApiUserId;
      if (momoApiKey)    body.momoApiKey           = momoApiKey;
      if (momoSubKey)    body.momoSubscriptionKey  = momoSubKey;
      await api.patch('/gyms/me/momo', body);
      showToast('MoMo settings saved!', true);
      setMomoApiKey('');
      setMomoSubKey('');
    } catch (e: any) {
      showToast(e.response?.data?.error ?? 'Failed to save MoMo settings.', false);
    } finally {
      setMomoSaving(false);
    }
  }

  if (loading) return <p className={s.loading}>Loading settings…</p>;

  return (
    <div className={s.container}>
      {toast && <div className={`${s.toast} ${toastOk ? s.toastOk : s.toastErr}`}>{toast}</div>}

      {/* ── Section 0: QR Code ── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>Member Check-in QR Code</h2>
        <p className={s.helperTextTop}>
          Print this and place it at your gym entrance. Members scan it to check in.
        </p>
        <canvas ref={setCanvasRef} className={s.qrCanvas} />
        <div className={s.qrUrl}>{checkinUrl}</div>
        <div className={s.qrBtnRow}>
          <button
            type="button"
            className={s.qrBtnDownload}
            onClick={handleDownload}
          >
            Download QR Code
          </button>
          <button
            type="button"
            className={s.qrBtnCopy}
            onClick={() => {
              navigator.clipboard.writeText(checkinUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className={s.qrTip}>
          Tip: Print at A5 or A4 size for best results. Place near your gym entrance or reception desk.
        </div>
      </div>

      {/* ── Section 1: Gym Profile ── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>Gym Profile</h2>

        <div className={s.profileGrid}>
          <div className={s.formGroup}>
            <label className={s.label}>Gym name</label>
            <input
              type="text"
              className={s.input}
              value={gymName}
              onChange={e => setGymName(e.target.value)}
            />
          </div>

          <div className={s.formGroup}>
            <label className={s.label}>Phone number</label>
            <PhoneInput
              value={gymPhone}
              onChange={(v) => setGymPhone(v)}
              inputClassName={s.input}
            />
          </div>

          <div className={`${s.formGroup} ${s.fullWidth}`}>
            <label className={s.label}>Address</label>
            <textarea
              className={s.textarea}
              value={address}
              onChange={e => setAddress(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <button
          type="button"
          className={s.saveBtn}
          onClick={saveProfile}
          disabled={profileSaving || !gymName.trim()}
        >
          {profileSaving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>

      {/* ── Section 2: MTN MoMo ── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>MTN Mobile Money Settings</h2>

        <div className={s.formGroup}>
          <label className={s.label}>MoMo number</label>
          <PhoneInput
            value={momoNumber}
            onChange={(v) => setMomoNumber(v)}
            inputClassName={s.input}
          />
          <p className={s.helperText}>Members will pay to this number</p>
        </div>

        <div className={s.formGroup}>
          <label className={s.label}>API User ID</label>
          <input
            type="text"
            className={s.input}
            value={momoApiUserId}
            onChange={e => setMomoApiUserId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <p className={s.helperText}>From MTN Developer Portal</p>
        </div>

        <div className={s.formGroup}>
          <label className={s.label}>API Key</label>
          <div className={s.passwordWrap}>
            <input
              type={showApiKey ? 'text' : 'password'}
              className={`${s.input} ${s.passwordInput}`}
              value={momoApiKey}
              onChange={e => setMomoApiKey(e.target.value)}
              placeholder="Leave blank to keep existing"
            />
            <button type="button" className={s.showHideBtn} onClick={() => setShowApiKey(v => !v)}>
              {showApiKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        <div className={s.formGroup}>
          <label className={s.label}>Subscription Key</label>
          <div className={s.passwordWrap}>
            <input
              type={showSubKey ? 'text' : 'password'}
              className={`${s.input} ${s.passwordInput}`}
              value={momoSubKey}
              onChange={e => setMomoSubKey(e.target.value)}
              placeholder="Leave blank to keep existing"
            />
            <button type="button" className={s.showHideBtn} onClick={() => setShowSubKey(v => !v)}>
              {showSubKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        <button
          type="button"
          className={s.saveBtn}
          onClick={saveMomo}
          disabled={momoSaving}
        >
          {momoSaving ? 'Saving…' : 'Save MoMo Settings'}
        </button>

        <div className={s.infoBox}>
          Get your API credentials from <strong>momodeveloper.mtn.com</strong> → Products → Collection
        </div>
      </div>

      {/* ── Section 3: Danger Zone ── */}
      <div className={`${s.section} ${s.dangerSection}`}>
        <h2 className={`${s.sectionTitle} ${s.dangerTitle}`}>Danger Zone</h2>
        <p className={s.helperText}>
          Changing your gym URL will break existing bookmarks and QR codes.
        </p>
        <button
          type="button"
          className={s.dangerBtn}
          disabled
          title="Contact GymMind support to change your gym URL"
        >
          Change Gym Slug
        </button>
        <p className={s.helperText}>Contact GymMind support to change your gym URL.</p>
      </div>
    </div>
  );
}
