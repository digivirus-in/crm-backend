# CRM Backend - Setup Guide (Hindi/English)

## Step 1: Supabase Database Setup

### 1.1 Create Supabase Account
1. Go to: https://supabase.com
2. Click "Start your project"
3. Sign up with GitHub (easiest)
4. Create new project:
   - Organization: Your agency name
   - Project name: `crm-backend`
   - Database region: Choose nearest to you
   - Password: SAVE THIS! (e.g., `CrmSecurePass123`)
5. Wait 2 minutes for project to create
6. COPY these from Settings > API:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJhbGciOiJIUzI1...` (long string)

### 1.2 Create Database Tables
1. In Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Copy ALL content from `supabase-setup.sql` file
4. Paste in the query editor
5. Click **RUN** (or press Ctrl+Enter)
6. You should see "Success" for each table created

### 1.3 Verify Tables Created
1. Go to **Table Editor** (left sidebar)
2. You should see these tables:
   - users
   - leads
   - remarks
   - statuses
   - campaigns
   - assignment_history

## Step 2: Configure Backend

### 2.1 Create .env file
1. Open the `crm-backend` folder
2. Create new file named `.env` (no extension!)
3. Add this content:

```
SUPABASE_URL=https://your-actual-project.supabase.co
SUPABASE_KEY=your-actual-anon-key-here
META_ACCESS_TOKEN=
META_VERIFY_TOKEN=crm_secret_token
PORT=3000
```

Replace the values with your actual Supabase URL and key!

### 2.2 Install Dependencies
1. Open terminal/command prompt in `crm-backend` folder
2. Run: `npm install`

### 2.3 Test Backend
1. Run: `npm run dev`
2. Open browser: http://localhost:3000/api/health
3. You should see: `{"status":"ok","message":"CRM Backend is running!"}`

### 2.4 Create Default Users
1. Open new terminal tab (keep backend running)
2. Run: `curl http://localhost:3000/api/seed`
3. You should see: `{"success":true,"message":"Seed data added!"}`

## Step 3: Deploy to Railway (FREE)

### 3.1 Deploy Backend
1. Go to: https://railway.app
2. Sign up with GitHub
3. Click "New Project" > "Deploy from GitHub repo"
4. Select your `crm-backend` repository
5. Add Environment Variables (from Railway dashboard):
   - SUPABASE_URL = your-supabase-url
   - SUPABASE_KEY = your-supabase-key
6. Railway will auto-deploy!

### 3.2 Get Backend URL
1. After deploy, Railway gives you a URL like:
   `https://crm-backend.up.railway.app`
2. This is your backend URL - save it!

## Step 4: Connect Frontend to Backend

After backend is deployed, I will update the frontend to connect to it.

---

## Default Login Credentials

| Name | Email | Password |
|------|-------|----------|
| Rishabh Verma | rishabh@agency.com | admin123 |
| Sanmukh | sanmukh@agency.com | founder123 |
| Hina | hina@agency.com | bdm123 |
| Pawan | pawan@agency.com | sales123 |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| POST | /api/auth/login | Login |
| POST | /api/auth/register | Register user |
| GET | /api/users | Get all users |
| GET | /api/leads | Get all leads |
| POST | /api/leads | Create new lead |
| PATCH | /api/leads/:id | Update lead |
| PATCH | /api/leads/:id/status | Update lead status |
| PATCH | /api/leads/:id/assign | Assign lead |
| DELETE | /api/leads/:id | Delete lead |
| GET | /api/leads/:id/remarks | Get lead remarks |
| POST | /api/remarks | Add remark |
| POST | /api/seed | Create default users |

---

## Meta/Facebook Lead Integration (Optional)

To auto-fetch leads from Facebook Ads:

1. Go to Meta Business Manager
2. Create a Lead Gen campaign
3. Set webhook URL to: `https://your-backend-url/webhook/meta`
4. Add verify token: `crm_secret_token`
5. Get your Meta Access Token and add to Railway environment variables

---

## Troubleshooting

### "Supabase not configured" warning
- Make sure .env file has correct SUPABASE_URL and SUPABASE_KEY
- Restart the server after creating .env

### Can't login
- Check Supabase table editor to see if users exist
- Try running `/api/seed` again

### Database errors
- Check if tables were created in Supabase SQL Editor
- Verify RLS policies were set

---

**Need help?** Just message me with what error you're seeing!