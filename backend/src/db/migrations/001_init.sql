-- =============================================================================
--  AI Content Factory - Basisschema
-- =============================================================================
--  Grundsatz: PostgreSQL speichert ausschliesslich Metadaten und Dateipfade.
--  Video-, Audio- und Bilddateien liegen im gemeinsamen Storage unter /data.
--
--  Statuswerte sind bewusst TEXT + CHECK statt ENUM: neue Plattformen und
--  Job-Typen lassen sich so per Migration ergaenzen, ohne ALTER TYPE und ohne
--  dass Worker-Container neu gebaut werden muessen.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- Benutzer ---------------------------------------------------------------

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT        NOT NULL,
  password_hash         TEXT        NOT NULL,
  name                  TEXT        NOT NULL DEFAULT '',
  role                  TEXT        NOT NULL DEFAULT 'editor'
                          CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Refresh-Token-Rotation: gespeichert wird nur der Hash.
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT        NOT NULL DEFAULT '',
  ip          TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- --- Projekte ---------------------------------------------------------------

CREATE TABLE projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  slug                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  language             TEXT        NOT NULL DEFAULT 'de'
                         CHECK (language IN ('de', 'en', 'es', 'fr', 'it')),
  style                TEXT        NOT NULL DEFAULT 'cinematic',
  default_duration_sec INTEGER     NOT NULL DEFAULT 30 CHECK (default_duration_sec > 0),
  default_format       TEXT        NOT NULL DEFAULT 'youtube_short',
  default_aspect       TEXT        NOT NULL DEFAULT '9:16'
                         CHECK (default_aspect IN ('9:16', '16:9', '1:1', '4:5')),
  platforms            TEXT[]      NOT NULL DEFAULT '{}',
  require_approval     BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Projektspezifische Vorgaben: Untertitel-Stil, Wasserzeichen, Prompt-Zusaetze.
  settings             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_user_slug_key ON projects (user_id, slug);
CREATE INDEX projects_user_idx ON projects (user_id) WHERE archived_at IS NULL;

-- --- Ideen ------------------------------------------------------------------

CREATE TABLE ideas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  topic       TEXT        NOT NULL DEFAULT '',
  description TEXT        NOT NULL DEFAULT '',
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  status      TEXT        NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'approved', 'used', 'rejected')),
  score       INTEGER     NOT NULL DEFAULT 0,
  source      TEXT        NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ideas_project_idx ON ideas (project_id, status);

-- --- Videos -----------------------------------------------------------------
-- Zentrale Entitaet. Der Status ist genau die Kette, die der Benutzer im
-- Frontend sieht -- unabhaengig davon, welcher Container gerade arbeitet.

CREATE TABLE videos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  idea_id          UUID        REFERENCES ideas (id) ON DELETE SET NULL,
  script_id        UUID,
  title            TEXT        NOT NULL,
  topic            TEXT        NOT NULL DEFAULT '',
  description      TEXT        NOT NULL DEFAULT '',
  language         TEXT        NOT NULL DEFAULT 'de',
  style            TEXT        NOT NULL DEFAULT 'cinematic',
  format           TEXT        NOT NULL DEFAULT 'youtube_short',
  aspect_ratio     TEXT        NOT NULL DEFAULT '9:16',
  duration_sec     INTEGER     NOT NULL DEFAULT 30,
  status           TEXT        NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN (
                       'DRAFT', 'QUEUED', 'WAITING_FOR_GPU', 'GENERATING', 'PROCESSING',
                       'GENERATED', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED',
                       'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED')),
  progress         INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  require_approval BOOLEAN     NOT NULL DEFAULT TRUE,
  error            TEXT,
  meta             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Verweise auf Dateien im Storage (media.id), NICHT auf die Dateien selbst.
  source_media_id    UUID,
  audio_media_id     UUID,
  subtitle_media_id  UUID,
  final_media_id     UUID,
  thumbnail_media_id UUID,
  generated_at     TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  approved_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX videos_project_idx  ON videos (project_id, created_at DESC);
CREATE INDEX videos_status_idx   ON videos (status);
CREATE INDEX videos_created_idx  ON videos (created_at DESC);

-- --- Skripte ----------------------------------------------------------------

CREATE TABLE scripts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  video_id              UUID        REFERENCES videos (id) ON DELETE CASCADE,
  idea_id               UUID        REFERENCES ideas (id) ON DELETE SET NULL,
  title                 TEXT        NOT NULL,
  hook                  TEXT        NOT NULL DEFAULT '',
  body                  TEXT        NOT NULL,
  -- Szenen mit Prompt + Sprechertext, Grundlage fuer Video- und Voice-Jobs.
  scenes                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  language              TEXT        NOT NULL DEFAULT 'de',
  word_count            INTEGER     NOT NULL DEFAULT 0,
  estimated_duration_sec INTEGER    NOT NULL DEFAULT 0,
  provider              TEXT        NOT NULL DEFAULT 'template',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scripts_project_idx ON scripts (project_id, created_at DESC);
CREATE INDEX scripts_video_idx   ON scripts (video_id);

ALTER TABLE videos
  ADD CONSTRAINT videos_script_fk FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE SET NULL;

-- --- Medien (Dateiregister) -------------------------------------------------

CREATE TABLE media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  video_id    UUID        REFERENCES videos (id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL
                CHECK (kind IN ('image', 'audio', 'video', 'subtitle', 'thumbnail', 'script', 'other')),
  -- Pfad relativ zu DATA_DIR, z.B. projects/<id>/final/video-1080x1920.mp4
  path        TEXT        NOT NULL,
  file_name   TEXT        NOT NULL,
  mime_type   TEXT        NOT NULL DEFAULT 'application/octet-stream',
  size_bytes  BIGINT      NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  width       INTEGER,
  height      INTEGER,
  checksum    TEXT,
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX media_path_key    ON media (path);
CREATE INDEX media_project_kind_idx   ON media (project_id, kind, created_at DESC);
CREATE INDEX media_video_idx          ON media (video_id);

ALTER TABLE videos
  ADD CONSTRAINT videos_source_media_fk    FOREIGN KEY (source_media_id)    REFERENCES media (id) ON DELETE SET NULL,
  ADD CONSTRAINT videos_audio_media_fk     FOREIGN KEY (audio_media_id)     REFERENCES media (id) ON DELETE SET NULL,
  ADD CONSTRAINT videos_subtitle_media_fk  FOREIGN KEY (subtitle_media_id)  REFERENCES media (id) ON DELETE SET NULL,
  ADD CONSTRAINT videos_final_media_fk     FOREIGN KEY (final_media_id)     REFERENCES media (id) ON DELETE SET NULL,
  ADD CONSTRAINT videos_thumbnail_media_fk FOREIGN KEY (thumbnail_media_id) REFERENCES media (id) ON DELETE SET NULL;

-- --- Job-Register -----------------------------------------------------------
-- Spiegelt die Redis-Queue in die Datenbank. Redis ist fluechtig, diese Tabelle
-- ist die dauerhafte Wahrheit fuer Verlauf, Wiederaufnahme und Statistik.

CREATE TABLE video_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id     UUID        REFERENCES videos (id) ON DELETE CASCADE,
  project_id   UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type         TEXT        NOT NULL
                 CHECK (type IN ('script', 'image', 'video', 'voice', 'subtitle', 'ffmpeg')),
  queue        TEXT        NOT NULL,
  queue_job_id TEXT,
  status       TEXT        NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'WAITING_FOR_GPU', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  provider     TEXT        NOT NULL DEFAULT '',
  priority     INTEGER     NOT NULL DEFAULT 0,
  progress     INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  max_attempts INTEGER     NOT NULL DEFAULT 3,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT,
  status_reason TEXT,
  worker_id    TEXT,
  eta_seconds  INTEGER,
  -- Position in der Pipeline, damit das Frontend "Schritt 3 von 5" anzeigen kann.
  step_index   INTEGER     NOT NULL DEFAULT 0,
  step_total   INTEGER     NOT NULL DEFAULT 1,
  -- Job, der erst nach Abschluss dieses Jobs eingereiht wird.
  next_job_id  UUID        REFERENCES video_jobs (id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX video_jobs_video_idx   ON video_jobs (video_id, created_at);
CREATE INDEX video_jobs_status_idx  ON video_jobs (status, created_at DESC);
CREATE INDEX video_jobs_queue_idx   ON video_jobs (queue, status);
CREATE UNIQUE INDEX video_jobs_queue_job_key ON video_jobs (queue_job_id) WHERE queue_job_id IS NOT NULL;

-- --- Social-Media-Konten ----------------------------------------------------
-- Tokens liegen ausschliesslich AES-256-GCM-verschluesselt hier. Sie verlassen
-- das Backend nur ueber die interne API an den zustaendigen Publisher-Worker.

CREATE TABLE social_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform           TEXT        NOT NULL
                       CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook')),
  account_name       TEXT        NOT NULL DEFAULT '',
  external_id        TEXT        NOT NULL DEFAULT '',
  avatar_url         TEXT,
  status             TEXT        NOT NULL DEFAULT 'disconnected'
                       CHECK (status IN ('connected', 'disconnected', 'error', 'expired')),
  scopes             TEXT[]      NOT NULL DEFAULT '{}',
  access_token_enc   TEXT,
  refresh_token_enc  TEXT,
  token_expires_at   TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ,
  last_checked_at    TIMESTAMPTZ,
  last_error         TEXT,
  requires_reconnect BOOLEAN     NOT NULL DEFAULT FALSE,
  meta               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_accounts_platform_external_key
  ON social_accounts (platform, external_id) WHERE external_id <> '';
CREATE INDEX social_accounts_user_idx ON social_accounts (user_id, platform);

-- Kurzlebige OAuth-Zustaende (CSRF-Schutz des Autorisierungsflusses).
CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  platform      TEXT        NOT NULL,
  user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_verifier TEXT,
  redirect_to   TEXT        NOT NULL DEFAULT '/social',
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at);

-- --- Veroeffentlichungen ----------------------------------------------------
-- Ein social_post je Video und Zielkonto. Plattformen sind vollstaendig
-- entkoppelt: ein Fehler bei TikTok beruehrt YouTube nicht.

CREATE TABLE social_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id          UUID        NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  project_id        UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  social_account_id UUID        REFERENCES social_accounts (id) ON DELETE SET NULL,
  platform          TEXT        NOT NULL,
  title             TEXT        NOT NULL DEFAULT '',
  description       TEXT        NOT NULL DEFAULT '',
  hashtags          TEXT[]      NOT NULL DEFAULT '{}',
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  privacy           TEXT        NOT NULL DEFAULT 'private'
                      CHECK (privacy IN ('public', 'unlisted', 'private')),
  status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'scheduled', 'queued', 'processing', 'published', 'failed', 'cancelled')),
  scheduled_at      TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  external_post_id  TEXT,
  external_url      TEXT,
  error             TEXT,
  requires_reconnect BOOLEAN    NOT NULL DEFAULT FALSE,
  -- Welche gerenderte Fassung hochgeladen wird (z.B. 1080x1920).
  media_id          UUID        REFERENCES media (id) ON DELETE SET NULL,
  meta              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX social_posts_video_idx     ON social_posts (video_id);
CREATE INDEX social_posts_schedule_idx  ON social_posts (status, scheduled_at);
CREATE INDEX social_posts_platform_idx  ON social_posts (platform, status);

CREATE TABLE publishing_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id UUID        NOT NULL REFERENCES social_posts (id) ON DELETE CASCADE,
  platform       TEXT        NOT NULL,
  queue          TEXT        NOT NULL,
  queue_job_id   TEXT,
  status         TEXT        NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempts       INTEGER     NOT NULL DEFAULT 0,
  max_attempts   INTEGER     NOT NULL DEFAULT 3,
  progress       INTEGER     NOT NULL DEFAULT 0,
  error          TEXT,
  worker_id      TEXT,
  scheduled_at   TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  result         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX publishing_jobs_post_idx   ON publishing_jobs (social_post_id);
CREATE INDEX publishing_jobs_status_idx ON publishing_jobs (status, scheduled_at);
CREATE UNIQUE INDEX publishing_jobs_queue_job_key ON publishing_jobs (queue_job_id) WHERE queue_job_id IS NOT NULL;

-- --- Analytics --------------------------------------------------------------
-- Zeitreihe: je Abruf eine Zeile, damit Verlaeufe darstellbar sind.

CREATE TABLE analytics (
  id               BIGSERIAL PRIMARY KEY,
  social_post_id   UUID        NOT NULL REFERENCES social_posts (id) ON DELETE CASCADE,
  platform         TEXT        NOT NULL,
  views            BIGINT      NOT NULL DEFAULT 0,
  likes            BIGINT      NOT NULL DEFAULT 0,
  comments         BIGINT      NOT NULL DEFAULT 0,
  shares           BIGINT      NOT NULL DEFAULT 0,
  followers_gained BIGINT      NOT NULL DEFAULT 0,
  watch_time_sec   BIGINT      NOT NULL DEFAULT 0,
  engagement_rate  NUMERIC(6,3) NOT NULL DEFAULT 0,
  raw              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_post_idx     ON analytics (social_post_id, collected_at DESC);
CREATE INDEX analytics_platform_idx ON analytics (platform, collected_at DESC);

-- --- Zeitplaene / Automatisierung -------------------------------------------

CREATE TABLE schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        REFERENCES projects (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  kind        TEXT        NOT NULL DEFAULT 'automation'
                CHECK (kind IN ('automation', 'publish', 'analytics')),
  cron        TEXT        NOT NULL,
  timezone    TEXT        NOT NULL DEFAULT 'Europe/Berlin',
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  action      TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX schedules_next_run_idx ON schedules (enabled, next_run_at);

-- --- Einstellungen ----------------------------------------------------------

CREATE TABLE settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      TEXT        NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'user')),
  user_id    UUID        REFERENCES users (id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX settings_global_key ON settings (key) WHERE scope = 'global';
CREATE UNIQUE INDEX settings_user_key   ON settings (user_id, key) WHERE scope = 'user';

-- --- Logs -------------------------------------------------------------------

CREATE TABLE logs (
  id         BIGSERIAL PRIMARY KEY,
  level      TEXT        NOT NULL DEFAULT 'info'
               CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source     TEXT        NOT NULL DEFAULT 'backend',
  message    TEXT        NOT NULL,
  context    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  user_id    UUID        REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX logs_created_idx ON logs (created_at DESC);
CREATE INDEX logs_level_idx   ON logs (level, created_at DESC);
CREATE INDEX logs_source_idx  ON logs (source, created_at DESC);

-- Getrennt von logs: fachliche Nachvollziehbarkeit, wird nicht rotiert.
CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID        REFERENCES users (id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  entity     TEXT        NOT NULL DEFAULT '',
  entity_id  TEXT        NOT NULL DEFAULT '',
  ip         TEXT        NOT NULL DEFAULT '',
  user_agent TEXT        NOT NULL DEFAULT '',
  meta       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_user_idx    ON audit_logs (user_id, created_at DESC);

-- --- updated_at automatisch pflegen -----------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'projects', 'ideas', 'videos', 'scripts', 'video_jobs',
    'social_accounts', 'social_posts', 'publishing_jobs', 'schedules'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t, t);
  END LOOP;
END $$;
