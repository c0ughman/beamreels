/*
  # Add user_id column for Clerk authentication

  1. Changes
    - Add `user_id` column to `templates` table for Clerk user authentication
    - Add `user_id` column to `media_library` table for Clerk user authentication
    - Add indexes on user_id columns for efficient queries
    - Keep existing `device_id` columns for backwards compatibility during transition

  2. Notes
    - user_id will store the Clerk user ID (format: user_xxxxx)
    - Both columns are nullable to support transition period
    - New data will use user_id, old data keeps device_id
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'templates' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE templates ADD COLUMN user_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'media_library' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE media_library ADD COLUMN user_id text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user_id_updated ON templates(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_library_user_id ON media_library(user_id);
CREATE INDEX IF NOT EXISTS idx_media_library_user_id_created ON media_library(user_id, created_at DESC);
