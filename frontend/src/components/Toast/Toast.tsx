import { useEffect, useRef, useState } from 'react';
import type { Toast as ToastType } from '../../types/toast';
import { useToast } from '../../context/ToastContext';
import s from './Toast.module.css';

const DURATIONS: Record<ToastType['type'], number> = {
  success: 4000,
  info:    4000,
  warning: 6000,
  error:   8000,
};

const ICONS: Record<ToastType['type'], string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'i',
};

const ICON_CLASS: Record<ToastType['type'], string> = {
  success: s.iconSuccess,
  error:   s.iconError,
  warning: s.iconWarning,
  info:    s.iconInfo,
};

const PROGRESS_CLASS: Record<ToastType['type'], string> = {
  success: s.progressSuccess,
  error:   s.progressError,
  warning: s.progressWarning,
  info:    s.progressInfo,
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismiss } = useToast();
  const [exiting, setExiting] = useState(false);
  const duration = toast.duration ?? DURATIONS[toast.type];
  const progressRef = useRef<HTMLDivElement>(null);

  function close() {
    setExiting(true);
    setTimeout(() => dismiss(toast.id), 280);
  }

  useEffect(() => {
    const timer = setTimeout(close, duration);
    if (progressRef.current) {
      progressRef.current.style.animation = `shrink ${duration}ms linear forwards`;
    }
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={[
        s.toast,
        s[toast.type],
        exiting ? s.toastExiting : '',
      ].join(' ')}
    >
      <div className={`${s.icon} ${ICON_CLASS[toast.type]}`}>
        {ICONS[toast.type]}
      </div>
      <div className={s.content}>
        <p className={s.title}>{toast.title}</p>
        {toast.message && <p className={s.message}>{toast.message}</p>}
      </div>
      <button type="button" className={s.close} onClick={close} aria-label="Dismiss">×</button>
      <div
        ref={progressRef}
        className={`${s.progress} ${PROGRESS_CLASS[toast.type]}`}
      />
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className={s.container}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
