# Beamreels Frontend

Static frontend for Netlify deployment.

## Pages

- `index.html` - Landing page
- `dashboard.html` - Template management dashboard
- `creator.html` - Video template editor
- `exports.html` - View and download generated videos

## Netlify Deployment

### Step 1: Connect Repository

1. Go to https://netlify.com and sign in
2. Click "Add new site" > "Import an existing project"
3. Connect your GitHub repository
4. Configure build settings:
   - Base directory: `frontend`
   - Publish directory: `frontend`
   - Build command: (leave empty)

### Step 2: Configure Backend URL

Before your first deploy (or update after Railway deployment):

1. Edit `netlify.toml` in this folder
2. Find the API proxy sections and replace `your-railway-backend-url.railway.app` with your actual Railway backend URL
3. Commit and push the changes

Example:
```toml
[[redirects]]
  from = "/api/*"
  to = "https://beamreels-production.up.railway.app/api/:splat"
  status = 200
  force = true
```

### Step 3: Deploy

Netlify will automatically deploy when you push to your connected branch.

## File Structure

```
frontend/
├── index.html          # Landing page
├── dashboard.html      # Template management
├── creator.html        # Video editor
├── exports.html        # Generated videos
├── css/
│   ├── dashboard.css   # Dashboard styles (glassmorphism)
│   ├── creator.css     # Creator styles
│   └── exports.css     # Exports page styles
├── js/
│   ├── dashboard.js    # Dashboard logic (IndexedDB)
│   ├── creator.js      # Creator/editor logic
│   └── exports.js      # Exports page logic
├── images/             # Image assets
├── logos/              # Social media logos
├── netlify.toml        # Netlify configuration
└── _redirects          # Netlify redirects (fallback)
```

## Local Development

Simply open the HTML files in a browser. For API functionality, you'll need the backend running locally:

```bash
cd ../backend
python manage.py runserver
```

Then access the frontend at `http://localhost:8000/` or open files directly.
