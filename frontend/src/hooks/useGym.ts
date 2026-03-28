import { useContext } from 'react';
import { GymContext } from '../context/GymContext';

// Convenience hook — import this instead of useContext(GymContext) everywhere
export function useGym() {
  return useContext(GymContext);
}
