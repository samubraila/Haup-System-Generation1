import type { QueueName } from '@acf/worker-core';

export interface ServiceDefinition {
  key: string;
  container: string;
  label: string;
  queue: QueueName | null;
  profile: 'core' | 'ai' | 'gpu' | 'publish';
  optional: boolean;
  description: string;
}

export const SERVICES: ServiceDefinition[] = [
  {
    key: 'backend',
    container: 'content-backend',
    label: 'Backend',
    queue: null,
    profile: 'core',
    optional: false,
    description: 'Hauptsystem: API, Datenbank, Job-Orchestrierung',
  },
  {
    key: 'postgres',
    container: 'content-postgres',
    label: 'PostgreSQL',
    queue: null,
    profile: 'core',
    optional: false,
    description: 'Metadaten und Job-Verlauf',
  },
  {
    key: 'redis',
    container: 'content-redis',
    label: 'Redis',
    queue: null,
    profile: 'core',
    optional: false,
    description: 'Queue und Worker-Registrierung',
  },
  {
    key: 'n8n',
    container: 'content-n8n',
    label: 'n8n',
    queue: null,
    profile: 'core',
    optional: true,
    description: 'Automatisierungen',
  },
  {
    key: 'script-worker',
    container: 'content-script-worker',
    label: 'Script Worker',
    queue: 'script',
    profile: 'core',
    optional: false,
    description: 'Erzeugt Videoskripte und Szenen-Prompts',
  },
  {
    key: 'ffmpeg-worker',
    container: 'content-ffmpeg-worker',
    label: 'FFmpeg Worker',
    queue: 'ffmpeg',
    profile: 'core',
    optional: false,
    description: 'Schnitt, Skalierung, Ton, Untertitel-Einbrennen',
  },
  {
    key: 'video-worker',
    container: 'content-video-worker',
    label: 'Video Worker (GPU)',
    queue: 'video',
    profile: 'gpu',
    optional: false,
    description: 'Lokale Video-KI (LTX, Wan, ComfyUI)',
  },
  {
    key: 'subtitle-worker',
    container: 'content-subtitle-worker',
    label: 'Subtitle Worker',
    queue: 'subtitle',
    profile: 'ai',
    optional: true,
    description: 'Spracherkennung und SRT-Erzeugung',
  },
  {
    key: 'voice-worker',
    container: 'content-voice-worker',
    label: 'Voice Worker',
    queue: 'voice',
    profile: 'ai',
    optional: true,
    description: 'Sprachausgabe (TTS)',
  },
  {
    key: 'image-worker',
    container: 'content-image-worker',
    label: 'Image Worker',
    queue: 'image',
    profile: 'ai',
    optional: true,
    description: 'Bildgenerierung fuer Thumbnails und Startbilder',
  },
  {
    key: 'publisher-youtube',
    container: 'content-publisher-youtube',
    label: 'YouTube Publisher',
    queue: 'publish.youtube',
    profile: 'publish',
    optional: true,
    description: 'Upload ueber die YouTube Data API',
  },
  {
    key: 'publisher-tiktok',
    container: 'content-publisher-tiktok',
    label: 'TikTok Publisher',
    queue: 'publish.tiktok',
    profile: 'publish',
    optional: true,
    description: 'Upload ueber die TikTok Content Posting API',
  },
  {
    key: 'publisher-instagram',
    container: 'content-publisher-instagram',
    label: 'Instagram Publisher',
    queue: 'publish.instagram',
    profile: 'publish',
    optional: true,
    description: 'Upload ueber die Instagram Graph API',
  },
  {
    key: 'publisher-facebook',
    container: 'content-publisher-facebook',
    label: 'Facebook Publisher',
    queue: 'publish.facebook',
    profile: 'publish',
    optional: true,
    description: 'Upload ueber die Facebook Graph API',
  },
];

export function serviceForQueue(queue: string): ServiceDefinition | undefined {
  return SERVICES.find((service) => service.queue === queue);
}
