# Beamreels Backend

Django backend for Railway deployment.

## Setup for Railway

1. Connect your GitHub repository to Railway
2. Set the root directory to `backend`
3. Railway will automatically detect Python and install dependencies
4. Add environment variables in Railway dashboard:
   - `SECRET_KEY` - Django secret key
   - `GEMINI_API_KEY` - For video import feature
   - `OPENAI_API_KEY` - For AI video generation
   - `DATABASE_URL` - Railway will auto-provide this
   - `PORT` - Railway will auto-provide this

## Database

Railway will automatically provision a PostgreSQL database. The `dj-database-url` package will handle the connection.

## Static Files

WhiteNoise middleware is configured to serve static files in production.

## API Endpoints

- `POST /api/creator/export/` - Export video from timeline
- `POST /api/creator/import-video/` - Import video and generate timeline JSON

## CORS

If you need CORS support for frontend, add `django-cors-headers` to requirements.txt and configure it in settings.py.

