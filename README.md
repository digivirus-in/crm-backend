# CRM Backend - Complete Setup Guide

## Stack
- **Backend**: Node.js (Express) - Deployed on Railway
- **Database**: Supabase (PostgreSQL)
- **Lead Source**: Facebook/Meta Lead Ads via Make.com
- **Existing Flow**: Make.com → Google Sheets (Already Working - Don't Break!)

---

## Quick Start

### 1. Test Backend Locally
```bash
npm install
npm run dev
```

Test endpoints:
- Health: http://localhost:3000/api/health
- Seed Users: POST http://localhost:3000/api/seed

### 2. Default Login Credentials
| Name | Email | Password | Role |
|------|-------|----------|------|
| Rishabh Verma | rishabh@agency.com | admin123 | Admin |
| Sanmukh | sanmukh@agency.com | founder123 | Founder |
| Hina | hina@agency.com | bdm123 | BDM Head |
| Pawan | pawan@agency.com | sales123 | Sales |

---

## PART 1: Make.com Integration (WORKING SOLUTION)

### Current Flow
```
Facebook Lead Form
       ↓
Make.com Webhook
       ↓
Google Sheets (Existing - Don't Touch!)
       ↓
HTTP Request Module → CRM Backend → Supabase
```

### Make.com Setup

**Step 1: Open Your Existing Make.com Scenario**

**Step 2: Add "HTTP" Module After Facebook Trigger**
1. Click "+" after your Facebook module
2. Search for "HTTP"
3. Select "Make a request"

**Step 3: Configure HTTP Module**

| Setting | Value |
|---------|-------|
| **URL** | `https://your-railway-url.up.railway.app/webhook/make` |
| **Method** | POST |
| **Content Type** | application/json |

**Step 4: Body/Payload Configuration**

Map these fields from Facebook module:

```json
{
  "name": "{{fb.fiel_name_data.full_name}}",
  "mobile": "{{fb.fiel_name_data.phone_number}}",
  "email": "{{fb.fiel_name_data.email}}",
  "profession": "{{fb.fiel_name_data.job_title}}",
  "city": "{{fb.fiel_name_data.city}}",
  "campaign_name": "{{fb.ad_name}}",
  "ad_id": "{{fb.ad_id}}",
  "form_id": "{{fb.form_id}}"
}
```

**Step 5: Handle Response**
1. Add "Router" after HTTP module
2. Route 1: If `is_duplicate = true` → Do nothing (lead already exists)
3. Route 2: If `is_duplicate = false` → Success notification (optional)

### Alternative: Direct Field Mapping

If your Facebook form has custom field names:

```json
{
  "name": "Lead Full Name",
  "mobile": "Phone Number",
  "email": "Email Address",
  "profession": "Occupation",
  "campaign_name": "{{1.fiel_name_data.campaign_name}}"
}
```

### Test the Integration

**Option 1: Use Browser**
```
GET https://your-railway-url.up.railway.app/webhook/make/test
```

**Option 2: Use curl**
```bash
curl -X POST https://your-railway-url.up.railway.app/webhook/make \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test Lead",
    "mobile":"+91 98765 12345",
    "email":"test@example.com",
    "campaign_name":"Test Campaign"
  }'
```

Expected Response:
```json
{
  "success": true,
  "message": "Lead created successfully",
  "lead_id": "uuid-here",
  "is_duplicate": false
}
```

---

## PART 2: Railway Deployment

### Deploy Backend
1. Go to https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Select `crm-backend` repository
4. Add Environment Variables:

| Variable | Value |
|----------|-------|
| SUPABASE_URL | Your Supabase project URL |
| SUPABASE_KEY | Your Supabase anon key |
| META_ACCESS_TOKEN | (Optional) Your Meta token |
| META_VERIFY_TOKEN | crm_secret_token |
| PORT | 3000 |

5. Railway auto-deploys!

### Get Railway URL
After deployment, your URL will be:
```
https://crm-backend-xxxx.up.railway.app
```

### Webhook URL
```
https://crm-backend-xxxx.up.railway.app/webhook/make
```

---

## PART 3: Supabase Setup

### Run SQL Schema
1. Go to https://supabase.com
2. Open your project → SQL Editor
3. Run `supabase-setup.sql` file content

### Verify Tables Created
- users
- leads (with new columns: email, city, master_remark, is_contacted, first_contacted_by, called_count, call_duration_total)
- remarks
- statuses
- campaigns
- assignment_history

---

## PART 4: API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login with email/password |
| POST | /api/auth/register | Register new user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | Get all active users |
| GET | /api/users/:id | Get user by ID |
| PATCH | /api/users/:id | Update user |

### Leads
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/leads | Get all leads (with assigned user & remarks) |
| GET | /api/leads/:id | Get single lead with remarks |
| POST | /api/leads | Create new lead |
| PATCH | /api/leads/:id | Update lead fields |
| PATCH | /api/leads/:id/status | Update status only |
| PATCH | /api/leads/:id/assign | Assign to user |
| DELETE | /api/leads/:id | Delete lead |

### Remarks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/leads/:id/remarks | Get remarks for lead |
| POST | /api/remarks | Add remark (includes call_duration) |

### Campaigns
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/campaigns | Get all campaigns |
| POST | /api/campaigns | Create campaign |
| PATCH | /api/campaigns/:id | Update campaign |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /webhook/meta | Meta webhook verification |
| POST | /webhook/meta | Meta lead webhook (needs permissions) |
| POST | /webhook/make | Make.com webhook (WORKING!) |
| GET | /webhook/make/test | Test endpoint |

---

## PART 5: Meta App Review (Future)

### Required Permissions
- `pages_manage_metadata`
- `leads_retrieval`

### Submission Steps

1. **Go to Meta Developer Console**
   - https://developers.facebook.com/apps

2. **Select your app** → "App Review" in sidebar

3. **Request Permissions**
   - Search for each permission
   - Add explanation of why you need it

4. **Create Demo Video** (2-3 minutes)
   - Screen record:
     - Open Meta Business Suite
     - Show existing lead forms
     - Explain business use case
     - Show how leads flow to your CRM

5. **Submit for Review**

### Note
Meta review takes 1-7 days. Until approved, use Make.com integration (already working!).

---

## PART 6: Architecture for Scale

### Current Working Flow (Recommended)
```
Facebook Lead Form
       ↓
Make.com (Orchestration)
   ├── Google Sheets (Backup/Archive)
   ├── CRM Backend (Railway) → Supabase
   └── Notifications (Optional)
```

### Why Keep Make.com?
- ✅ Already working in production
- ✅ Google Sheets backup is valuable
- ✅ No need to wait for Meta review
- ✅ Easy to modify/debug
- ✅ Can add parallel flows easily

### Future Optimization
When Meta App is approved:
```
Facebook Lead Form
   ├── Make.com → Google Sheets (Archive)
   └── Meta Webhook → CRM (Primary - No Make needed)
```

---

## Troubleshooting

### Make.com Webhook Not Working?
1. Check Railway logs: `railway logs`
2. Test with browser: `/webhook/make/test`
3. Verify SUPABASE_URL and SUPABASE_KEY in Railway

### Duplicate Leads?
- Deduplication is based on mobile number
- Re-submissions update existing lead (remark added)

### Mobile Number Format Issues?
- Backend automatically formats: `+91 XXXXX XXXXX`
- Accepts: `9876512345`, `+919876512345`, `91 98765 12345`

### Supabase Connection Error?
1. Check if SUPABASE_KEY is valid (starts with `eyJ...`)
2. Verify RLS policies are set correctly
3. Check if tables exist: Run `supabase-setup.sql` again

---

## Support
For issues, check Railway deployment logs first. Most errors appear there.