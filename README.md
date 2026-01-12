# Beamreels

A standalone video template creator application with landing page and creator interface.

## Features

- **Landing Page**: Marketing homepage for the application
- **Creator Page**: Video template editor with timeline-based editing
- **Video Export**: Export videos from timeline compositions using FFmpeg
- **Video Import**: Import videos and generate timeline JSON using Gemini AI

## Setup

### Prerequisites

- Python 3.8+
- FFmpeg installed on your system
- Gemini API key (for video import feature)
- OpenAI API key (for AI video generation, optional)

### Installation

1. Clone the repository:
```bash
cd beamreels
```

2. Create a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file in the root directory:
```env
SECRET_KEY=your-secret-key-here
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key  # Optional, for AI video generation
```

5. Run migrations:
```bash
python manage.py migrate
```

6. Collect static files:
```bash
python manage.py collectstatic --noinput
```

7. Run the development server:
```bash
python manage.py runserver 3000
```

The application will be available at `http://localhost:3000`

## Project Structure

```
beamreels/
├── beamreels/          # Django project settings
├── core/               # Main application
│   ├── templates/      # HTML templates
│   ├── video_export_service.py    # Video export logic
│   ├── gemini_multi_stage_analyzer.py  # Video analysis
│   ├── sora_service.py  # AI video generation
│   └── views.py        # View functions
├── static/             # Static files (CSS, JS, images)
├── media/              # User uploaded files
└── manage.py           # Django management script
```

## Pages

- `/` - Landing page
- `/creator/` - Video template creator

## API Endpoints

- `POST /api/creator/export/` - Export video from timeline
- `POST /api/creator/import-video/` - Import video and generate timeline JSON

## Requirements

- FFmpeg must be installed and available in your system PATH
- For video import: Gemini API key required
- For AI video generation: OpenAI API key required

## License

MIT

