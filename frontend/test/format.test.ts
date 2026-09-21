import { describe, expect, it } from 'vitest';
import {
  cn,
  formatBytes,
  formatDuration,
  formatNumber,
  JOB_STATUS,
  PLATFORM_META,
  POST_STATUS,
  toneClasses,
  VIDEO_STATUS,
} from '../src/lib/format';

describe('Zahlen', () => {
  it('formatiert kleine Werte mit Tausenderpunkt', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1.234');
  });

  it('kuerzt grosse Werte', () => {
    expect(formatNumber(12500)).toBe('12,5 Tsd');
    expect(formatNumber(2500000)).toBe('2,5 Mio');
  });

  it('behandelt fehlende Werte', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
  });
});

describe('Dateigroessen', () => {
  it('formatiert Byte-Werte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
  });
});

describe('Dauer', () => {
  it('formatiert Minuten und Sekunden', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('zeigt Platzhalter bei fehlendem Wert', () => {
    expect(formatDuration(null)).toBe('--:--');
  });
});

describe('Statusabbildung', () => {
  it('kennt jeden Videostatus', () => {
    for (const status of Object.keys(VIDEO_STATUS)) {
      expect(VIDEO_STATUS[status as keyof typeof VIDEO_STATUS].label.length).toBeGreaterThan(0);
    }
  });

  it('kennzeichnet laufende Zustaende als Fortschritt', () => {
    expect(VIDEO_STATUS.GENERATING.tone).toBe('progress');
    expect(JOB_STATUS.RUNNING.tone).toBe('progress');
    expect(POST_STATUS.processing.tone).toBe('progress');
  });

  it('kennzeichnet Wartezustaende als Warnung, nicht als Fehler', () => {
    expect(VIDEO_STATUS.WAITING_FOR_GPU.tone).toBe('warn');
    expect(JOB_STATUS.WAITING_FOR_GPU.tone).toBe('warn');
  });

  it('kennzeichnet Fehler als gefaehrlich', () => {
    expect(VIDEO_STATUS.FAILED.tone).toBe('danger');
    expect(POST_STATUS.failed.tone).toBe('danger');
  });

  it('liefert fuer jeden Ton Klassen', () => {
    for (const tone of ['idle', 'info', 'progress', 'success', 'warn', 'danger'] as const) {
      expect(toneClasses(tone).length).toBeGreaterThan(0);
    }
  });
});

describe('Plattformen', () => {
  it('kennt alle vier Plattformen mit Farbe und Kuerzel', () => {
    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook'] as const) {
      expect(PLATFORM_META[platform].label.length).toBeGreaterThan(0);
      expect(PLATFORM_META[platform].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(PLATFORM_META[platform].short).toHaveLength(2);
    }
  });
});

describe('Klassennamen', () => {
  it('fasst Klassen zusammen und loest Konflikte auf', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-ink', false && 'hidden', 'font-bold')).toBe('text-ink font-bold');
  });
});
