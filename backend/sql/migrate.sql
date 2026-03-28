-- ============================================================
-- GymMind incremental migration
-- Run this on an existing database to bring it up to date.
-- Safe to run multiple times (uses IF NOT EXISTS / IGNORE).
-- ============================================================

-- Add rate_per_session to institutions (for billing calculation)
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS rate_per_session DECIMAL(10,2) NOT NULL DEFAULT 0
  AFTER allows_dependents;

-- Add index on checkins(user_id, checked_in_at) for billing queries
CREATE INDEX IF NOT EXISTS idx_checkins_user_date
  ON checkins(user_id, checked_in_at);

-- Services feature
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS service_id INT NULL REFERENCES services(id);

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

CREATE TABLE IF NOT EXISTS plan_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL REFERENCES membership_plans(id),
  service_id INT NOT NULL REFERENCES services(id),
  gym_id INT NOT NULL REFERENCES gyms(id),
  UNIQUE KEY unique_plan_service (plan_id, service_id)
);

CREATE TABLE IF NOT EXISTS institution_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  institution_id INT NOT NULL REFERENCES institutions(id),
  service_id INT NOT NULL REFERENCES services(id),
  gym_id INT NOT NULL REFERENCES gyms(id),
  allowed_for ENUM('employees', 'dependents', 'both') DEFAULT 'both',
  UNIQUE KEY unique_inst_service (institution_id, service_id)
);

-- Walk-in day pass
ALTER TABLE services ADD COLUMN IF NOT EXISTS walkin_price DECIMAL(10,2) DEFAULT 0;

-- Extend checkin_type to include walk-in
ALTER TABLE checkins MODIFY COLUMN checkin_type
  ENUM('individual', 'institutional', 'dependent', 'walkin') NOT NULL;

-- Allow NULL user_id on checkins for anonymous walk-ins
ALTER TABLE checkins MODIFY COLUMN user_id INT NULL;

-- Store payer phone on walk-in check-ins for display in attendance feed
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS payer_phone VARCHAR(20) NULL;

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

CREATE TABLE IF NOT EXISTS walkin_payment_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  walkin_payment_id INT NOT NULL REFERENCES walkin_payments(id),
  service_id INT NOT NULL REFERENCES services(id),
  price DECIMAL(10,2) NOT NULL,
  gym_id INT NOT NULL REFERENCES gyms(id)
);

-- Institutional billing: tracks monthly invoices per institution
CREATE TABLE IF NOT EXISTS institutional_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL REFERENCES gyms(id),
  institution_id INT NOT NULL REFERENCES institutions(id),
  month VARCHAR(7) NOT NULL,
  total_visits INT NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'RWF',
  status ENUM('pending','paid','overdue') DEFAULT 'pending',
  paid_at TIMESTAMP NULL,
  payment_reference VARCHAR(100) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_institution_month (institution_id, month, gym_id)
);
