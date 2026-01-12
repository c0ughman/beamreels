# Deployment Guide

This guide explains how to deploy the frontend to Netlify and backend to Railway.

## Frontend (Netlify)

### Step 1: Connect Repository
1. Go to [Netlify](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub repository
4. Select the repository: `c0ughman/beamreels`

### Step 2: Configure Build Settings
- **Base directory**: `frontend`
- **Build command**: (leave empty or use `echo "No build needed"`)
- **Publish directory**: `frontend`

### Step 3: Environment Variables
Add these in Netlify dashboard under Site settings → Environment variables:
- `API_BASE_URL` = Your Railway backend URL (e.g., `https://your-app.railway.app`)

### Step 4: Update Redirects
Before deploying, update `frontend/netlify.toml` and `frontend/_redirects`:
- Replace `https://your-railway-backend-url.railway.app` with your actual Railway URL

### Step 5: Deploy
Click "Deploy site" - Netlify will automatically deploy on every push to main branch.

## Backend (Railway)

### Step 1: Connect Repository
1. Go to [Railway](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository: `c0ughman/beamreels`
4. Select "Configure" and set:
   - **Root Directory**: `backend`

### Step 2: Environment Variables
Add these in Railway dashboard under Variables:
- `SECRET_KEY` - Generate a Django secret key
- `GEMINI_API_KEY` - Your Gemini API key
- `OPENAI_API_KEY` - Your OpenAI API key (optional, for AI video generation)
- `DEBUG` - Set to `False` for production

Railway automatically provides:
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port

### Step 3: Database Setup
1. Railway will automatically provision a PostgreSQL database
2. Run migrations: In Railway dashboard, go to your service → "Deployments" → "View Logs"
3. Or add a one-time command: `python manage.py migrate`

### Step 4: Static Files
Static files will be served by WhiteNoise middleware automatically.

### Step 5: Deploy
Railway will automatically deploy on every push to main branch.

## Post-Deployment

### Update Frontend API URLs
After Railway deployment, update your Netlify site:
1. Get your Railway URL (e.g., `https://beamreels-production.railway.app`)
2. Update `frontend/netlify.toml`:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://your-actual-railway-url.railway.app/api/:splat"
   ```
3. Update `frontend/_redirects`:
   ```
   /api/* https://your-actual-railway-url.railway.app/api/:splat 200
   ```
4. Redeploy on Netlify (or push changes to trigger auto-deploy)

### CORS Configuration (if needed)
If you encounter CORS errors, add to `backend/requirements.txt`:
```
django-cors-headers==4.3.1
```

And update `backend/beamreels/settings.py`:
```python
INSTALLED_APPS = [
    # ... existing apps ...
    'corsheaders',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # Add this first
    # ... existing middleware ...
]

CORS_ALLOWED_ORIGINS = [
    "https://your-netlify-site.netlify.app",
]

CORS_ALLOW_CREDENTIALS = True
```

## Troubleshooting

### Frontend Issues
- **404 errors**: Check that `netlify.toml` redirects are correct
- **API calls failing**: Verify `API_BASE_URL` environment variable is set
- **Static files not loading**: Check file paths in HTML files

### Backend Issues
- **Database errors**: Run migrations: `python manage.py migrate`
- **Static files not serving**: Check WhiteNoise middleware is enabled
- **CORS errors**: Add django-cors-headers and configure CORS settings

## Testing Locally

### Frontend
```bash
cd frontend
# Serve with any static file server
python3 -m http.server 8000
# Or use Netlify CLI
netlify dev
```

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 3000
```

