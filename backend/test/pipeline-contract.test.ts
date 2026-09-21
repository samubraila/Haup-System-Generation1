import { describe, expect, it } from 'vitest';
import {
  ffmpegJobSchema,
  publishJobSchema,
  RENDER_PRESETS,
  resolutionFor,
  scriptJobSchema,
  subtitleStyleSchema,
  videoJobSchema,
} from '@acf/worker-core';
import { parseProjectSettings, projectSettingsSchema } from '../src/services/types.js';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('Auftragsvertraege zwischen Backend und Workern', () => {
  it('akzeptiert einen vollstaendigen Skript-Auftrag', () => {
    const result = scriptJobSchema.safeParse({
      projectId: UUID,
      videoId: UUID,
      title: 'Titel',
      topic: 'Thema',
      language: 'de',
      durationSec: 30,
      format: 'youtube_short',
    });
    expect(result.success).toBe(true);
  });

  it('lehnt einen Skript-Auftrag ohne Titel ab', () => {
    const result = scriptJobSchema.safeParse({
      projectId: UUID,
      videoId: UUID,
      title: '',
      topic: 'Thema',
      language: 'de',
      durationSec: 30,
      format: 'youtube_short',
    });
    expect(result.success).toBe(false);
  });

  it('setzt Standardwerte fuer den Video-Auftrag', () => {
    const parsed = videoJobSchema.parse({ projectId: UUID, videoId: UUID, prompt: 'Weltall' });
    expect(parsed.provider).toBe('placeholder');
    expect(parsed.fps).toBe(24);
    expect(parsed.sceneIndex).toBe(0);
    expect(parsed.seed).toBeNull();
  });

  it('verlangt mindestens eine Quelldatei und ein Ziel beim Rendern', () => {
    expect(ffmpegJobSchema.safeParse({ projectId: UUID, videoId: UUID, sourcePaths: [], targets: [] }).success).toBe(
      false,
    );

    const parsed = ffmpegJobSchema.parse({
      projectId: UUID,
      videoId: UUID,
      sourcePaths: ['projects/a/videos/scene-00.mp4'],
      targets: [RENDER_PRESETS.tiktok],
    });
    expect(parsed.burnSubtitles).toBe(true);
    expect(parsed.targets[0]?.width).toBe(1080);
  });

  it('erzwingt eine bekannte Plattform beim Veroeffentlichen', () => {
    const base = {
      postId: UUID,
      projectId: UUID,
      videoId: UUID,
      accountId: UUID,
      filePath: 'projects/a/final/video.mp4',
      title: 'Titel',
    };
    expect(publishJobSchema.safeParse({ ...base, platform: 'youtube' }).success).toBe(true);
    expect(publishJobSchema.safeParse({ ...base, platform: 'snapchat' }).success).toBe(false);
  });

  it('setzt private Sichtbarkeit als Standard', () => {
    const parsed = publishJobSchema.parse({
      postId: UUID,
      projectId: UUID,
      videoId: UUID,
      accountId: UUID,
      platform: 'tiktok',
      filePath: 'projects/a/final/video.mp4',
      title: 'Titel',
    });
    expect(parsed.privacy).toBe('private');
  });

  it('liefert passende Aufloesungen zum Seitenverhaeltnis', () => {
    expect(resolutionFor('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(resolutionFor('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(resolutionFor('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(resolutionFor('4:5')).toEqual({ width: 1080, height: 1350 });
  });

  it('haelt die Rendervorgaben innerhalb der Plattformgrenzen', () => {
    expect(RENDER_PRESETS.youtube_short?.maxDurationSec).toBe(60);
    expect(RENDER_PRESETS.instagram_reel?.maxDurationSec).toBe(90);
    expect(RENDER_PRESETS.youtube?.height).toBe(1080);
  });
});

describe('Projekteinstellungen', () => {
  it('faellt bei ungueltigen Werten auf die Standardeinstellungen zurueck', () => {
    const settings = parseProjectSettings({ videoProvider: 'unbekannt', sceneCount: 'viele' });
    expect(settings.videoProvider).toBe('placeholder');
    expect(settings.sceneCount).toBe(4);
  });

  it('behaelt gueltige Werte bei', () => {
    const settings = parseProjectSettings({ videoProvider: 'ltx', sceneCount: 8, voiceEnabled: true });
    expect(settings.videoProvider).toBe('ltx');
    expect(settings.sceneCount).toBe(8);
    expect(settings.voiceEnabled).toBe(true);
  });

  it('verlangt Freigabe und private Sichtbarkeit als Standard', () => {
    const settings = projectSettingsSchema.parse({});
    expect(settings.defaultPrivacy).toBe('private');
    expect(settings.subtitlesEnabled).toBe(true);
    expect(settings.voiceEnabled).toBe(false);
  });

  it('liefert lesbare Untertitel-Standardwerte', () => {
    const style = subtitleStyleSchema.parse({});
    expect(style.position).toBe('bottom');
    expect(style.maxCharsPerLine).toBeGreaterThan(20);
    expect(style.primaryColor).toBe('#FFFFFF');
  });
});
