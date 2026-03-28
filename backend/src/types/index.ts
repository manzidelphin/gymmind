// ============================================================
// GymMind shared TypeScript types
// ============================================================

export interface Gym {
  id: number;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  subscription_plan: 'trial' | 'basic' | 'pro' | 'enterprise';
  subscription_status: 'active' | 'suspended' | 'cancelled';
  trial_ends_at: string | null;
  created_at: string;
}

export interface User {
  id: number;
  gym_id: number | null;
  name: string;
  phone: string;
  role: 'super_admin' | 'gym_owner' | 'gym_manager' | 'member' | 'institution_admin';
  institution_id: number | null;
  parent_id: number | null;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
}

export interface Institution {
  id: number;
  gym_id: number;
  name: string;
  allows_dependents: boolean;
  created_at: string;
}

export interface MembershipPlan {
  id: number;
  gym_id: number;
  name: string;
  type: 'time_based' | 'session_based' | 'institutional';
  duration_days: number | null;
  sessions: number | null;
  price: number;
  currency: string;
  is_active: boolean;
}

export interface UserMembership {
  id: number;
  gym_id: number;
  user_id: number;
  plan_id: number;
  start_date: string;
  end_date: string | null;
  remaining_sessions: number | null;
  status: 'active' | 'expired' | 'cancelled';
  assigned_by: number | null;
  created_at: string;
}

export interface Checkin {
  id: number;
  gym_id: number;
  user_id: number;
  membership_id: number | null;
  checkin_type: 'individual' | 'institutional' | 'dependent';
  checked_in_at: string;
}

export interface Service {
  id: number;
  gym_id: number;
  name: string;
  description: string | null;
  price_per_visit: number;
  currency: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}

export interface CheckinResult {
  allowed: boolean;
  checkin_type?: 'individual' | 'institutional' | 'dependent';
  reason?: 'no_membership' | 'membership_expired' | 'no_sessions' | 'user_suspended' | 'user_not_found' | 'service_not_covered' | 'service_not_in_plan' | 'pending_approval';
  user?: User;
  membership?: UserMembership & { plan_name: string; type: string };
  /** Populated when reason = 'membership_expired' */
  expiredOn?: string;
  planName?: string;
  /** Populated when reason = 'pending_approval' */
  pendingPlan?: string;
  /** Populated when reason is service-related or check-in succeeded with a service */
  serviceName?: string;
}

export interface JwtPayload {
  userId: number;
  gymId: number | null;  // null for super_admin only
  role: User['role'];
  phone: string;
  institutionId?: number;  // set for institution_admin role
}

// Extend Express Request so every route handler gets req.gym and req.user
declare global {
  namespace Express {
    interface Request {
      gym: Gym;
      user: User;
    }
  }
}
