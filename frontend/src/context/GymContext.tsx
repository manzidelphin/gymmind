import React, { createContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';

export interface GymUser {
  id: number;
  gym_id: number | null;
  name: string;
  phone: string;
  role: 'super_admin' | 'gym_owner' | 'gym_manager' | 'member';
  institution_id: number | null;
  parent_id: number | null;
  status: string;
}

interface GymContextValue {
  gymSlug: string;
  gymName: string;
  user: GymUser | null;
  token: string | null;
  setAuth: (user: GymUser, token: string) => void;
  clearAuth: () => void;
}

export const GymContext = createContext<GymContextValue>({
  gymSlug: '',
  gymName: '',
  user: null,
  token: null,
  setAuth: () => {},
  clearAuth: () => {},
});

export function GymProvider({ children }: { children: React.ReactNode }) {
  const { gymSlug = '' } = useParams<{ gymSlug: string }>();

  // Set synchronously on every render so the value is in localStorage
  // before any child useEffect (e.g. ManagerDashboard's fetchCount) runs.
  // useEffect ordering is bottom-up (children before parents), so a pure
  // useEffect here would be too late when a persisted session is restored.
  if (gymSlug) localStorage.setItem('gymSlug', gymSlug);

  // Also keep the effect for slug changes after initial render
  useEffect(() => {
    if (gymSlug) localStorage.setItem('gymSlug', gymSlug);
  }, [gymSlug]);

  const [user, setUser] = useState<GymUser | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [gymName, setGymName] = useState<string>('');

  // Fetch gym name once a staff member is authenticated
  useEffect(() => {
    if (!token || !gymSlug) return;
    api.get('/gyms/me')
      .then(r => setGymName(r.data.gym?.name ?? ''))
      .catch(() => {});
  }, [token, gymSlug]);

  function setAuth(newUser: GymUser, newToken: string) {
    setUser(newUser);
    setToken(newToken);
    localStorage.setItem('user',  JSON.stringify(newUser));
    localStorage.setItem('token', newToken);
  }

  function clearAuth() {
    setUser(null);
    setToken(null);
    setGymName('');
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }

  return (
    <GymContext.Provider value={{ gymSlug, gymName, user, token, setAuth, clearAuth }}>
      {children}
    </GymContext.Provider>
  );
}
