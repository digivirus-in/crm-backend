require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ========== SUPABASE CONFIG ==========
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'crm_secret_token';

// ========== HELPER FUNCTIONS ==========
async function supabaseRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' || method === 'PATCH' ? 'return=representation' : 'return=minimal'
    }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(`${SUPABASE_URL}${endpoint}`, options);
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CRM Backend is running!' });
});

// ========== AUTH ROUTES ==========
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { data, error } = await supabaseRequest(
    `/rest/v1/users?email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}&active=eq.true&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Database error' });
  }

  if (!data || data.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = data[0];
  delete user.password; // Remove password from response
  res.json(user);
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password required' });
  }

  // Check if email exists
  const { data: existing } = await supabaseRequest(
    `/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id`
  );

  if (existing && existing.length > 0) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const newUser = {
    name,
    email,
    password,
    phone: phone || '',
    role: role || 'sales',
    active: true
  };

  const { data, error } = await supabaseRequest('/rest/v1/users', 'POST', newUser);

  if (error) {
    return res.status(500).json({ error: 'Failed to create user' });
  }

  res.json(data);
});

// ========== USERS ROUTES ==========
app.get('/api/users', async (req, res) => {
  const { data, error } = await supabaseRequest(
    '/rest/v1/users?select=*&active=eq.true&order=name.asc'
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }

  // Remove passwords from response
  const safeUsers = (data || []).map(u => {
    delete u.password;
    return u;
  });

  res.json(safeUsers);
});

app.get('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseRequest(
    `/rest/v1/users?id=eq.${id}&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  delete data[0].password;
  res.json(data[0]);
});

app.patch('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabaseRequest(
    `/rest/v1/users?id=eq.${id}`,
    'PATCH',
    updates
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to update user' });
  }

  res.json({ success: true });
});

// ========== STATUSES ROUTES ==========
const DEFAULT_STATUSES = [
  { id: 'new', label: 'New', color: '#3B82F6', bg: '#EFF6FF', isHotPlus: false },
  { id: 'first_contacted', label: 'First Contacted', color: '#2563EB', bg: '#EFF6FF', isHotPlus: false },
  { id: 'follow_up', label: 'Follow-up', color: '#F59E0B', bg: '#FFFBEB', isHotPlus: false },
  { id: 'interested', label: 'Interested', color: '#10B981', bg: '#ECFDF5', isHotPlus: false },
  { id: 'qualified', label: 'Qualified', color: '#7C3AED', bg: '#F5F3FF', isHotPlus: false },
  { id: 'closed', label: 'Closed', color: '#059669', bg: '#ECFDF5', isHotPlus: false },
  { id: 'hot', label: 'HOT LEAD', color: '#EF4444', bg: '#FEF2F2', isHotPlus: false },
  { id: 'hot_plus', label: 'HOT+', color: '#DC2626', bg: '#FEE2E2', isHotPlus: true },
  { id: 'partner', label: 'Partner', color: '#10B981', bg: '#ECFDF5', isHotPlus: false },
  { id: 'not_interested', label: 'Not Interested', color: '#6B7280', bg: '#F9FAFB', isHotPlus: false },
];

app.get('/api/statuses', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/statuses?select=*&order=id.asc');

  if (error || !data || data.length === 0) {
    // Return default statuses if none exist
    return res.json(DEFAULT_STATUSES);
  }

  res.json(data);
});

app.post('/api/statuses', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/statuses', 'POST', req.body);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ========== LEADS ROUTES ==========
app.get('/api/leads', async (req, res) => {
  const { data, error } = await supabaseRequest(
    '/rest/v1/leads?select=*,assigned_user:users!assigned_to(name,role),remarks:remarks(*)&order=created_at.desc'
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch leads' });
  }

  res.json(data || []);
});

app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseRequest(
    `/rest/v1/leads?id=eq.${id}&select=*,assigned_user:users!assigned_to(name,role),remarks:remarks(*,creator:users!created_by(name))`
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch lead' });
  }

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  res.json(data[0]);
});

app.post('/api/leads', async (req, res) => {
  const {
    name, mobile, other_number, profession, source, campaign,
    status, assigned_to, next_follow_up, next_follow_up_time, adset
  } = req.body;

  const newLead = {
    name: name || '',
    mobile: mobile || '',
    other_number: other_number || '',
    profession: profession || '',
    source: source || 'Manual',
    campaign: campaign || '',
    adset: adset || '',
    status: status || 'new',
    assigned_to: assigned_to || null,
    assigned_by: assigned_to ? req.body.current_user_id : null,
    next_follow_up: next_follow_up || null,
    next_follow_up_time: next_follow_up_time || '',
    last_activity: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseRequest('/rest/v1/leads', 'POST', newLead);

  if (error) {
    console.error('Create lead error:', error);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  res.json(data);
});

app.patch('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {
    ...req.body,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseRequest(
    `/rest/v1/leads?id=eq.${id}`,
    'PATCH',
    updates
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  res.json({ success: true });
});

app.patch('/api/leads/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const { data, error } = await supabaseRequest(
    `/rest/v1/leads?id=eq.${id}`,
    'PATCH',
    {
      status,
      updated_at: new Date().toISOString(),
      last_activity: new Date().toISOString()
    }
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to update status' });
  }

  res.json({ success: true });
});

app.patch('/api/leads/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { assigned_to, current_user_id, note } = req.body;

  // Get current lead
  const { data: currentLead } = await supabaseRequest(`/rest/v1/leads?id=eq.${id}&select=assigned_to`);

  const oldAssignedTo = currentLead?.[0]?.assigned_to;

  const { data, error } = await supabaseRequest(
    `/rest/v1/leads?id=eq.${id}`,
    'PATCH',
    {
      assigned_to,
      assigned_by: current_user_id,
      updated_at: new Date().toISOString(),
      last_activity: new Date().toISOString()
    }
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to reassign lead' });
  }

  // Add to assignment history
  await supabaseRequest('/rest/v1/assignment_history', 'POST', {
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
  const { id } = req.params;
  const { error } = await supabaseRequest(`/rest/v1/leads?id=eq.${id}`, 'DELETE');

  if (error) {
    return res.status(500).json({ error: 'Failed to delete lead' });
  }

  res.json({ success: true });
});

// ========== REMARKS ROUTES ==========
app.get('/api/leads/:id/remarks', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseRequest(
    `/rest/v1/remarks?lead_id=eq.${id}&order=created_at.asc&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch remarks' });
  }

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

  const { data, error } = await supabaseRequest('/rest/v1/remarks', 'POST', newRemark);

  if (error) {
    return res.status(500).json({ error: 'Failed to add remark' });
  }

  // Update lead last_activity
  await supabaseRequest(`/rest/v1/leads?id=eq.${lead_id}`, 'PATCH', {
    last_activity: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  res.json(data);
});

// ========== ASSIGNMENT HISTORY ==========
app.get('/api/leads/:id/history', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseRequest(
    `/rest/v1/assignment_history?lead_id=eq.${id}&order=created_at.desc&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch history' });
  }

  res.json(data || []);
});

// ========== MAKE.COM WEBHOOK (Parallel Lead Flow) ==========
// Facebook Lead → Make.com → CRM Backend → Supabase
// This works WITHOUT Meta App Review permissions!

app.post('/webhook/make', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`\n========== MAKE.COM WEBHOOK RECEIVED ==========`);
    console.log(`Time: ${timestamp}`);

    // Handle both direct payload and nested formats
    let payload = req.body;

    // If payload is wrapped in another format, extract the actual data
    if (payload.body) {
      payload = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
    }

    console.log('Raw payload keys:', Object.keys(payload));

    // Extract lead data - Make.com sends field_data array
    const fieldData = payload.field_data || payload.data || [];

    // Parse all possible field names from Make.com/Meta format
    const leadData = {};

    for (const field of fieldData) {
      const values = field.values || [];
      const value = values[0] || field.value || '';
      const fieldName = (field.name || field.field_name || '').toLowerCase().replace(/\s+/g, '_');

      // Map common Meta/Make field names
      if (fieldName.includes('full_name') || fieldName.includes('first_name') || fieldName === 'name') {
        leadData.name = value;
      } else if (fieldName.includes('phone') || fieldName.includes('mobile') || fieldName.includes('telephone')) {
        leadData.mobile = value;
      } else if (fieldName.includes('email')) {
        leadData.email = value;
      } else if (fieldName.includes('profession') || fieldName.includes('job_title') || fieldName.includes('company')) {
        leadData.profession = value;
      } else if (fieldName.includes('city') || fieldName.includes('location')) {
        leadData.city = value;
      } else if (fieldName.includes('message') || fieldName.includes('note') || fieldName.includes('comment')) {
        leadData.note = value;
      }
    }

    // Alternative: Check for flat field structure (Make.com HTTP module)
    if (!leadData.name && req.body.name) leadData.name = req.body.name;
    if (!leadData.mobile && (req.body.mobile || req.body.phone || req.body.telephone)) {
      leadData.mobile = req.body.mobile || req.body.phone || req.body.telephone;
    }
    if (!leadData.email && req.body.email) leadData.email = req.body.email;
    if (!leadData.profession && req.body.profession) leadData.profession = req.body.profession;
    if (!leadData.city && req.body.city) leadData.city = req.body.city;

    // Extract Meta campaign info if available
    const adId = payload.ad_id || payload.adId || req.body.ad_id || req.body.adId || '';
    const adName = payload.ad_name || payload.adName || req.body.ad_name || req.body.adName || '';
    const campaignName = payload.campaign_name || payload.campaignName || req.body.campaign_name || req.body.campaignName || '';
    const formId = payload.form_id || payload.formId || req.body.form_id || '';

    // Extract source info
    const sourcePlatform = payload.platform || req.body.platform || 'make_com';
    const sourceDetails = {
      ad_id: adId,
      ad_name: adName,
      campaign: campaignName,
      form_id: formId,
      platform: sourcePlatform,
      make_com_webhook_id: payload.webhook_id || req.body.webhook_id || ''
    };

    // Validate required fields
    if (!leadData.mobile) {
      console.log('⚠️ Lead rejected: No mobile number');
      return res.status(400).json({
        success: false,
        error: 'Mobile number is required',
        received: { name: leadData.name, email: leadData.email }
      });
    }

    // Format mobile number
    const formattedMobile = formatPhoneNumber(leadData.mobile);
    const cleanMobile = formattedMobile.replace(/\s+/g, '').replace('+', '');

    console.log(`\n📋 Lead Data Parsed:`);
    console.log(`   Name: ${leadData.name || 'N/A'}`);
    console.log(`   Mobile: ${formattedMobile}`);
    console.log(`   Email: ${leadData.email || 'N/A'}`);
    console.log(`   Profession: ${leadData.profession || 'N/A'}`);
    console.log(`   Campaign: ${campaignName || 'N/A'}`);

    // ========== DEDUPLICATION CHECK ==========
    console.log(`\n🔍 Checking for duplicate...`);

    const { data: existingLeads } = await supabaseRequest(
      `/rest/v1/leads?mobile=eq.${encodeURIComponent(formattedMobile)}&order=created_at.desc&limit=1&select=id,name,status`
    );

    if (existingLeads && existingLeads.length > 0) {
      const existing = existingLeads[0];
      console.log(`⚠️ Duplicate found! Lead ID: ${existing.id}, Status: ${existing.status}`);

      // Update existing lead - add new remark about re-inquiry
      const duplicateRemark = {
        lead_id: existing.id,
        text: `🔄 Re-inquiry via Make.com (${timestamp})\nCampaign: ${campaignName || 'N/A'}\nSource: ${sourcePlatform}\nOriginal Name: ${leadData.name || 'N/A'}`,
        created_by: null,
        created_at: new Date().toISOString()
      };

      await supabaseRequest('/rest/v1/remarks', 'POST', duplicateRemark);

      // Update lead's last activity
      await supabaseRequest(`/rest/v1/leads?id=eq.${existing.id}`, 'PATCH', {
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      console.log(`✅ Duplicate handled - remark added to existing lead`);
      console.log(`==========================================\n`);

      return res.json({
        success: true,
        message: 'Duplicate lead updated',
        lead_id: existing.id,
        is_duplicate: true
      });
    }

    // ========== CREATE NEW LEAD ==========
    console.log(`\n✅ Creating new lead...`);

    const newLead = {
      name: leadData.name || 'New Lead',
      mobile: formattedMobile,
      other_number: leadData.other_mobile || '',
      email: leadData.email || '',
      profession: leadData.profession || '',
      city: leadData.city || '',
      source: campaignName ? 'Meta Ads' : (sourcePlatform === 'make_com' ? 'Make.com' : sourcePlatform),
      campaign: campaignName || adName || '',
      adset: adId || '',
      status: 'new',
      assigned_to: null,
      next_follow_up: null,
      next_follow_up_time: '',
      master_remark: leadData.note || '',
      last_activity: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: createdLead, error: createError } = await supabaseRequest('/rest/v1/leads', 'POST', newLead);

    if (createError) {
      console.error(`❌ Failed to create lead:`, createError);
      console.log(`==========================================\n`);
      return res.status(500).json({
        success: false,
        error: 'Failed to create lead',
        details: createError
      });
    }

    const leadId = createdLead?.[0]?.id;
    console.log(`✅ Lead created successfully! ID: ${leadId}`);

    // Add initial remark if note was provided
    if (leadData.note) {
      await supabaseRequest('/rest/v1/remarks', 'POST', {
        lead_id: leadId,
        text: `📝 Initial Note (${timestamp}):\n${leadData.note}`,
        created_by: null,
        created_at: new Date().toISOString()
      });
    }

    // Log to console
    console.log(`\n📊 Lead Summary:`);
    console.log(`   ID: ${leadId}`);
    console.log(`   Name: ${newLead.name}`);
    console.log(`   Mobile: ${newLead.mobile}`);
    console.log(`   Campaign: ${newLead.campaign}`);
    console.log(`   Source: ${newLead.source}`);
    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      message: 'Lead created successfully',
      lead_id: leadId,
      is_duplicate: false
    });

  } catch (err) {
    console.error(`\n❌ WEBHOOK ERROR:`, err);
    console.log(`==========================================\n`);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message
    });
  }
});

// ========== MAKE.COM WEBHOOK - TEST ENDPOINT ==========
app.post('/webhook/make/test', async (req, res) => {
  // Test endpoint with sample data
  const testPayload = {
    name: 'Test Lead from Make.com',
    mobile: '+91 98765 12345',
    email: 'test@example.com',
    profession: 'Business Owner',
    campaign_name: 'Summer Sale 2026',
    ad_id: 'test_ad_123'
  };

  // Forward to main webhook handler
  req.body = testPayload;
  return app._router.handle(req, res);
});

app.get('/webhook/make/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Make.com webhook test endpoint',
    expected_payload: {
      name: 'Full name from form',
      mobile: 'Phone number',
      email: 'Email (optional)',
      profession: 'Job title (optional)',
      campaign_name: 'Campaign name (optional)',
      ad_id: 'Ad ID (optional)'
    },
    example_curl: `curl -X POST https://your-railway-url.up.railway.app/webhook/make \\
  -H "Content-Type: application/json" \\
  -d '{"name":"John Doe","mobile":"+91 98765 12345","campaign_name":"Test Campaign"}'`
  });
});

// ========== META WEBHOOK (Lead Gen) ==========
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('Meta Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

app.post('/webhook/meta', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`\n========== META WEBHOOK RECEIVED ==========`);
    console.log(`Time: ${timestamp}`);

    const entry = req.body.entry || [];

    for (const e of entry) {
      const changes = e.changes || [];

      for (const change of changes) {
        if (change.field === 'leadgen') {
          const leadId = change.value.lead_id;
          const formId = change.value.form_id || '';
          const adId = change.value.ad_id || '';
          console.log(`📥 New Meta Lead - ID: ${leadId}, Form: ${formId}, Ad: ${adId}`);

          // Fetch lead details from Meta API
          const metaLead = await fetchMetaLead(leadId);

          if (!metaLead || metaLead.error) {
            console.error('❌ Failed to fetch Meta lead:', metaLead?.error);
            continue;
          }

          console.log(`📋 Meta Lead Data:`, {
            full_name: metaLead.full_name,
            phone_number: metaLead.phone_number,
            email: metaLead.email,
            city: metaLead.city
          });

          // Parse field data from Meta response
          const fieldData = metaLead.field_data || [];
          const parsedData = {};

          for (const field of fieldData) {
            const value = field.values?.[0] || field.value || '';
            const fieldName = field.name?.toLowerCase() || '';

            if (fieldName.includes('full_name') || fieldName === 'full_name') {
              parsedData.name = value;
            } else if (fieldName.includes('phone') || fieldName.includes('mobile')) {
              parsedData.mobile = value;
            } else if (fieldName.includes('email')) {
              parsedData.email = value;
            } else if (fieldName.includes('city') || fieldName.includes('location')) {
              parsedData.city = value;
            } else if (fieldName.includes('job') || fieldName.includes('profession')) {
              parsedData.profession = value;
            }
          }

          // Fallback to direct fields
          if (!parsedData.name && metaLead.full_name) parsedData.name = metaLead.full_name;
          if (!parsedData.mobile && metaLead.phone_number) parsedData.mobile = metaLead.phone_number;
          if (!parsedData.email && metaLead.email) parsedData.email = metaLead.email;

          const formattedMobile = formatPhoneNumber(parsedData.mobile);

          // ========== DEDUPLICATION CHECK ==========
          console.log(`🔍 Checking for duplicate mobile: ${formattedMobile}`);

          const { data: existingLeads } = await supabaseRequest(
            `/rest/v1/leads?mobile=eq.${encodeURIComponent(formattedMobile)}&order=created_at.desc&limit=1&select=id,name,status`
          );

          if (existingLeads && existingLeads.length > 0) {
            const existing = existingLeads[0];
            console.log(`⚠️ Duplicate found! Lead ID: ${existing.id}`);

            // Update existing lead
            await supabaseRequest(`/rest/v1/leads?id=eq.${existing.id}`, 'PATCH', {
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });

            console.log(`✅ Duplicate updated`);
            continue;
          }

          // ========== CREATE NEW LEAD ==========
          console.log(`✅ Creating new lead...`);

          const newLead = {
            name: parsedData.name || 'New Lead',
            mobile: formattedMobile,
            email: parsedData.email || '',
            city: parsedData.city || '',
            profession: parsedData.profession || '',
            source: 'Meta Ads',
            campaign: metaLead.ad_name || metaLead.campaign_name || 'Unknown',
            adset: adId || '',
            form_id: formId,
            status: 'new',
            assigned_to: null,
            last_activity: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { data: createdLead, error: createError } = await supabaseRequest('/rest/v1/leads', 'POST', newLead);

          if (createError) {
            console.error('❌ Failed to save Meta lead:', createError);
          } else {
            console.log(`✅ Meta lead saved: ${newLead.name} (ID: ${createdLead?.[0]?.id})`);
          }
        }
      }
    }

    console.log(`==========================================\n`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Meta Webhook Error:', err);
    res.status(500).send('Error');
  }
});

async function fetchMetaLead(leadId) {
  if (!META_ACCESS_TOKEN) {
    console.log('⚠️ No Meta Access Token configured');
    return null;
  }

  try {
    // Try v18.0 first, fallback to v15.0
    const versions = ['v18.0', 'v25.0', 'v20.0'];
    let lastError = null;

    for (const version of versions) {
      try {
        const url = `https://graph.facebook.com/${version}/${leadId}?access_token=${META_ACCESS_TOKEN}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.error) {
          console.log(`✅ Meta API v${version} successful`);
          return data;
        }
        lastError = data.error;
      } catch (e) {
        lastError = e;
      }
    }

    console.error('❌ All Meta API versions failed:', lastError);
    return null;
  } catch (err) {
    console.error('❌ Failed to fetch Meta lead:', err);
    return null;
  }
}

function formatPhoneNumber(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+91 ${cleaned.substring(2, 7)} ${cleaned.substring(7)}`;
  }
  if (cleaned.length === 10) {
    return `+91 ${cleaned.substring(0, 5)} ${cleaned.substring(5)}`;
  }
  return `+${cleaned}`;
}

// ========== CAMPAIGNS ==========
app.get('/api/campaigns', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/campaigns?select=*&order=created_at.desc');

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }

  res.json(data || []);
});

app.post('/api/campaigns', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/campaigns', 'POST', req.body);

  if (error) {
    return res.status(500).json({ error: 'Failed to create campaign' });
  }

  res.json(data);
});

app.patch('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseRequest(`/rest/v1/campaigns?id=eq.${id}`, 'PATCH', req.body);

  if (error) {
    return res.status(500).json({ error: 'Failed to update campaign' });
  }

  res.json({ success: true });
});

// ========== SEED DATA (Initialize default users) ==========
app.post('/api/seed', async (req, res) => {
  const defaultUsers = [
    { name: 'Rishabh Verma', email: 'rishabh@agency.com', password: 'admin123', role: 'admin', phone: '+91 98765 00001', active: true },
    { name: 'Sanmukh', email: 'sanmukh@agency.com', password: 'founder123', role: 'founder', phone: '+91 98765 43210', active: true },
    { name: 'Hina', email: 'hina@agency.com', password: 'bdm123', role: 'bdm_head', phone: '+91 98765 43211', active: true },
    { name: 'Pawan', email: 'pawan@agency.com', password: 'sales123', role: 'sales', phone: '+91 98765 43212', active: true },
  ];

  for (const user of defaultUsers) {
    const { data: existing } = await supabaseRequest(
      `/rest/v1/users?email=eq.${encodeURIComponent(user.email)}&select=id`
    );

    if (!existing || existing.length === 0) {
      await supabaseRequest('/rest/v1/users', 'POST', user);
    }
  }

  // Seed default statuses
  for (const status of DEFAULT_STATUSES) {
    const { data: existing } = await supabaseRequest(
      `/rest/v1/statuses?id=eq.${status.id}&select=id`
    );

    if (!existing || existing.length === 0) {
      await supabaseRequest('/rest/v1/statuses', 'POST', status);
    }
  }

  res.json({ success: true, message: 'Seed data added!' });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('\n⚠️  WARNING: Supabase not configured!');
  console.log('   Create .env file with:');
  console.log('   SUPABASE_URL=your_supabase_url');
  console.log('   SUPABASE_KEY=your_supabase_key\n');
}

app.listen(PORT, () => {
  console.log(`\n🚀 CRM Backend running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📝 Seed users: POST http://localhost:${PORT}/api/seed\n`);
});
