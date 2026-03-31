import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
});

// Attach X-Gym-Slug and Authorization headers on every request
api.interceptors.request.use(config => {
  const slug  = localStorage.getItem('gymSlug');
  const token = localStorage.getItem('token');
  console.log('Sending X-Gym-Slug:', slug);
  if (slug)  config.headers['X-Gym-Slug']   = slug;
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

export default api;

/**
 * Public API — no X-Gym-Slug or Authorization headers.
 * Used for fully public endpoints like gym self-signup.
 */
export const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
});

/**
 * Institution API — Authorization header only, no X-Gym-Slug.
 * Uses the separate 'institutionToken' localStorage key.
 */
export const institutionApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
});

institutionApi.interceptors.request.use(config => {
  const token = localStorage.getItem('institutionToken');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

/**
 * HR Admin API — Authorization header only (hr_token), no X-Gym-Slug.
 */
export const hrApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
});

hrApi.interceptors.request.use(config => {
  const token = localStorage.getItem('hr_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});
