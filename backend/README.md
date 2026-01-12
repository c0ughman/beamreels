# Beamreels Backend

Django backend for Railway deployment.

## Railway Deployment

### Prerequisites
- GitHub account with your code pushed
- Railway account (https://railway.app)
- Gemini API key (for video import)
- OpenAI API key (for AI video generation)

### Step 1: Create Railway Project

1. Go to https://railway.app and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your repository
5. Select your Beamreels repository

### Step 2: Configure Root Directory

1. After deployment starts, click on your service
2. Go to Settings tab
3. Under "Root Directory", enter: `backend`
4. Railway will redeploy with the correct directory

### Step 3: Add Environment Variables

Go to Variables tab and add:

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Django secret key (generate a random string) |
| `GEMINI_API_KEY` | Google AI API key for video analysis |
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `FRONTEND_URL` | Your Netlify frontend URL (e.g., https://beamreels.netlify.app) |
| `DEBUG` | Set to `False` for production |

Railway auto-provides: `PORT`, `RAILWAY_STATIC_URL`

### Step 4: Get Your Railway URL

1. After deployment completes, go to Settings tab
2. Under "Networking", click "Generate Domain"
3. Copy the generated URL (e.g., `https://beamreels-production.up.railway.app`)

## Netlify Frontend Setup

### Step 1: Deploy Frontend

1. Go to https://netlify.com and sign in
2. Click "Add new site" > "Import an existing project"
3. Connect your GitHub repo
4. Set build settings:
   - Base directory: `frontend`
   - Publish directory: `frontend`
   - Build command: (leave empty)

### Step 2: Update API Proxy

1. In your repo, edit `frontend/netlify.toml`
2. Replace `your-railway-backend-url.railway.app` with your actual Railway URL
3. Commit and push - Netlify will redeploy

### Step 3: Add FRONTEND_URL to Railway

1. Go back to Railway dashboard
2. Add environment variable:
   - `FRONTEND_URL` = your Netlify URL (e.g., `https://beamreels.netlify.app`)

## API Endpoints

- `POST /api/creator/export/` - Export video from timeline
- `POST /api/creator/import-video/` - Import video and generate timeline JSON

## Technical Details

- CORS is configured to accept requests from Netlify and Railway domains
- WhiteNoise serves static files in production
- FFmpeg is installed via nixpacks for video processing
- Gunicorn runs with 2 workers and 120s timeout for video processing
