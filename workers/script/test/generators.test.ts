import { describe, expect, it } from 'vitest';
import { buildTemplateScript, countWords, estimateDuration, extractKeywords } from '../src/generators.js';

const request = {
  title: 'Schwarze Loecher',
  topic: 'Astrophysik',
  description: 'Kurzvideo',
  language: 'de',
  style: 'Cinematic',
  durationSec: 30,
  format: 'youtube_short',
  guidance: '8k, detailed',
  sceneCount: 4,
};

describe('Vorlagen-Skript', () => {
  it('erzeugt die gewuenschte Anzahl Szenen', () => {
    expect(buildTemplateScript(request).scenes).toHaveLength(4);
  });

  it('begrenzt die Szenenanzahl nach oben und unten', () => {
    expect(buildTemplateScript({ ...request, sceneCount: 1 }).scenes).toHaveLength(2);
    expect(buildTemplateScript({ ...request, sceneCount: 50 }).scenes).toHaveLength(12);
  });

  it('verteilt die Laufzeit auf die Szenen', () => {
    const draft = buildTemplateScript(request);
    const total = draft.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
    expect(total).toBeGreaterThanOrEqual(24);
    expect(total).toBeLessThanOrEqual(40);
  });

  it('nimmt den Prompt-Zusatz in jeden Bild-Prompt auf', () => {
    for (const scene of buildTemplateScript(request).scenes) {
      expect(scene.prompt).toContain('8k, detailed');
      expect(scene.prompt).toContain('Astrophysik');
    }
  });

  it('kennzeichnet sich als Vorlage und nicht als KI-Text', () => {
    expect(buildTemplateScript(request).provider).toBe('template');
  });

  it('nummeriert die Szenen ab null', () => {
    const draft = buildTemplateScript(request);
    expect(draft.scenes.map((scene) => scene.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('Stichwoerter', () => {
  it('liefert Suchbegriffe fuer jede Szene', () => {
    for (const scene of buildTemplateScript(request).scenes) {
      expect(scene.keywords.length).toBeGreaterThan(0);
    }
  });

  it('laesst Fuellwoerter weg', () => {
    const keywords = extractKeywords('die Sterne und der Weltraum mit vielen Galaxien');
    expect(keywords).not.toContain('die');
    expect(keywords).not.toContain('und');
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('entfernt Doppelungen und begrenzt die Anzahl', () => {
    const keywords = extractKeywords('Sterne Sterne Sterne Planeten Galaxien Nebel', 3);
    expect(keywords).toHaveLength(3);
    expect(new Set(keywords.map((k) => k.toLowerCase())).size).toBe(3);
  });

  it('kommt mit Umlauten zurecht', () => {
    expect(extractKeywords('Größe Höhe Länge')).toContain('Größe');
  });
});

describe('Textkennzahlen', () => {
  it('zaehlt Woerter', () => {
    expect(countWords('Dies ist ein Test')).toBe(4);
    expect(countWords('   ')).toBe(0);
  });

  it('schaetzt die Sprechdauer je Sprache', () => {
    const text = Array.from({ length: 23 }, () => 'Wort').join(' ');
    expect(estimateDuration(text, 'de')).toBe(10);
    expect(estimateDuration(text, 'en')).toBeLessThan(10);
  });
});
