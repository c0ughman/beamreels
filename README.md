# Beamreels

A standalone video template creator application with separate frontend (Netlify) and backend (Railway) deployments.

## Project Structure

```
beamreels/
├── frontend/          # Static frontend for Netlify
│   ├── index.html     # Landing page
│   ├── creator.html   # Creator page
│   ├── css/           # Stylesheets
│   ├── js/            # JavaScript files
│   ├── images/        # Image assets
│   ├── logos/         # Social media logos
│   └── netlify.toml   # Netlify configuration
│
├── backend/           # Django backend for Railway
│   ├── beamreels/     # Django project settings
│   ├── core/          # Main application
│   ├── manage.py      # Django management
│   ├── requirements.txt
│   ├── Procfile       # Railway process file
│   └── railway.json   # Railway configuration
│
└── DEPLOYMENT.md      # Detailed deployment guide
```

## Quick Start

### Frontend (Netlify)
1. Connect GitHub repo to Netlify
2. Set base directory: `frontend`
3. Add environment variable: `API_BASE_URL` = Your Railway URL
4. Deploy!

### Backend (Railway)
1. Connect GitHub repo to Railway
2. Set root directory: `backend`
3. Add environment variables (see DEPLOYMENT.md)
4. Deploy!

## Features

- **Landing Page**: Marketing homepage
- **Creator Page**: Video template editor with timeline
- **Video Export**: Export videos from timeline using FFmpeg
- **Video Import**: Import videos and generate timeline JSON using Gemini AI

## Documentation

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

## License

MIT
