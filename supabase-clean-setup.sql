-- Clean Database Setup - Safe to run multiple times
-- Drop existing tables first for clean start
DROP TABLE IF EXISTS assignment_history CASCADE;
DROP TABLE IF EXISTS remarks CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS statuses CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ========== USERS TABLE ==========
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone TEXT DEFAULT '',
  role TEXT DEFAULT 'sales',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== STATUSES TABLE ==========
CREATE TABLE statuses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  bg TEXT NOT NULL,
  isHotPlus BOOLEAN DEFAULT false
);

-- ========== LEADS TABLE ==========
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT DEFAULT '',
  mobile TEXT DEFAULT '',
  other_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  profession TEXT DEFAULT '',
  city TEXT DEFAULT '',
  source TEXT DEFAULT 'Manual',
  campaign TEXT DEFAULT '',
  adset TEXT DEFAULT '',
  form_id TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  is_contacted BOOLEAN DEFAULT false,
  first_contacted_by UUID,
  called_count INTEGER DEFAULT 0,
  call_duration_total INTEGER DEFAULT 0,
  assigned_to UUID,
  assigned_by UUID,
  master_remark TEXT DEFAULT '',
  next_follow_up DATE,
  next_follow_up_time TEXT DEFAULT '',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== REMARKS TABLE ==========
CREATE TABLE remarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_by UUID,
  call_duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== CAMPAIGNS TABLE ==========
CREATE TABLE campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'Meta Ads',
  status TEXT DEFAULT 'active',
  budget DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== ASSIGNMENT HISTORY TABLE ==========
CREATE TABLE assignment_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  from_user UUID,
  to_user UUID,
  created_by UUID,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== ROW LEVEL SECURITY (RLS) ==========
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_history ENABLE ROW LEVEL SECURITY;

-- Allow all policies
DROP POLICY IF EXISTS "Allow all" ON users;
CREATE POLICY "Allow all" ON users FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all" ON leads;
CREATE POLICY "Allow all" ON leads FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all" ON remarks;
CREATE POLICY "Allow all" ON remarks FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all" ON statuses;
CREATE POLICY "Allow all" ON statuses FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all" ON campaigns;
CREATE POLICY "Allow all" ON campaigns FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all" ON assignment_history;
CREATE POLICY "Allow all" ON assignment_history FOR ALL USING (true);

-- ========== SEED DEFAULT STATUSES ==========
INSERT INTO statuses (id, label, color, bg, isHotPlus) VALUES
  ('new', 'New', '#3B82F6', '#EFF6FF', false),
  ('first_contacted', 'First Contacted', '#2563EB', '#EFF6FF', false),
  ('follow_up', 'Follow-up', '#F59E0B', '#FFFBEB', false),
  ('interested', 'Interested', '#10B981', '#ECFDF5', false),
  ('qualified', 'Qualified', '#7C3AED', '#F5F3FF', false),
  ('closed', 'Closed', '#059669', '#ECFDF5', false),
  ('hot', 'HOT LEAD', '#EF4444', '#FEF2F2', false),
  ('hot_plus', 'HOT+', '#DC2626', '#FEE2E2', true),
  ('partner', 'Partner', '#10B981', '#ECFDF5', false),
  ('not_interested', 'Not Interested', '#6B7280', '#F9FAFB', false);

-- ========== SEED DEFAULT USERS ==========
INSERT INTO users (name, email, password, role, phone, active) VALUES
  ('Rishabh Verma', 'rishabh@agency.com', 'admin123', 'admin', '+91 98765 00001', true),
  ('Sanmukh', 'sanmukh@agency.com', 'founder123', 'founder', '+91 98765 43210', true),
  ('Hina', 'hina@agency.com', 'bdm123', 'bdm_head', '+91 98765 43211', true),
  ('Pawan', 'pawan@agency.com', 'sales123', 'sales', '+91 98765 43212', true);

-- ========== INDEXES ==========
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_remarks_lead_id ON remarks(lead_id);

-- Verify
SELECT 'Setup Complete!' as status;