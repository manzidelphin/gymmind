-- ============================================================
-- GymMind Schema
-- Multi-tenant: every table (except gyms itself) has gym_id.
-- Create tables in FK dependency order.
-- ============================================================

-- TABLE 1: gyms
CREATE TABLE gyms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20) NULL,
  address TEXT NULL,
  subscription_plan ENUM('trial', 'basic', 'pro', 'enterprise') DEFAULT 'trial',
  subscription_status ENUM('active', 'suspended', 'cancelled') DEFAULT 'active',
  registration_status ENUM('approved', 'pending') DEFAULT 'approved',
  trial_ends_at DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLE 2: users
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NULL REFERENCES gyms(id),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NULL,
  role ENUM('super_admin', 'gym_owner', 'gym_manager', 'member') DEFAULT 'member',
  institution_id INT NULL,                   -- FK added after institutions table
  parent_id INT NULL REFERENCES users(id),  -- for dependents
  status ENUM('pending', 'active', 'suspended', 'unclaimed') DEFAULT 'unclaimed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_phone_per_gym (gym_id, phone)
);

-- TABLE 3: institutions
CREATE TABLE institutions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  name VARCHAR(255) NOT NULL,
  allows_dependents BOOLEAN DEFAULT FALSE,
  rate_per_session DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add institution FK to users now that institutions table exists
ALTER TABLE users ADD CONSTRAINT fk_users_institution
  FOREIGN KEY (institution_id) REFERENCES institutions(id);

-- TABLE 4: membership_plans
CREATE TABLE membership_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  name VARCHAR(255) NOT NULL,
  type ENUM('time_based', 'session_based', 'institutional') NOT NULL,
  duration_days INT NULL,
  sessions INT NULL,
  price DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'RWF',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLE 5: user_memberships
CREATE TABLE user_memberships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  user_id INT NOT NULL REFERENCES users(id),
  plan_id INT NOT NULL REFERENCES membership_plans(id),
  start_date DATE NOT NULL,
  end_date DATE NULL,
  remaining_sessions INT NULL,
  status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
  assigned_by INT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLE 6: checkins
CREATE TABLE checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  user_id INT NULL REFERENCES users(id),
  membership_id INT NULL REFERENCES user_memberships(id),
  checkin_type ENUM('individual', 'institutional', 'dependent', 'walkin') NOT NULL,
  payer_phone VARCHAR(20) NULL,
  checked_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLE 7: otps
CREATE TABLE otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NULL REFERENCES gyms(id),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_gym ON users(gym_id);
CREATE INDEX idx_users_phone_gym ON users(gym_id, phone);
CREATE INDEX idx_checkins_gym_date ON checkins(gym_id, checked_in_at);
CREATE INDEX idx_memberships_gym_user ON user_memberships(gym_id, user_id, status);
CREATE INDEX idx_otps_phone_gym ON otps(gym_id, phone, used);

-- TABLE 8: membership_requests
-- A member selects a plan on the check-in kiosk (or claim page) and submits a
-- request. The gym manager reviews pending requests and approves (which triggers
-- membership activation) or rejects them.
-- gym_id enforces tenant isolation: managers only see their own gym's requests.
CREATE TABLE membership_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  gym_id           INT NOT NULL REFERENCES gyms(id),
  user_id          INT NULL REFERENCES users(id),          -- NULL for brand-new walk-in members
  new_member_name  VARCHAR(255) NULL,                      -- used when user_id is NULL
  new_member_phone VARCHAR(20)  NULL,                      -- used when user_id is NULL
  plan_id          INT NOT NULL REFERENCES membership_plans(id),
  status           ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  requested_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at     TIMESTAMP NULL,
  processed_by     INT NULL REFERENCES users(id),
  notes            TEXT NULL
);

CREATE INDEX idx_membership_requests_gym_status
  ON membership_requests(gym_id, status, requested_at);

-- TABLE 9: payments
-- Tracks MTN Mobile Money payment attempts for membership requests.
CREATE TABLE IF NOT EXISTS payments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  gym_id                INT NOT NULL REFERENCES gyms(id),
  user_id               INT NULL REFERENCES users(id),
  membership_request_id INT NULL REFERENCES membership_requests(id),
  amount                DECIMAL(10,2) NOT NULL,
  currency              VARCHAR(10) DEFAULT 'RWF',
  payer_phone           VARCHAR(20) NOT NULL,
  mtn_transaction_id    VARCHAR(100) NOT NULL,
  status                ENUM('pending', 'successful', 'failed') DEFAULT 'pending',
  failure_reason        VARCHAR(255) NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_gym         ON payments(gym_id);
CREATE INDEX idx_payments_transaction ON payments(mtn_transaction_id);

-- Add MTN MoMo settings to gyms table (run once; uses IF NOT EXISTS via ALTER)
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS momo_number           VARCHAR(20)  NULL,
  ADD COLUMN IF NOT EXISTS momo_api_user_id      VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS momo_api_key          VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS momo_subscription_key VARCHAR(100) NULL;

-- ============================================================
-- SERVICES FEATURE (migration)
-- ============================================================

-- Services offered by the gym (gym floor, pool, sauna, etc.)
CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  price_per_visit DECIMAL(10,2) DEFAULT 0,
  walkin_price DECIMAL(10,2) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'RWF',
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Links membership plans to the services they include
CREATE TABLE IF NOT EXISTS plan_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL REFERENCES membership_plans(id),
  service_id INT NOT NULL REFERENCES services(id),
  gym_id INT NOT NULL REFERENCES gyms(id),
  UNIQUE KEY unique_plan_service (plan_id, service_id)
);

-- Links institutions to services + who can access them
CREATE TABLE IF NOT EXISTS institution_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  institution_id INT NOT NULL REFERENCES institutions(id),
  service_id INT NOT NULL REFERENCES services(id),
  gym_id INT NOT NULL REFERENCES gyms(id),
  allowed_for ENUM('employees', 'dependents', 'both') DEFAULT 'both',
  UNIQUE KEY unique_inst_service (institution_id, service_id)
);

-- Track which service was used during each check-in
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS service_id INT NULL REFERENCES services(id);

-- Walk-in day pass payments (no membership required)
CREATE TABLE IF NOT EXISTS walkin_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  user_id INT NULL REFERENCES users(id),
  payer_phone VARCHAR(20) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'RWF',
  mtn_transaction_id VARCHAR(100) NULL,
  status ENUM('pending', 'successful', 'failed') DEFAULT 'pending',
  failure_reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Which services were included in a walk-in payment
CREATE TABLE IF NOT EXISTS walkin_payment_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  walkin_payment_id INT NOT NULL REFERENCES walkin_payments(id),
  service_id INT NOT NULL REFERENCES services(id),
  price DECIMAL(10,2) NOT NULL,
  gym_id INT NOT NULL REFERENCES gyms(id)
);
