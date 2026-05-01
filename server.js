require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'crm_secret_token';

console.log('=== SERVER STARTING ===');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');
console.log('SUPABASE_KEY:', SUPABASE_KEY ? 'SET' : 'NOT SET');

// ============================================
// SUPABASE HELPER
// ============================================
async function sb(endpoint, method = 'GET', body = null) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('ERROR: Supabase not configured');
    return { data: null, error: 'Supabase not configured' };
  }

  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const url = SUPABASE_URL + endpoint;
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      console.log('SUPABASE ERROR:', response.status, JSON.stringify(data));
      return { data: null, error: JSON.stringify(data) };
    }

    return { data: data, error: null };
  } catch (err) {
    console.log('SUPABASE EXCEPTION:', err.message);
    return { data: null, error: err.message };
  }
}

// ============================================
// PHONE FORMATTER
// ============================================
function formatPhone(phone) {
  if (!phone) return '';
  const cleaned = String(phone).replace(/\D/g, '');

  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return '+91 ' + cleaned.substring(2, 7) + ' ' + cleaned.substring(7);
  }
  if (cleaned.length === 10) {
    return '+91 ' + cleaned.substring(0, 5) + ' ' + cleaned.substring(5);
  }
  return '+' + cleaned;
}

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  const { data, error } = await sb('/rest/v1/users?select=id&limit=1');
  res.json({
    status: 'ok',
    supabase: error ? 'error' : 'connected',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// AUTH - LOGIN
// ============================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { data, error } = await sb(
    `/rest/v1/users?email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}&active=eq.true&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Database error' });
  }

  if (!data || data.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = data[0];
  delete user.password;
  res.json(user);
});

// ============================================
// USERS
// ============================================
app.get('/api/users', async (req, res) => {
  const { data, error } = await sb('/rest/v1/users?select=*&active=eq.true&order=name.asc');
  if (error) return res.status(500).json({ error: 'Failed to fetch users' });

  const safeUsers = (data || []).map(u => {
    const { password, ...safe } = u;
    return safe;
  });
  res.json(safeUsers);
});

app.patch('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  delete updates.password; // Prevent password update

  const { data, error } = await sb(`/rest/v1/users?id=eq.${id}`, 'PATCH', updates);
  if (error) return res.status(500).json({ error: 'Failed to update user' });
  res.json({ success: true });
});

// ============================================
// STATUSES
// ============================================
app.get('/api/statuses', async (req, res) => {
  const { data, error } = await sb('/rest/v1/statuses?select=*&order=id.asc');
  if (error || !data || data.length === 0) {
    return res.json([
      { id: 'new', label: 'New', color: '#3B82F6', bg: '#EFF6FF' },
      { id: 'first_contacted', label: 'First Contacted', color: '#2563EB', bg: '#EFF6FF' },
      { id: 'follow_up', label: 'Follow-up', color: '#F59E0B', bg: '#FFFBEB' },
      { id: 'interested', label: 'Interested', color: '#10B981', bg: '#ECFDF5' },
      { id: 'qualified', label: 'Qualified', color: '#7C3AED', bg: '#F5F3FF' },
      { id: 'closed', label: 'Closed', color: '#059669', bg: '#ECFDF5' },
      { id: 'hot', label: 'HOT LEAD', color: '#EF4444', bg: '#FEF2F2' },
      { id: 'hot_plus', label: 'HOT+', color: '#DC2626', bg: '#FEE2E2' },
      { id: 'partner', label: 'Partner', color: '#10B981', bg: '#ECFDF5' },
      { id: 'not_interested', label: 'Not Interested', color: '#6B7280', bg: '#F9FAFB' }
    ]);
  }
  res.json(data);
});

// ============================================
// LEADS
// ============================================
app.get('/api/leads', async (req, res) => {
  const { data, error } = await sb(
    '/rest/v1/leads?select=*,assigned_user:users!assigned_to(name,role),remarks:remarks(*)&order=created_at.desc'
  );
  if (error) return res.status(500).json({ error: 'Failed to fetch leads' });
  res.json(data || []);
});

app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await sb(
    `/rest/v1/leads?id=eq.${id}&select=*,assigned_user:users!assigned_to(name,role),remarks:remarks(*,creator:users!created_by(name))`
  );
  if (error) return res.status(500).json({ error: 'Failed to fetch lead' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Lead not found' });
  res.json(data[0]);
});

app.post('/api/leads', async (req, res) => {
  const newLead = {
    ...req.body,
    status: req.body.status || 'new',
    last_activity: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await sb('/rest/v1/leads', 'POST', newLead);
  if (error) return res.status(500).json({ error: 'Failed to create lead' });
  res.status(201).json(data);
});

app.patch('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {
    ...req.body,
    updated_at: new Date().toISOString(),
    last_activity: new Date().toISOString()
  };
  delete updates.id;
  delete updates.created_at;

  const { data, error } = await sb(`/rest/v1/leads?id=eq.${id}`, 'PATCH', updates);
  if (error) return res.status(500).json({ error: 'Failed to update lead' });
  res.json({ success: true });
});

app.patch('/api/leads/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const { data, error } = await sb(`/rest/v1/leads?id=eq.${id}`, 'PATCH', {
    status,
    updated_at: new Date().toISOString(),
    last_activity: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: 'Failed to update status' });
  res.json({ success: true });
});

app.patch('/api/leads/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { assigned_to, current_user_id, note } = req.body;

  // Get current assignment
  const { data: currentLead } = await sb(`/rest/v1/leads?id=eq.${id}&select=assigned_to`);
  const oldAssignedTo = currentLead?.[0]?.assigned_to;

  // Update lead
  const { error } = await sb(`/rest/v1/leads?id=eq.${id}`, 'PATCH', {
    assigned_to,
    assigned_by: current_user_id,
    updated_at: new Date().toISOString(),
    last_activity: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: 'Failed to reassign lead' });

  // Record history
  await sb('/rest/v1/assignment_history', 'POST', {
    lead_id: id,
    from_user: oldAssignedTo,
    to_user: assigned_to,
    created_by: current_user_id,
    note: note || '',
    created_at: new Date().toISOString()
  });

  res.json({ success: true });
});

app.delete('/api/leads/:id', async (req, res) => {
  const { error } = await sb(`/rest/v1/leads?id=eq.${req.params.id}`, 'DELETE');
  if (error) return res.status(500).json({ error: 'Failed to delete lead' });
  res.json({ success: true });
});

// ============================================
// REMARKS
// ============================================
app.get('/api/leads/:id/remarks', async (req, res) => {
  const { data, error } = await sb(
    `/rest/v1/remarks?lead_id=eq.${req.params.id}&order=created_at.asc&select=*`
  );
  if (error) return res.status(500).json({ error: 'Failed to fetch remarks' });
  res.json(data || []);
});

app.post('/api/remarks', async (req, res) => {
  const { lead_id, text, created_by, call_duration } = req.body;

  if (!lead_id || !text) {
    return res.status(400).json({ error: 'Lead ID and text required' });
  }

  const newRemark = {
    lead_id,
    text,
    created_by: created_by || null,
    call_duration: call_duration || null,
    created_at: new Date().toISOString()
  };

  const { data, error } = await sb('/rest/v1/remarks', 'POST', newRemark);
  if (error) return res.status(500).json({ error: 'Failed to add remark' });

  // Update lead activity
  await sb(`/rest/v1/leads?id=eq.${lead_id}`, 'PATCH', {
    last_activity: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  res.status(201).json(data);
});

// ============================================
// CAMPAIGNS
// ============================================
app.get('/api/campaigns', async (req, res) => {
  const { data, error } = await sb('/rest/v1/campaigns?select=*&order=created_at.desc');
  if (error) return res.status(500).json({ error: 'Failed to fetch campaigns' });
  res.json(data || []);
});

app.post('/api/campaigns', async (req, res) => {
  const { data, error } = await sb('/rest/v1/campaigns', 'POST', req.body);
  if (error) return res.status(500).json({ error: 'Failed to create campaign' });
  res.status(201).json(data);
});

app.patch('/api/campaigns/:id', async (req, res) => {
  const { data, error } = await sb(`/rest/v1/campaigns?id=eq.${req.params.id}`, 'PATCH', req.body);
  if (error) return res.status(500).json({ error: 'Failed to update campaign' });
  res.json({ success: true });
});

// ============================================
// MAKE.COM WEBHOOK - THE MAIN INTEGRATION
// ============================================
app.post('/webhook/make', async (req, res) => {
  console.log('\n========== WEBHOOK RECEIVED ==========');
  console.log('Time:', new Date().toISOString());

  try {
    // Get payload
    let payload = req.body;
    console.log('Raw body:', JSON.stringify(payload));

    // Handle nested body
    if (payload.body) {
      payload = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
    }

    // Extract data from flat structure
    const name = payload.name || payload.full_name || 'New Lead';
    const mobile = payload.mobile || payload.phone || payload.telephone;
    const email = payload.email || '';
    const profession = payload.profession || payload.job_title || '';
    const city = payload.city || payload.location || '';
    const ad_id = payload.ad_id || payload.adId || '';
    const ad_name = payload.ad_name || payload.adName || '';
    const campaign_name = payload.campaign_name || payload.campaignName || '';

    console.log('Parsed - Name:', name, 'Mobile:', mobile, 'Email:', email);

    // Validate mobile
    if (!mobile) {
      console.log('ERROR: No mobile number');
      return res.status(400).json({
        success: false,
        error: 'Mobile number is required'
      });
    }

    // Format mobile
    const formattedMobile = formatPhone(mobile);
    console.log('Formatted mobile:', formattedMobile);

    // Check for existing lead
    const { data: existingLeads } = await sb(
      '/rest/v1/leads?select=id,mobile&order=created_at.desc'
    );

    // Find duplicate by normalized mobile
    const cleanNew = formattedMobile.replace(/\s/g, '').replace('+', '');
    const existingLead = (existingLeads || []).find(lead => {
      if (!lead || !lead.mobile) return false;
      const cleanExist = lead.mobile.replace(/\s/g, '').replace('+', '');
      return cleanExist.endsWith(cleanNew) || cleanNew.endsWith(cleanExist);
    });

    const timestamp = new Date().toISOString();

    if (existingLead) {
      console.log('DUPLICATE: Found existing lead', existingLead.id);

      // Update existing lead
      await sb(`/rest/v1/leads?id=eq.${existingLead.id}`, 'PATCH', {
        last_activity: timestamp,
        updated_at: timestamp
      });

      // Add remark
      await sb('/rest/v1/remarks', 'POST', {
        lead_id: existingLead.id,
        text: `🔄 Re-inquiry via Make.com (${timestamp})\nCampaign: ${campaign_name || 'N/A'}`,
        created_by: null,
        created_at: timestamp
      });

      console.log('SUCCESS: Duplicate updated');
      return res.json({
        success: true,
        message: 'Duplicate lead updated',
        lead_id: existingLead.id,
        is_duplicate: true
      });
    }

    // Create new lead - use all available columns
    console.log('Creating NEW lead...');
    const newLead = {
      name: name,
      mobile: formattedMobile,
      email: email,
      source: campaign_name ? 'Meta Ads' : 'Make.com',
      campaign: campaign_name || ad_name || '',
      status: 'new',
      last_activity: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    };

    console.log('Lead data to insert:', JSON.stringify(newLead));
    const { data: createdLead, error: createError } = await sb('/rest/v1/leads', 'POST', newLead);

    if (createError) {
      console.log('ERROR creating lead:', createError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create lead',
        details: createError
      });
    }

    const leadId = createdLead?.[0]?.id;
    console.log('SUCCESS: New lead created', leadId);

    // Add initial remark
    await sb('/rest/v1/remarks', 'POST', {
      lead_id: leadId,
      text: `📥 New lead via Make.com (${timestamp})\nCampaign: ${campaign_name || 'N/A'}`,
      created_by: null,
      created_at: timestamp
    });

    console.log('========== WEBHOOK DONE ==========\n');

    res.json({
      success: true,
      message: 'Lead created successfully',
      lead_id: leadId,
      is_duplicate: false
    });

  } catch (err) {
    console.log('CATCH ERROR:', err.message, err.stack);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Test endpoint
app.get('/webhook/make/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Make.com webhook test endpoint',
    expected_payload: {
      name: 'Full name',
      mobile: 'Phone number (required)',
      email: 'Email (optional)',
      campaign_name: 'Campaign name (optional)'
    }
  });
});

app.post('/webhook/make/test', async (req, res) => {
  const testPayload = {
    name: 'Test Lead ' + Date.now(),
    mobile: '+91 98765 ' + Math.floor(Math.random() * 90000 + 10000),
    email: 'test@example.com',
    campaign_name: 'Test Campaign'
  };

  req.body = testPayload;
  return app._router.handle(req, res);
});

// ============================================
// META WEBHOOK
// ============================================
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Meta webhook verification - mode:', mode, 'token:', token ? 'provided' : 'missing');

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('Meta webhook VERIFIED');
    res.status(200).send(challenge.toString());
  } else {
    console.log('Meta webhook FORBIDDEN');
    res.status(403).send('Forbidden');
  }
});

app.post('/webhook/meta', async (req, res) => {
  console.log('\n========== META WEBHOOK RECEIVED ==========');

  try {
    const entry = req.body.entry || [];

    for (const e of entry) {
      const changes = e.changes || [];

      for (const change of changes) {
        if (change.field === 'leadgen') {
          const leadId = change.value.lead_id;
          const formId = change.value.form_id || '';
          const adId = change.value.ad_id || '';

          console.log('New Meta Lead:', leadId, 'Form:', formId);

          // Fetch from Meta API if token available
          if (META_ACCESS_TOKEN) {
            const metaLead = await fetchMetaLead(leadId);
            if (metaLead && !metaLead.error) {
              // Process the lead
              console.log('Meta lead data:', JSON.stringify(metaLead));
            }
          } else {
            console.log('WARNING: No META_ACCESS_TOKEN - cannot fetch lead details');
          }
        }
      }
    }

    console.log('========== META WEBHOOK DONE ==========\n');
    res.status(200).send('OK');

  } catch (err) {
    console.log('META WEBHOOK ERROR:', err.message);
    res.status(200).send('OK'); // Always return 200 to prevent retries
  }
});

async function fetchMetaLead(leadId) {
  const version = 'v18.0';
  const url = `https://graph.facebook.com/${version}/${leadId}?access_token=${META_ACCESS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (err) {
    console.log('Meta API error:', err.message);
    return null;
  }
}

// ============================================
// SEED DATA
// ============================================
app.post('/api/seed', async (req, res) => {
  const defaultUsers = [
    { name: 'Rishabh Verma', email: 'rishabh@agency.com', password: 'admin123', role: 'admin', phone: '+91 98765 00001', active: true },
    { name: 'Sanmukh', email: 'sanmukh@agency.com', password: 'founder123', role: 'founder', phone: '+91 98765 43210', active: true },
    { name: 'Hina', email: 'hina@agency.com', password: 'bdm123', role: 'bdm_head', phone: '+91 98765 43211', active: true },
    { name: 'Pawan', email: 'pawan@agency.com', password: 'sales123', role: 'sales', phone: '+91 98765 43212', active: true }
  ];

  for (const user of defaultUsers) {
    const { data: existing } = await sb(
      `/rest/v1/users?email=eq.${encodeURIComponent(user.email)}&select=id`
    );
    if (!existing || existing.length === 0) {
      await sb('/rest/v1/users', 'POST', user);
    }
  }

  res.json({ success: true, message: 'Seed data added!' });
});

// ============================================
// START SERVER
// ============================================
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('\n⚠️  WARNING: Supabase not configured!');
  console.log('   Create .env file with SUPABASE_URL and SUPABASE_KEY\n');
}

app.listen(PORT, () => {
  console.log(`\n🚀 CRM Backend running on http://localhost:${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/api/health`);
  console.log(`📝 Make.com Webhook: POST http://localhost:${PORT}/webhook/make\n`);
});
