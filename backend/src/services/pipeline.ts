import {
  QUEUES,
  RENDER_PRESETS,
  resolutionFor,
  type AspectRatio,
  type Language,
  type QueueName,
  type RenderTarget,
} from '@acf/worker-core';
import { config } from '../config/index.js';
import { query, queryMany, queryOne } from '../db/pool.js';
import { jobQueue, redis } from '../queue/index.js';
import { events } from '../utils/events.js';
import { ownerOfVideo } from './ownership.js';
import { writeLog } from './log-store.js';
import { parseProjectSettings, type MediaRow, type ProjectRow, type VideoJobRow, type VideoRow } from './types.js';

export type StageName = 'script' | 'image' | 'video' | 'voice' | 'subtitle' | 'ffmpeg';

const STAGE_QUEUE: Record<StageName, QueueName> = {
  script: QUEUES.SCRIPT,
  image: QUEUES.IMAGE,
  video: QUEUES.VIDEO,
  voice: QUEUES.VOICE,
  subtitle: QUEUES.SUBTITLE,
  ffmpeg: QUEUES.FFMPEG,
};

const STAGE_LABEL: Record<StageName, string> = {
  script: 'Skript',
  image: 'Bilder',
  video: 'KI-Video',
  voice: 'Sprachausgabe',
  subtitle: 'Untertitel',
  ffmpeg: 'Rendern',
};

interface ScriptScene {
  index: number;
  prompt: string;
  narration: string;
  durationSec: number;
}

interface ScriptRow {
  id: string;
  body: string;
  scenes: ScriptScene[];
  language: string;
}

export async function loadVideo(videoId: string): Promise<VideoRow | null> {
  return queryOne<VideoRow>('SELECT * FROM videos WHERE id = $1', [videoId]);
}

export async function loadProject(projectId: string): Promise<ProjectRow | null> {
  return queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
}

async function loadScript(scriptId: string | null): Promise<ScriptRow | null> {
  if (!scriptId) return null;
  return queryOne<ScriptRow>('SELECT id, body, scenes, language FROM scripts WHERE id = $1', [scriptId]);
}

async function sceneMedia(videoId: string): Promise<MediaRow[]> {
  return queryMany<MediaRow>(
    `SELECT * FROM media
     WHERE video_id = $1 AND kind = 'video' AND meta->>'stage' = 'ai'
     ORDER BY (meta->>'sceneIndex')::int NULLS LAST, created_at`,
    [videoId],
  );
}

export function hasAudioSource(project: ProjectRow, video: VideoRow): boolean {
  const settings = parseProjectSettings(project.settings);
  return settings.voiceEnabled || Boolean(video.audio_media_id);
}

export function plannedStages(project: ProjectRow, video: VideoRow, hasScript: boolean): StageName[] {
  const settings = parseProjectSettings(project.settings);
  const stages: StageName[] = [];
  if (!hasScript) stages.push('script');
  stages.push('video');
  if (settings.voiceEnabled) stages.push('voice');
  if (settings.subtitlesEnabled && hasAudioSource(project, video)) stages.push('subtitle');
  stages.push('ffmpeg');
  return stages;
}

export function stageLabel(stage: StageName): string {
  return STAGE_LABEL[stage];
}

async function stageJobs(videoId: string, stage: StageName): Promise<VideoJobRow[]> {
  return queryMany<VideoJobRow>(
    `SELECT * FROM video_jobs WHERE video_id = $1 AND type = $2 ORDER BY step_index, created_at`,
    [videoId, stage],
  );
}

function anyFailed(jobs: VideoJobRow[]): boolean {
  return jobs.some((job) => job.status === 'FAILED');
}

function anyPending(jobs: VideoJobRow[]): boolean {
  return jobs.some((job) => job.status === 'PENDING' || job.status === 'RUNNING' || job.status === 'WAITING_FOR_GPU');
}

export async function nextStage(video: VideoRow, project: ProjectRow): Promise<StageName | null> {
  const settings = parseProjectSettings(project.settings);

  if (!video.script_id) return 'script';

  const script = await loadScript(video.script_id);
  const expectedScenes = Math.max(1, script?.scenes?.length ?? 1);
  const scenes = await sceneMedia(video.id);
  if (scenes.length < expectedScenes) return 'video';

  if (settings.voiceEnabled && !video.audio_media_id) return 'voice';
  if (settings.subtitlesEnabled && video.audio_media_id && !video.subtitle_media_id) return 'subtitle';
  if (!video.final_media_id) return 'ffmpeg';
  return null;
}

async function insertJob(params: {
  videoId: string;
  projectId: string;
  type: StageName;
  queue: QueueName;
  payload: Record<string, unknown>;
  provider: string;
  priority: number;
  stepIndex: number;
  stepTotal: number;
}): Promise<VideoJobRow> {
  const row = await queryOne<VideoJobRow>(
    `INSERT INTO video_jobs
       (video_id, project_id, type, queue, payload, provider, priority, step_index, step_total, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.videoId,
      params.projectId,
      params.type,
      params.queue,
      JSON.stringify(params.payload),
      params.provider,
      params.priority,
      params.stepIndex,
      params.stepTotal,
      config.JOB_MAX_ATTEMPTS,
    ],
  );
  if (!row) throw new Error('Job konnte nicht angelegt werden');

  const queued = await jobQueue.enqueue({
    queue: params.queue,
    name: params.type,
    data: params.payload,
    refId: row.id,
    priority: params.priority,
    maxAttempts: config.JOB_MAX_ATTEMPTS,
  });

  await query('UPDATE video_jobs SET queue_job_id = $1 WHERE id = $2', [queued.id, row.id]);
  row.queue_job_id = queued.id;

  events.publish(
    {
      type: 'job.updated',
      jobId: row.id,
      videoId: params.videoId,
      status: 'PENDING',
      progress: 0,
      queue: params.queue,
    },
    await ownerOfVideo(params.videoId),
  );

  return row;
}

function renderTargetsFor(video: VideoRow, project: ProjectRow): RenderTarget[] {
  const platforms = project.platforms.length > 0 ? project.platforms : ['youtube'];
  const keys = new Set<string>();

  for (const platform of platforms) {
    switch (platform) {
      case 'youtube':
        keys.add(video.format === 'youtube_video' ? 'youtube' : 'youtube_short');
        break;
      case 'tiktok':
        keys.add('tiktok');
        break;
      case 'instagram':
        keys.add('instagram_reel');
        break;
      case 'facebook':
        keys.add('facebook_reel');
        break;
      default:
        break;
    }
  }

  if (keys.size === 0) keys.add('youtube_short');

  const targets: RenderTarget[] = [];
  for (const key of keys) {
    const preset = RENDER_PRESETS[key];
    if (preset) targets.push(preset);
  }
  return targets;
}

export async function enqueueStage(video: VideoRow, project: ProjectRow, stage: StageName): Promise<VideoJobRow[]> {
  const settings = parseProjectSettings(project.settings);
  const stages = plannedStages(project, video, Boolean(video.script_id));
  const stepTotal = Math.max(stages.length, 1);
  const stepIndex = Math.max(0, stages.indexOf(stage));
  const queue = STAGE_QUEUE[stage];
  const { width, height } = resolutionFor(video.aspect_ratio as AspectRatio);

  const existing = await stageJobs(video.id, stage);
  if (anyPending(existing)) return existing;

  switch (stage) {
    case 'script': {
      const job = await insertJob({
        videoId: video.id,
        projectId: project.id,
        type: 'script',
        queue,
        provider: settings.scriptProvider,
        priority: 5,
        stepIndex,
        stepTotal,
        payload: {
          projectId: project.id,
          videoId: video.id,
          title: video.title,
          topic: video.topic || video.title,
          description: video.description,
          language: video.language as Language,
          style: video.style,
          durationSec: video.duration_sec,
          format: video.format,
          guidance: settings.promptSuffix,
          provider: settings.scriptProvider,
          ollamaUrl: settings.ollamaUrl,
          ollamaModel: settings.ollamaModel,
          sceneCount: settings.sceneCount,
        },
      });
      return [job];
    }

    case 'video': {
      const script = await loadScript(video.script_id);
      const scenes: ScriptScene[] =
        script?.scenes?.length
          ? script.scenes
          : [{ index: 0, prompt: `${video.topic || video.title}, ${video.style}`, narration: '', durationSec: video.duration_sec }];

      const done = new Set((await sceneMedia(video.id)).map((m) => Number(m.meta.sceneIndex ?? -1)));
      const jobs: VideoJobRow[] = [];

      for (const scene of scenes) {
        if (done.has(scene.index)) continue;
        jobs.push(
          await insertJob({
            videoId: video.id,
            projectId: project.id,
            type: 'video',
            queue,
            provider: settings.videoProvider,
            priority: 5,
            stepIndex,
            stepTotal,
            payload: {
              projectId: project.id,
              videoId: video.id,
              prompt: [scene.prompt, settings.promptSuffix].filter(Boolean).join(', '),
              negativePrompt: settings.negativePrompt,
              provider: settings.videoProvider,
              width,
              height,
              fps: 24,
              durationSec: Math.max(2, Math.min(15, scene.durationSec || 5)),
              seed: null,
              steps: 30,
              guidanceScale: 3.5,
              initImagePath: null,
              sceneIndex: scene.index,
              sceneCount: scenes.length,
            },
          }),
        );
      }
      return jobs;
    }

    case 'voice': {
      const script = await loadScript(video.script_id);
      const narration =
        script?.scenes?.map((scene) => scene.narration).filter(Boolean).join('\n') || script?.body || video.description;
      if (!narration.trim()) return [];

      const job = await insertJob({
        videoId: video.id,
        projectId: project.id,
        type: 'voice',
        queue,
        provider: 'piper',
        priority: 4,
        stepIndex,
        stepTotal,
        payload: {
          projectId: project.id,
          videoId: video.id,
          text: narration,
          language: video.language as Language,
          voice: settings.voiceName,
          speed: settings.voiceSpeed,
        },
      });
      return [job];
    }

    case 'subtitle': {
      const audio = video.audio_media_id
        ? await queryOne<MediaRow>('SELECT * FROM media WHERE id = $1', [video.audio_media_id])
        : null;
      const sourcePath = audio?.path;
      if (!sourcePath) {
        await writeLog(
          'info',
          'pipeline',
          'Untertitel uebersprungen: das Video hat keine Tonspur',
          { videoId: video.id, hint: 'Sprachausgabe im Projekt aktivieren oder eine Audiodatei hinterlegen' },
        );
        return [];
      }

      const script = await loadScript(video.script_id);
      const job = await insertJob({
        videoId: video.id,
        projectId: project.id,
        type: 'subtitle',
        queue,
        provider: 'whisper',
        priority: 4,
        stepIndex,
        stepTotal,
        payload: {
          projectId: project.id,
          videoId: video.id,
          sourcePath,
          language: video.language as Language,
          transcriptHint: script?.body?.slice(0, 2000) ?? '',
          style: settings.subtitleStyle,
        },
      });
      return [job];
    }

    case 'ffmpeg': {
      const scenes = await sceneMedia(video.id);
      if (scenes.length === 0) return [];

      const audio = video.audio_media_id
        ? await queryOne<MediaRow>('SELECT path FROM media WHERE id = $1', [video.audio_media_id])
        : null;
      const subtitle = video.subtitle_media_id
        ? await queryOne<MediaRow>('SELECT path FROM media WHERE id = $1', [video.subtitle_media_id])
        : null;

      const job = await insertJob({
        videoId: video.id,
        projectId: project.id,
        type: 'ffmpeg',
        queue,
        provider: 'ffmpeg',
        priority: 6,
        stepIndex,
        stepTotal,
        payload: {
          projectId: project.id,
          videoId: video.id,
          sourcePaths: scenes.map((scene) => scene.path),
          audioPath: audio?.path ?? null,
          musicPath: settings.musicPath,
          musicVolume: settings.musicVolume,
          subtitlePath: subtitle?.path ?? null,
          subtitleStyle: settings.subtitleStyle,
          burnSubtitles: settings.burnSubtitles && Boolean(subtitle),
          watermarkPath: settings.watermarkPath,
          watermarkPosition: settings.watermarkPosition,
          watermarkOpacity: settings.watermarkOpacity,
          targets: renderTargetsFor(video, project),
          generateThumbnail: true,
          thumbnailAtSec: 1,
        },
      });
      return [job];
    }

    default:
      return [];
  }
}

export async function setVideoStatus(
  videoId: string,
  status: VideoRow['status'],
  extra: { progress?: number; error?: string | null } = {},
): Promise<void> {
  const fields: string[] = ['status = $2'];
  const params: Array<string | number | null> = [videoId, status];
  let index = 3;

  if (extra.progress !== undefined) {
    fields.push(`progress = $${index++}`);
    params.push(Math.max(0, Math.min(100, Math.round(extra.progress))));
  }
  if (extra.error !== undefined) {
    fields.push(`error = $${index++}`);
    params.push(extra.error);
  }
  if (status === 'GENERATED') fields.push('generated_at = now()');
  if (status === 'PUBLISHED') fields.push('published_at = now()');

  await query(`UPDATE videos SET ${fields.join(', ')} WHERE id = $1`, params);

  const row = await queryOne<{ progress: number }>('SELECT progress FROM videos WHERE id = $1', [videoId]);
  events.publish(
    { type: 'video.updated', videoId, status, progress: row?.progress ?? 0 },
    await ownerOfVideo(videoId),
  );
}

export async function recomputeVideoProgress(videoId: string): Promise<number> {
  const jobs = await queryMany<VideoJobRow>('SELECT * FROM video_jobs WHERE video_id = $1', [videoId]);
  if (jobs.length === 0) return 0;
  const total = jobs.reduce((sum, job) => sum + (job.status === 'COMPLETED' ? 100 : job.progress), 0);
  const stepTotal = Math.max(jobs[0]?.step_total ?? 1, 1);
  const done = new Set(jobs.filter((j) => j.status === 'COMPLETED').map((j) => j.type)).size;
  const stageProgress = (done / stepTotal) * 100;
  const jobProgress = total / jobs.length;
  return Math.round(Math.min(99, Math.max(stageProgress, jobProgress * 0.9)));
}

export async function startPipeline(videoId: string): Promise<void> {
  const video = await loadVideo(videoId);
  if (!video) throw new Error(`Video ${videoId} existiert nicht`);
  const project = await loadProject(video.project_id);
  if (!project) throw new Error(`Projekt ${video.project_id} existiert nicht`);

  const stage = await nextStage(video, project);
  if (!stage) {
    await finishPipeline(video, project);
    return;
  }

  await setVideoStatus(videoId, 'QUEUED', { error: null, progress: 0 });
  const jobs = await enqueueStage(video, project, stage);
  await writeLog('info', 'pipeline', `Pipeline gestartet: ${stageLabel(stage)}`, {
    videoId,
    stage,
    jobs: jobs.length,
  });
}

const ADVANCE_LOCK_TTL_SEC = 30;
const ADVANCE_LOCK_WAIT_MS = 5000;

async function withAdvanceLock(videoId: string, fn: () => Promise<void>): Promise<void> {
  const key = `${'acf'}:lock:pipeline:${videoId}`;
  const token = `${process.pid}-${videoId}`;
  const deadline = Date.now() + ADVANCE_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const acquired = await redis.set(key, token, 'EX', ADVANCE_LOCK_TTL_SEC, 'NX');
    if (acquired) {
      try {
        await fn();
      } finally {
        const current = await redis.get(key).catch(() => null);
        if (current === token) await redis.del(key).catch(() => undefined);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await writeLog('warn', 'pipeline', 'Pipeline-Schritt uebersprungen, ein anderer Lauf war schneller', { videoId });
}

export async function advancePipeline(videoId: string): Promise<void> {
  await withAdvanceLock(videoId, () => advancePipelineLocked(videoId));
}

async function advancePipelineLocked(videoId: string): Promise<void> {
  const video = await loadVideo(videoId);
  if (!video) return;
  if (video.status === 'FAILED' || video.status === 'ARCHIVED') return;

  const project = await loadProject(video.project_id);
  if (!project) return;

  const jobs = await queryMany<VideoJobRow>('SELECT * FROM video_jobs WHERE video_id = $1', [videoId]);
  if (anyPending(jobs)) {
    const progress = await recomputeVideoProgress(videoId);
    const running = jobs.find((job) => job.status === 'RUNNING' || job.status === 'WAITING_FOR_GPU');
    const status =
      running?.status === 'WAITING_FOR_GPU'
        ? 'WAITING_FOR_GPU'
        : running?.type === 'ffmpeg'
          ? 'PROCESSING'
          : 'GENERATING';
    await setVideoStatus(videoId, status, { progress });
    return;
  }

  if (anyFailed(jobs)) {
    const failed = jobs.find((job) => job.status === 'FAILED');
    await setVideoStatus(videoId, 'FAILED', { error: failed?.error ?? 'Ein Arbeitsschritt ist fehlgeschlagen' });
    return;
  }

  const stage = await nextStage(video, project);
  if (!stage) {
    await finishPipeline(video, project);
    return;
  }

  const created = await enqueueStage(video, project, stage);
  if (created.length === 0) {
    const afterSkip = await nextStage(video, project);
    if (!afterSkip || afterSkip === stage) {
      await finishPipeline(video, project);
      return;
    }
    await enqueueStage(video, project, afterSkip);
  }

  const progress = await recomputeVideoProgress(videoId);
  await setVideoStatus(videoId, stage === 'ffmpeg' ? 'PROCESSING' : 'GENERATING', { progress });
}

async function finishPipeline(video: VideoRow, project: ProjectRow): Promise<void> {
  const current = (await loadVideo(video.id)) ?? video;

  if (!current.final_media_id) {
    const reason =
      'Die Pipeline hat keine fertige Videodatei erzeugt. Pruefe die Jobs des letzten Schritts im Bereich Warteschlange.';
    await setVideoStatus(current.id, 'FAILED', { error: reason });
    await writeLog('error', 'pipeline', `Pipeline ohne Ergebnis beendet: ${current.title}`, {
      videoId: current.id,
    });
    return;
  }

  const requiresApproval = current.require_approval || project.require_approval;
  const status = requiresApproval ? 'REVIEW_REQUIRED' : 'APPROVED';

  await query(
    `UPDATE videos SET status = $2, progress = 100, generated_at = COALESCE(generated_at, now()), error = NULL
     WHERE id = $1`,
    [current.id, status],
  );

  events.publish(
    { type: 'video.updated', videoId: current.id, status, progress: 100 },
    await ownerOfVideo(current.id),
  );
  await writeLog('info', 'pipeline', `Video fertiggestellt: ${current.title}`, {
    videoId: current.id,
    status,
    requiresApproval,
  });

  if (!requiresApproval) {
    const { schedulePendingPosts } = await import('./publisher.js');
    await schedulePendingPosts(current.id);
  }
}

export async function retryJob(jobId: string): Promise<VideoJobRow | null> {
  const job = await queryOne<VideoJobRow>('SELECT * FROM video_jobs WHERE id = $1', [jobId]);
  if (!job) return null;

  const queued = await jobQueue.enqueue({
    queue: job.queue as QueueName,
    name: job.type,
    data: job.payload,
    refId: job.id,
    priority: job.priority,
    maxAttempts: job.max_attempts,
  });

  await query(
    `UPDATE video_jobs
     SET status = 'PENDING', error = NULL, status_reason = NULL, progress = 0, attempts = 0,
         queue_job_id = $2, started_at = NULL, finished_at = NULL
     WHERE id = $1`,
    [jobId, queued.id],
  );

  if (job.video_id) await setVideoStatus(job.video_id, 'QUEUED', { error: null });
  return { ...job, queue_job_id: queued.id, status: 'PENDING' };
}

export async function cancelJob(jobId: string): Promise<void> {
  const job = await queryOne<VideoJobRow>('SELECT * FROM video_jobs WHERE id = $1', [jobId]);
  if (!job) return;
  if (job.queue_job_id) await jobQueue.cancel(job.queue as QueueName, job.queue_job_id);
  await query(
    `UPDATE video_jobs SET status = 'CANCELLED', finished_at = now() WHERE id = $1 AND status NOT IN ('COMPLETED')`,
    [jobId],
  );
}

export async function cancelVideoJobs(videoId: string): Promise<void> {
  const jobs = await queryMany<VideoJobRow>(
    `SELECT * FROM video_jobs WHERE video_id = $1 AND status IN ('PENDING','RUNNING','WAITING_FOR_GPU')`,
    [videoId],
  );
  for (const job of jobs) await cancelJob(job.id);
}
