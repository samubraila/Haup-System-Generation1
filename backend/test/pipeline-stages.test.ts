import { describe, expect, it } from 'vitest';
import { hasAudioSource, plannedStages } from '../src/services/pipeline.js';
import { projectSettingsSchema, type ProjectRow, type VideoRow } from '../src/services/types.js';

function project(overrides: Partial<ReturnType<typeof projectSettingsSchema.parse>> = {}): ProjectRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    user_id: '11111111-2222-4333-8444-555555555556',
    name: 'Test',
    slug: 'test',
    description: '',
    language: 'de',
    style: 'Cinematic',
    default_duration_sec: 30,
    default_format: 'youtube_short',
    default_aspect: '9:16',
    platforms: ['youtube'],
    require_approval: true,
    settings: projectSettingsSchema.parse(overrides),
    archived_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function video(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: '11111111-2222-4333-8444-555555555557',
    project_id: '11111111-2222-4333-8444-555555555555',
    idea_id: null,
    script_id: null,
    title: 'Test',
    topic: '',
    description: '',
    language: 'de',
    style: 'Cinematic',
    format: 'youtube_short',
    aspect_ratio: '9:16',
    duration_sec: 30,
    status: 'DRAFT',
    progress: 0,
    require_approval: true,
    error: null,
    meta: {},
    source_media_id: null,
    audio_media_id: null,
    subtitle_media_id: null,
    final_media_id: null,
    thumbnail_media_id: null,
    generated_at: null,
    approved_at: null,
    approved_by: null,
    published_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('Pipeline-Schritte', () => {
  it('plant ohne Sprachausgabe keine Untertitel, weil dann keine Tonspur existiert', () => {
    const stages = plannedStages(project({ subtitlesEnabled: true, voiceEnabled: false }), video(), false);
    expect(stages).not.toContain('subtitle');
    expect(stages).toEqual(['script', 'video', 'ffmpeg']);
  });

  it('plant Untertitel, sobald eine Sprachausgabe erzeugt wird', () => {
    const stages = plannedStages(project({ subtitlesEnabled: true, voiceEnabled: true }), video(), false);
    expect(stages).toEqual(['script', 'video', 'voice', 'subtitle', 'ffmpeg']);
  });

  it('plant Untertitel, wenn bereits eine Tonspur hinterlegt ist', () => {
    const stages = plannedStages(
      project({ subtitlesEnabled: true, voiceEnabled: false }),
      video({ audio_media_id: 'audio-id' }),
      true,
    );
    expect(stages).toContain('subtitle');
  });

  it('laesst Untertitel weg, wenn sie im Projekt abgeschaltet sind', () => {
    const stages = plannedStages(project({ subtitlesEnabled: false, voiceEnabled: true }), video(), true);
    expect(stages).not.toContain('subtitle');
    expect(stages).toContain('voice');
  });

  it('ueberspringt den Skript-Schritt, wenn bereits ein Skript vorliegt', () => {
    const stages = plannedStages(project(), video(), true);
    expect(stages[0]).toBe('video');
  });

  it('endet immer mit dem Rendern', () => {
    for (const settings of [
      { voiceEnabled: false, subtitlesEnabled: false },
      { voiceEnabled: true, subtitlesEnabled: true },
      { voiceEnabled: true, subtitlesEnabled: false },
    ]) {
      expect(plannedStages(project(settings), video(), false).at(-1)).toBe('ffmpeg');
    }
  });

  it('erkennt eine vorhandene Tonquelle', () => {
    expect(hasAudioSource(project({ voiceEnabled: true }), video())).toBe(true);
    expect(hasAudioSource(project({ voiceEnabled: false }), video({ audio_media_id: 'x' }))).toBe(true);
    expect(hasAudioSource(project({ voiceEnabled: false }), video())).toBe(false);
  });
});
