FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["/bin/sh", "-c", "gunicorn beamreels.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 300 --limit-request-line 0 --limit-request-field_size 0"]
