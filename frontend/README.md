# Beamreels Frontend

Static frontend for Netlify deployment.

## Setup for Netlify

1. Connect your GitHub repository to Netlify
2. Set the base directory to `frontend`
3. Set build command: (leave empty or use `echo "No build needed"`)
4. Set publish directory: `frontend`
5. Add environment variable:
   - `REACT_APP_API_URL` or `VITE_API_URL` = Your Railway backend URL

## Update API URLs

Before deploying, update `netlify.toml` and `_redirects` files with your Railway backend URL:
- Replace `https://your-railway-backend-url.railway.app` with your actual Railway URL

## File Structure

```
frontend/
├── index.html          # Landing page
├── creator.html        # Creator page
├── css/                # Stylesheets
├── js/                 # JavaScript files
├── images/             # Image assets
├── logos/              # Social media logos
├── netlify.toml        # Netlify configuration
└── _redirects          # Netlify redirects (fallback)
```

