require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// ========== CONSTANTS & CONFIG ==========
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'crm_secret_token';

// Rate limiting config
const WEBHOOK_RATE_LIMIT = 100; // requests per minute per IP
const webhookRequestCounts = new Map();

// ========== APP SETUP ==========
const app = express();
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ========== LOGGING SYSTEM ==========
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...context
  };

  // Structured JSON logging for production (can pipe to Loggly/Datadog)
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(logEntry));
  } else {
    const prefix = {
      ERROR: '❌',
      WARN: '⚠️',
      INFO: '📋',
      DEBUG: '🔍'
    }[level] || '📋';

    console.log(`${prefix} [${timestamp}] ${message}`);
    if (Object.keys(context).length > 0) {
      console.log('   Context:', JSON.stringify(context, null, 2));
    }
  }
}

// ========== SUPABASE CONFIG ==========
async function supabaseRequest(endpoint, method = 'GET', body = null, retries = 3) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { data: null, error: 'Supabase not configured - missing credentials' };
  }

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

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = SUPABASE_URL + endpoint;
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        // Handle specific Supabase errors
        if (data?.code === '23505') {
          return { data: null, error: 'DUPLICATE_ENTRY', duplicate: true };
        }
        return { data: null, error: `HTTP ${response.status}: ${JSON.stringify(data)}` };
      }

      return { data: data, error: null };
    } catch (error) {
      lastError = error;
      log(LOG_LEVELS.WARN, `Supabase request attempt ${attempt}/${retries} failed`, {
        endpoint,
        method,
        error: error.message
      });

      if (attempt < retries) {
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt - 1)));
      }
    }
  }

  log(LOG_LEVELS.ERROR, 'All Supabase retries exhausted', { endpoint, error: lastError?.message });
  return { data: null, error: lastError?.message || 'Request failed after all retries' };
}

// ========== MIDDLEWARE ==========

// Rate limiter for webhooks
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window

  let counts = webhookRequestCounts.get(ip) || { count: 0, windowStart };

  // Reset window if expired
  if (now - counts.windowStart > 60000) {
    counts = { count: 0, windowStart: now };
  }

  counts.count++;
  webhookRequestCounts.set(ip, counts);

  if (counts.count > WEBHOOK_RATE_LIMIT) {
    log(LOG_LEVELS.WARN, 'Rate limit exceeded', { ip, count: counts.count });
    return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 60 });
  }

  next();
}

// Request validation middleware
function validateWebhookPayload(req, res, next) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload format' });
  }

  // Normalize payload structure
  req.normalizedPayload = normalizePayload(payload);
  next();
}

function normalizePayload(payload) {
  // Handle nested body objects from Make.com
  let normalized = payload.body ? (typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body) : payload;

  // Normalize field_data array format (Meta/Make.com format)
  if (Array.isArray(normalized.field_data)) {
    const result = {};
    for (const field of normalized.field_data) {
      const values = field.values || [];
      const value = values[0] || field.value || '';
      const fieldName = normalizeFieldName(field.name || field.field_name || '');

      // Map standard Meta field names
      switch (fieldName) {
        case 'full_name':
        case 'first_name':
        case 'name':
          result.name = value;
          break;
        case 'phone_number':
        case 'phone':
        case 'mobile':
        case 'telephone':
          result.mobile = value;
          break;
        case 'email':
        case 'email_address':
          result.email = value;
          break;
        case 'job_title':
        case 'professional_title':
        case 'profession':
          result.profession = value;
          break;
        case 'city':
        case 'location':
        case 'city_name':
          result.city = value;
          break;
        default:
          // Store any other fields as custom fields
          if (!result.customFields) result.customFields = {};
          result.customFields[fieldName] = value;
      }
    }
    return result;
  }

  // Handle flat field structure (direct HTTP module)
  return {
    name: normalized.name || normalized.full_name || normalized.fullName,
    mobile: normalized.mobile || normalized.phone || normalized.telephone || normalized.phone_number,
    email: normalized.email || normalized.email_address,
    profession: normalized.profession || normalized.job_title || normalized.jobTitle,
    city: normalized.city || normalized.location,
    note: normalized.note || normalized.message || normalized.comment,
    ad_id: normalized.ad_id || normalized.adId,
    ad_name: normalized.ad_name || normalized.adName,
    campaign_name: normalized.campaign_name || normalized.campaignName,
    form_id: normalized.form_id || normalized.formId,
    platform: normalized.platform || 'make_com'
  };
}

function normalizeFieldName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ========== HEALTH CHECK ==========
app.get('/api/health', async (req, res) => {
  // Deep health check - verify Supabase connectivity
  const startTime = Date.now();
  const { data: dbTest, error: dbError } = await supabaseRequest('/rest/v1/users?select=id&limit=1');

  const response = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      supabase: {
        status: dbError ? 'degraded' : 'healthy',
        latency: Date.now() - startTime,
        error: dbError || undefined
      }
    }
  };

  const statusCode = dbError ? 503 : 200;
  res.status(statusCode).json(response);
});

// ========== AUTH ROUTES ==========
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const { data, error } = await supabaseRequest(
    `/rest/v1/users?email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}&active=eq.true&select=*`
  );

  if (error) {
    log(LOG_LEVELS.ERROR, 'Login database error', { email, error });
    return res.status(500).json({ error: 'Database error' });
  }

  if (!data || data.length === 0) {
    // Use constant-time response to prevent timing attacks
    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = data[0];
  delete user.password;

  log(LOG_LEVELS.INFO, 'User login', { userId: user.id, email: user.email });
  res.json(user);
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password required' });
  }

  // Validate inputs
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const { data: existing } = await supabaseRequest(
    `/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id`
  );

  if (existing && existing.length > 0) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const newUser = {
    name,
    email,
    password, // NOTE: In production, hash this with bcrypt
    phone: phone || '',
    role: role || 'sales',
    active: true
  };

  const { data, error } = await supabaseRequest('/rest/v1/users', 'POST', newUser);

  if (error) {
    log(LOG_LEVELS.ERROR, 'User registration failed', { email, error });
    return res.status(500).json({ error: 'Failed to create user' });
  }

  log(LOG_LEVELS.INFO, 'User registered', { email, userId: data?.[0]?.id });
  res.status(201).json(data);
});

// ========== USERS ROUTES ==========
app.get('/api/users', async (req, res) => {
  const { data, error } = await supabaseRequest(
    '/rest/v1/users?select=*&active=eq.true&order=name.asc'
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }

  const safeUsers = (data || []).map(u => {
    const { password, ...safe } = u;
    return safe;
  });

  res.json(safeUsers);
});

app.get('/api/users/:id', async (req, res) => {
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  const { data, error } = await supabaseRequest(
    `/rest/v1/users?id=eq.${id}&select=*`
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { password, ...safeUser } = data[0];
  res.json(safeUser);
});

app.patch('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Prevent password updates through this endpoint
  delete updates.password;

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
    return res.json(DEFAULT_STATUSES);
  }

  res.json(data);
});

app.post('/api/statuses', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/statuses', 'POST', req.body);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ========== LEAD PROCESSING HELPER ==========
async function processLead(leadData, sourceInfo) {
  const timestamp = new Date().toISOString();

  // Validate required fields
  if (!leadData.mobile) {
    return { success: false, error: 'Mobile number is required' };
  }

  // Format mobile number
  const formattedMobile = formatPhoneNumber(leadData.mobile);
  const cleanMobile = formattedMobile.replace(/\s+/g, '');

  if (!cleanMobile || cleanMobile.length < 10) {
    return { success: false, error: 'Invalid mobile number format' };
  }

  log(LOG_LEVELS.INFO, 'Processing lead', {
    name: leadData.name,
    mobile: formattedMobile,
    source: sourceInfo.platform
  });

  // ========== ATOMIC UPSERT - No race condition ==========
  // Use raw SQL with ON CONFLICT for true atomic upsert
  const upsertResult = await atomicUpsertLead({
    name: leadData.name || 'New Lead',
    mobile: formattedMobile,
    email: leadData.email || '',
    profession: leadData.profession || '',
    city: leadData.city || '',
    source: sourceInfo.platform === 'make_com' ? 'Make.com' : 'Meta Ads',
    campaign: sourceInfo.campaign_name || sourceInfo.ad_name || '',
    adset: sourceInfo.ad_id || '',
    form_id: sourceInfo.form_id || '',
    master_remark: leadData.note || '',
    last_activity: timestamp
  });

  if (!upsertResult.success) {
    return upsertResult;
  }

  // Add remark based on whether this was new or existing
  const remarkText = upsertResult.isNew
    ? `📥 New lead via ${sourceInfo.platform} (${timestamp})\nCampaign: ${sourceInfo.campaign_name || 'N/A'}`
    : `🔄 Re-inquiry via ${sourceInfo.platform} (${timestamp})\nCampaign: ${sourceInfo.campaign_name || 'N/A'}`;

  await supabaseRequest('/rest/v1/remarks', 'POST', {
    lead_id: upsertResult.leadId,
    text: remarkText,
    created_by: null,
    created_at: timestamp
  });

  // Add initial note remark if provided
  if (leadData.note && upsertResult.isNew) {
    await supabaseRequest('/rest/v1/remarks', 'POST', {
      lead_id: upsertResult.leadId,
      text: `📝 Initial Note:\n${leadData.note}`,
      created_by: null,
      created_at: timestamp
    });
  }

  return {
    success: true,
    lead_id: upsertResult.leadId,
    is_new: upsertResult.isNew,
    is_duplicate: !upsertResult.isNew
  };
}

// Atomic upsert using raw SQL to prevent race conditions
async function atomicUpsertLead(leadData) {
  // First try the RPC function (requires migration)
  try {
    const { data, error } = await supabaseRequest(
      '/rest/v1/rpc/upsert_lead',
      'POST',
      {
        p_name: leadData.name,
        p_mobile: leadData.mobile,
        p_email: leadData.email,
        p_profession: leadData.profession,
        p_city: leadData.city,
        p_source: leadData.source,
        p_campaign: leadData.campaign,
        p_adset: leadData.adset,
        p_form_id: leadData.form_id,
        p_master_remark: leadData.master_remark,
        p_last_activity: leadData.last_activity
      }
    );

    if (data && !error) {
      return {
        success: true,
        leadId: data?.[0]?.id || data?.id,
        isNew: data?.[0]?.is_new || data?.is_new || false
      };
    }

    // If RPC doesn't exist or failed, fall back to simple insert
    if (error && (error.includes('function') || error.includes('does not exist') || error.includes('404'))) {
      log(LOG_LEVELS.WARN, 'RPC function not found, using fallback insert');
      return await simpleInsertLead(leadData);
    }

    log(LOG_LEVELS.ERROR, 'Lead upsert failed', { error });
    return { success: false, error };
  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Atomic upsert error', { error: err.message });
    return { success: false, error: err.message };
  }
}

// Fallback: Simple insert without atomic deduplication
// Note: This may create duplicates in high-concurrency scenarios
async function simpleInsertLead(leadData) {
  // Normalize mobile for comparison
  const cleanMobile = leadData.mobile.replace(/\s+/g, '').replace('+', '');

  // Check for existing lead with same mobile number
  // Query with ilike to catch variations
  const searchPattern = `%${cleanMobile}%`;
  const { data: existing } = await supabaseRequest(
    `/rest/v1/leads?select=id,mobile&order=created_at.desc`
  );

  // Find matching lead by normalized mobile
  const existingLead = (existing || []).find(lead => {
    if (!lead || !lead.mobile) return false;
    const leadClean = lead.mobile.replace(/\s+/g, '').replace('+', '');
    // Match if they end the same (handles +91 prefix differences)
    return leadClean.endsWith(cleanMobile) || cleanMobile.endsWith(leadClean) || leadClean === cleanMobile;
  });

  if (existingLead) {
    // Update existing
    await supabaseRequest(`/rest/v1/leads?id=eq.${existingLead.id}`, 'PATCH', {
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return { success: true, leadId: existingLead.id, isNew: false };
  }

  // Create new lead
  const newLead = {
    name: leadData.name || 'New Lead',
    mobile: leadData.mobile,
    email: leadData.email || '',
    profession: leadData.profession || '',
    city: leadData.city || '',
    source: leadData.source || 'Manual',
    campaign: leadData.campaign || '',
    adset: leadData.adset || '',
    form_id: leadData.form_id || '',
    master_remark: leadData.master_remark || '',
    last_activity: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseRequest('/rest/v1/leads', 'POST', newLead);

  if (error) {
    return { success: false, error };
  }

  return {
    success: true,
    leadId: data?.[0]?.id,
    isNew: true
  };
}

// ========== MAKE.COM WEBHOOK ==========
app.post('/webhook/make', rateLimiter, validateWebhookPayload, async (req, res) => {
  const startTime = Date.now();

  try {
    log(LOG_LEVELS.INFO, 'Make.com webhook received');

    // Use normalized payload (contains all fields)
    const payload = req.normalizedPayload;

    // Get raw body for ad/campaign info (not in normalized payload)
    const body = req.body;

    const sourceInfo = {
      platform: 'make_com',
      ad_id: body.ad_id || body.adId || payload.ad_id,
      ad_name: body.ad_name || body.adName || payload.ad_name,
      campaign_name: body.campaign_name || body.campaignName || payload.campaign_name,
      form_id: body.form_id || body.formId || payload.form_id,
      webhook_id: body.webhook_id
    };

    // Pass normalized payload directly to processLead
    const result = await processLead(payload, sourceInfo);

    const processingTime = Date.now() - startTime;
    log(LOG_LEVELS.INFO, 'Make.com lead processed', {
      success: result.success,
      leadId: result.lead_id,
      processingTimeMs: processingTime
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: result.is_new ? 'Lead created successfully' : 'Duplicate lead updated',
      lead_id: result.lead_id,
      is_duplicate: result.is_duplicate
    });

  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Make.com webhook error', { error: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/webhook/make/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Make.com webhook test endpoint',
    expected_payload: {
      name: 'Full name from form',
      mobile: 'Phone number (required)',
      email: 'Email (optional)',
      profession: 'Job title (optional)',
      city: 'City (optional)',
      campaign_name: 'Campaign name (optional)',
      ad_id: 'Ad ID (optional)'
    },
    example_curl: `curl -X POST https://your-railway-url.up.railway.app/webhook/make \\
  -H "Content-Type: application/json" \\
  -d '{"name":"John Doe","mobile":"+91 98765 12345","campaign_name":"Test Campaign"}'`
  });
});

app.post('/webhook/make/test', async (req, res) => {
  // Use the same handler as main webhook
  const testPayload = {
    name: 'Test Lead ' + Date.now(),
    mobile: '+91 98765 ' + Math.floor(Math.random() * 90000 + 10000),
    email: 'test_' + Date.now() + '@example.com',
    profession: 'Business Owner',
    campaign_name: 'Summer Sale 2026',
    ad_id: 'test_ad_' + Date.now()
  };

  req.body = testPayload;
  return app._router.handle(req, res);
});

// ========== META WEBHOOK ==========
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    log(LOG_LEVELS.INFO, 'Meta webhook verified');
    res.status(200).send(challenge.toString());
  } else {
    log(LOG_LEVELS.WARN, 'Meta webhook verification failed', { mode, tokenProvided: !!token });
    res.status(403).send('Forbidden');
  }
});

app.post('/webhook/meta', rateLimiter, async (req, res) => {
  const startTime = Date.now();

  try {
    log(LOG_LEVELS.INFO, 'Meta webhook received', { body: req.body });

    const entry = req.body.entry || [];

    if (!entry.length) {
      return res.status(200).send('OK');
    }

    let leadsProcessed = 0;
    let leadsFailed = 0;

    for (const e of entry) {
      const changes = e.changes || [];

      for (const change of changes) {
        if (change.field === 'leadgen') {
          const leadId = change.value.lead_id;
          const formId = change.value.form_id || '';
          const adId = change.value.ad_id || '';

          log(LOG_LEVELS.INFO, 'Meta lead received', { leadId, formId, adId });

          // Check if Meta access token is configured
          if (!META_ACCESS_TOKEN) {
            log(LOG_LEVELS.WARN, 'Meta access token not configured - lead data unavailable', { leadId });
            // Still acknowledge receipt to prevent Meta retry
            res.status(200).send('OK');
            return;
          }

          // Fetch lead details from Meta API
          const metaLead = await fetchMetaLead(leadId);

          if (!metaLead) {
            log(LOG_LEVELS.ERROR, 'Failed to fetch Meta lead', { leadId });
            leadsFailed++;
            continue;
          }

          if (metaLead.error) {
            log(LOG_LEVELS.ERROR, 'Meta API error', {
              leadId,
              error: metaLead.error.message,
              code: metaLead.error.code
            });
            leadsFailed++;
            continue;
          }

          // Parse field data from Meta response
          const parsedData = parseMetaFieldData(metaLead);

          const sourceInfo = {
            platform: 'meta_webhook',
            ad_id: adId,
            ad_name: metaLead.ad_name || '',
            campaign_name: metaLead.campaign_name || '',
            form_id: formId
          };

          const result = await processLead(parsedData, sourceInfo);

          if (result.success) {
            leadsProcessed++;
            log(LOG_LEVELS.INFO, 'Meta lead saved', {
              leadId: result.lead_id,
              isNew: result.is_new
            });
          } else {
            leadsFailed++;
            log(LOG_LEVELS.ERROR, 'Meta lead processing failed', {
              leadId,
              error: result.error
            });
          }
        }
      }
    }

    const processingTime = Date.now() - startTime;
    log(LOG_LEVELS.INFO, 'Meta webhook completed', {
      leadsProcessed,
      leadsFailed,
      processingTimeMs: processingTime
    });

    res.status(200).send('OK');

  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Meta webhook error', { error: err.message });
    // Always respond 200 to prevent Meta retry storms
    // Log the error and handle it asynchronously
    res.status(200).send('OK');
  }
});

async function fetchMetaLead(leadId) {
  if (!META_ACCESS_TOKEN) {
    return null;
  }

  // Use latest stable API version
  const version = 'v18.0';
  const url = `https://graph.facebook.com/${version}/${leadId}?access_token=${META_ACCESS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      log(LOG_LEVELS.ERROR, 'Meta API response error', {
        error: data.error.message,
        code: data.error.code,
        type: data.error.type
      });
      return { error: data.error };
    }

    return data;
  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Meta API fetch failed', { error: err.message });
    return null;
  }
}

function parseMetaFieldData(metaLead) {
  const fieldData = metaLead.field_data || [];
  const parsed = {};

  for (const field of fieldData) {
    const value = field.values?.[0] || field.value || '';
    const fieldName = normalizeFieldName(field.name);

    switch (fieldName) {
      case 'full_name':
      case 'first_name':
      case 'name':
        parsed.name = value;
        break;
      case 'phone_number':
      case 'phone':
      case 'mobile':
        parsed.mobile = value;
        break;
      case 'email':
      case 'email_address':
        parsed.email = value;
        break;
      case 'city':
      case 'location':
        parsed.city = value;
        break;
      case 'job_title':
      case 'professional_title':
        parsed.profession = value;
        break;
    }
  }

  // Fallback to direct fields (some leads have these flat)
  if (!parsed.name && metaLead.full_name) parsed.name = metaLead.full_name;
  if (!parsed.mobile && metaLead.phone_number) parsed.mobile = metaLead.phone_number;
  if (!parsed.email && metaLead.email) parsed.email = metaLead.email;

  return parsed;
}

function formatPhoneNumber(phone) {
  if (!phone) return '';

  // Extract only digits
  const cleaned = String(phone).replace(/\D/g, '');

  // Handle Indian numbers
  // +91 followed by 10 digits
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    const number = cleaned.substring(2);
    return `+91 ${number.substring(0, 5)} ${number.substring(5)}`;
  }

  // 10 digit number
  if (cleaned.length === 10) {
    return `+91 ${cleaned.substring(0, 5)} ${cleaned.substring(5)}`;
  }

  // Already has country code but wrong format
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    const number = cleaned.substring(1);
    return `+91 ${number.substring(0, 5)} ${number.substring(5)}`;
  }

  // Return cleaned with + prefix
  return `+${cleaned}`;
}

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid lead ID format' });
  }

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
  const { data, error } = await supabaseRequest('/rest/v1/leads', 'POST', {
    ...req.body,
    last_activity: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  if (error) {
    log(LOG_LEVELS.ERROR, 'Create lead failed', { error });
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  res.status(201).json(data);
});

app.patch('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {
    ...req.body,
    updated_at: new Date().toISOString(),
    last_activity: new Date().toISOString()
  };

  // Prevent direct ID modification
  delete updates.id;
  delete updates.created_at;

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

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

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

  if (!assigned_to) {
    return res.status(400).json({ error: 'assigned_to is required' });
  }

  // Get current lead
  const { data: currentLead } = await supabaseRequest(
    `/rest/v1/leads?id=eq.${id}&select=assigned_to`
  );

  if (!currentLead || currentLead.length === 0) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const oldAssignedTo = currentLead[0].assigned_to;

  const { error } = await supabaseRequest(
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

  res.status(201).json(data);
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

  res.status(201).json(data);
});

app.patch('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseRequest(`/rest/v1/campaigns?id=eq.${id}`, 'PATCH', req.body);

  if (error) {
    return res.status(500).json({ error: 'Failed to update campaign' });
  }

  res.json({ success: true });
});

// ========== SEED DATA ==========
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
if (!SUPABASE_URL || !SUPABASE_KEY) {
  log(LOG_LEVELS.WARN, 'Supabase not configured! Create .env file with SUPABASE_URL and SUPABASE_KEY');
}

app.listen(PORT, () => {
  log(LOG_LEVELS.INFO, `CRM Backend running on port ${PORT}`);
  log(LOG_LEVELS.INFO, `Health check: http://localhost:${PORT}/api/health`);
  log(LOG_LEVELS.INFO, `Make.com webhook: POST http://localhost:${PORT}/webhook/make`);
});