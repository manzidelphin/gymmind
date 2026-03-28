-- BodyMax membership plans seed
-- gym_id = 3 (BODYMAX)
-- Run: mysql -u root -p gymmind < backend/sql/seed-bodymax.sql

-- Update existing monthly plan to correct price
UPDATE membership_plans
SET name = 'Monthly', price = 25000, duration_days = 30, is_active = true
WHERE gym_id = 3 AND type = 'time_based' AND duration_days = 30;

-- Half-year plan (only insert if not already present)
INSERT INTO membership_plans (gym_id, name, type, duration_days, sessions, price, is_active)
SELECT 3, 'Half-year', 'time_based', 180, NULL, 120000, true
WHERE NOT EXISTS (
  SELECT 1 FROM membership_plans WHERE gym_id = 3 AND name = 'Half-year'
);

-- Yearly plan
INSERT INTO membership_plans (gym_id, name, type, duration_days, sessions, price, is_active)
SELECT 3, 'Yearly', 'time_based', 365, NULL, 200000, true
WHERE NOT EXISTS (
  SELECT 1 FROM membership_plans WHERE gym_id = 3 AND name = 'Yearly'
);

-- 10 Sessions plan
INSERT INTO membership_plans (gym_id, name, type, duration_days, sessions, price, is_active)
SELECT 3, '10 Sessions', 'session_based', NULL, 10, 10000, true
WHERE NOT EXISTS (
  SELECT 1 FROM membership_plans WHERE gym_id = 3 AND name = '10 Sessions'
);

-- Verify
SELECT id, name, type, duration_days, sessions, price
FROM membership_plans
WHERE gym_id = 3
ORDER BY price;
