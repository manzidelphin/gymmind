-- ============================================================
-- GymMind Seed Data
-- 2 gyms, 1 super_admin, full user set per gym, institutions,
-- membership plans, active memberships, and recent check-ins.
-- ============================================================

-- ============================================================
-- GYMS
-- ============================================================
INSERT INTO gyms (id, name, slug, phone, address, subscription_plan, subscription_status, trial_ends_at) VALUES
(1, 'Kigali Fitness Center', 'kigali-fitness', '+250788000001', 'KG 1 Ave, Kigali', 'pro',    'active', NULL),
(2, 'Butare Gym',            'butare-gym',     '+250788000002', 'NB 5 St, Huye',   'basic',  'active', NULL);

-- ============================================================
-- SUPER ADMIN (gym_id = NULL — spans all gyms)
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
(1, NULL, 'Platform Admin', '+250700000000', 'super_admin', NULL, NULL, 'active');

-- ============================================================
-- GYM 1 STAFF
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
(2, 1, 'Alice Uwimana',  '+250788100001', 'gym_owner',   NULL, NULL, 'active'),
(3, 1, 'Bob Nkurunziza', '+250788100002', 'gym_manager', NULL, NULL, 'active');

-- ============================================================
-- GYM 2 STAFF
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
(4, 2, 'Claire Mukamana', '+250788200001', 'gym_owner',   NULL, NULL, 'active'),
(5, 2, 'David Habimana',  '+250788200002', 'gym_manager', NULL, NULL, 'active');

-- ============================================================
-- INSTITUTIONS (must come before institutional members)
-- ============================================================
INSERT INTO institutions (id, gym_id, name, allows_dependents, rate_per_session) VALUES
(1, 1, 'RwandAir',        TRUE,  1000.00),
(2, 2, 'Bank of Kigali',  FALSE, 2000.00);

-- ============================================================
-- GYM 1 MEMBERS
-- (ids 6–10: individual × 2, institutional employee, dependent, extra)
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
-- Individual members
(6,  1, 'Eric Bizimana',   '+250788100003', 'member', NULL, NULL, 'active'),
(7,  1, 'Fiona Mukasine',  '+250788100004', 'member', NULL, NULL, 'active'),
-- Institutional employee (RwandAir, gym 1)
(8,  1, 'Grace Ingabire',  '+250788100005', 'member', 1,    NULL, 'active'),
-- Dependent of Grace (parent_id = 8)
(9,  1, 'Henry Ingabire',  '+250788100006', 'member', NULL, 8,    'active');

-- ============================================================
-- GYM 2 MEMBERS
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
-- Individual members
(10, 2, 'Irene Mutesi',    '+250788200003', 'member', NULL, NULL, 'active'),
(11, 2, 'James Nzeyimana', '+250788200004', 'member', NULL, NULL, 'active'),
-- Institutional employee (Bank of Kigali, gym 2)
(12, 2, 'Karen Umutoni',   '+250788200005', 'member', 2,    NULL, 'active'),
-- Dependent (Bank of Kigali allows_dependents=FALSE — included for data completeness
--           but checkin logic will follow the institution rule)
(13, 2, 'Leo Nkusi',       '+250788200006', 'member', NULL, 12,   'active');

-- ============================================================
-- UNCLAIMED MEMBERS (phone NULL, status='unclaimed')
-- Pre-loaded by manager; waiting for first visit to claim account
-- ============================================================
INSERT INTO users (id, gym_id, name, phone, role, institution_id, parent_id, status) VALUES
(14, 1, 'Marie Uwase',      NULL, 'member', NULL, NULL, 'unclaimed'),
(15, 1, 'Patrick Mugisha',  NULL, 'member', NULL, NULL, 'unclaimed'),
(16, 2, 'Sandra Niyomugabo',NULL, 'member', NULL, NULL, 'unclaimed');

-- ============================================================
-- MEMBERSHIP PLANS — GYM 1
-- ============================================================
INSERT INTO membership_plans (id, gym_id, name, type, duration_days, sessions, price, currency, is_active) VALUES
(1, 1, 'Monthly',    'time_based',    30,   NULL, 25000.00,  'RWF', TRUE),
(2, 1, 'Half-Year',  'time_based',    180,  NULL, 120000.00, 'RWF', TRUE),
(3, 1, 'Yearly',     'time_based',    365,  NULL, 200000.00, 'RWF', TRUE),
(4, 1, '10 Sessions','session_based', NULL, 10,   10000.00,  'RWF', TRUE);

-- ============================================================
-- MEMBERSHIP PLANS — GYM 2
-- ============================================================
INSERT INTO membership_plans (id, gym_id, name, type, duration_days, sessions, price, currency, is_active) VALUES
(5, 2, 'Monthly',    'time_based',    30,   NULL, 20000.00,  'RWF', TRUE),
(6, 2, 'Half-Year',  'time_based',    180,  NULL, 100000.00, 'RWF', TRUE),
(7, 2, 'Yearly',     'time_based',    365,  NULL, 180000.00, 'RWF', TRUE),
(8, 2, '10 Sessions','session_based', NULL, 10,   9000.00,   'RWF', TRUE);

-- ============================================================
-- ACTIVE MEMBERSHIPS
-- Gym 1: Eric on monthly (time_based), Fiona on 10-sessions
-- Gym 2: Irene on monthly (time_based), James on 10-sessions
-- ============================================================
INSERT INTO user_memberships (id, gym_id, user_id, plan_id, start_date, end_date, remaining_sessions, status, assigned_by) VALUES
-- Gym 1
(1, 1, 6,  1, DATE(NOW()), DATE(DATE_ADD(NOW(), INTERVAL 30 DAY)),  NULL, 'active', 3),
(2, 1, 7,  4, DATE(NOW()), NULL,                                     7,    'active', 3),
-- Gym 2
(3, 2, 10, 5, DATE(NOW()), DATE(DATE_ADD(NOW(), INTERVAL 30 DAY)),  NULL, 'active', 5),
(4, 2, 11, 8, DATE(NOW()), NULL,                                     7,    'active', 5);

-- ============================================================
-- CHECK-INS — last 7 days, 3–5 per gym
-- ============================================================
INSERT INTO checkins (gym_id, user_id, membership_id, checkin_type, checked_in_at) VALUES
-- Gym 1
(1, 6,  1,    'individual',    DATE_SUB(NOW(), INTERVAL 6 DAY)),
(1, 7,  2,    'individual',    DATE_SUB(NOW(), INTERVAL 5 DAY)),
(1, 8,  NULL, 'institutional', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(1, 9,  NULL, 'dependent',     DATE_SUB(NOW(), INTERVAL 3 DAY)),
(1, 6,  1,    'individual',    DATE_SUB(NOW(), INTERVAL 1 DAY)),
-- Gym 2
(2, 10, 3,    'individual',    DATE_SUB(NOW(), INTERVAL 6 DAY)),
(2, 11, 4,    'individual',    DATE_SUB(NOW(), INTERVAL 4 DAY)),
(2, 12, NULL, 'institutional', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(2, 10, 3,    'individual',    DATE_SUB(NOW(), INTERVAL 2 DAY)),
(2, 11, 4,    'individual',    DATE_SUB(NOW(), INTERVAL 1 DAY));
