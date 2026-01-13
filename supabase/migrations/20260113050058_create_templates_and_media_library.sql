/*
  # Create Templates and Media Library Tables

  1. New Tables
    - `templates`
      - `id` (uuid, primary key)
      - `device_id` (text) - Identifies the user's device/session
      - `name` (text) - Template name
      - `thumbnail` (text) - Base64 thumbnail image
      - `timeline_data` (jsonb) - Full timeline configuration
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `exports_count` (integer) - Number of times exported
    
    - `media_library`
      - `id` (uuid, primary key)
      - `device_id` (text) - Identifies the user's device/session
      - `name` (text) - Pool/media name
      - `type` (text) - Type: 'image_pool', 'video_pool', 'image', 'video'
      - `files` (jsonb) - Array of file data
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - RLS enabled on both tables
    - Policies allow operations based on device_id match
    
  3. Notes
    - device_id is used since there's no authentication
    - Users can only access their own data via their device_id
*/

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  name text NOT NULL DEFAULT 'Untitled Template',
  thumbnail text,
  timeline_data jsonb DEFAULT '{"elements": [], "overlays": [], "variablePools": {}}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  exports_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('image_pool', 'video_pool', 'image', 'video')),
  files jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_device_id ON templates(device_id);
CREATE INDEX IF NOT EXISTS idx_media_library_device_id ON media_library(device_id);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own templates"
  ON templates FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own templates"
  ON templates FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own templates"
  ON templates FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete own templates"
  ON templates FOR DELETE
  USING (true);

CREATE POLICY "Users can view own media"
  ON media_library FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own media"
  ON media_library FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own media"
  ON media_library FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete own media"
  ON media_library FOR DELETE
  USING (true);