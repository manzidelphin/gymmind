import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import api from '../api/api';

interface ActivityEvent {
  type: 'checkin' | 'walkin' | 'membership_request';
  id: number;
  timestamp: string;
  member_name: string;
  member_phone: string;
  service_name: string | null;
  checkin_type: string;
  amount: number | null;
}

export function useActivityPoller(enabled: boolean) {
  const toast = useToast();
  const lastChecked   = useRef(new Date().toISOString());
  const isFirstRun    = useRef(true);
  const shownEventIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      try {
        const since = lastChecked.current;

        // Skip first run — just record baseline timestamp, show nothing
        if (isFirstRun.current) {
          isFirstRun.current = false;
          lastChecked.current = new Date().toISOString();
          return;
        }

        const res = await api.get<{ events: ActivityEvent[] }>(
          `/reports/recent-activity?since=${encodeURIComponent(since)}`,
        );

        // Update timestamp only after a successful call
        lastChecked.current = new Date().toISOString();

        const events = res.data.events ?? [];
        console.log('[Poller] Events received:', events.length);
        console.log('[Poller] Already shown:', shownEventIds.current.size);

        const walkins  = events.filter(e => e.type === 'walkin');
        const checkins = events.filter(e => e.type === 'checkin' && e.checkin_type !== 'walkin');
        const requests = events.filter(e => e.type === 'membership_request');

        // Walk-in payments (max 2 toasts per poll)
        walkins.slice(0, 2).forEach(event => {
          const key = `walkin-${event.id}`;
          if (shownEventIds.current.has(key)) return;
          shownEventIds.current.add(key);
          toast.success(
            'Walk-in payment received',
            `${Number(event.amount).toLocaleString()} RWF · just now`,
          );
        });

        // Regular check-ins (max 2 toasts per poll)
        checkins.slice(0, 2).forEach(event => {
          const key = `checkin-${event.id}`;
          if (shownEventIds.current.has(key)) return;
          shownEventIds.current.add(key);
          toast.success(
            `${event.member_name} checked in`,
            `${event.service_name ?? 'Gym'} · just now`,
          );
        });

        // Membership requests (max 1 toast per poll)
        requests.slice(0, 1).forEach(event => {
          const key = `request-${event.id}`;
          if (shownEventIds.current.has(key)) return;
          shownEventIds.current.add(key);
          toast.info(
            'New membership request',
            `${event.member_name} — ${event.service_name ?? 'plan'}`,
          );
        });

        // Trim seen-ID set to prevent unbounded growth
        if (shownEventIds.current.size > 100) {
          const arr = Array.from(shownEventIds.current);
          shownEventIds.current = new Set(arr.slice(-50));
        }
      } catch {
        // Silently ignore — polling errors must never interrupt the manager
      }
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
