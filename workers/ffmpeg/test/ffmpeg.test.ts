import { describe, expect, it } from 'vitest';
import { buildForceStyle, escapeFilterPath, hexToAssColor, overlayPosition } from '../src/ffmpeg.js';

describe('Untertitel-Stil', () => {
  it('wandelt Hex-Farben ins ASS-Format um', () => {
    expect(hexToAssColor('#FFFFFF')).toBe('&H00FFFFFF');
    expect(hexToAssColor('#000000')).toBe('&H00000000');
    expect(hexToAssColor('#FF0000')).toBe('&H000000FF');
    expect(hexToAssColor('#0000FF')).toBe('&H00FF0000');
  });

  it('akzeptiert Kurzschreibweise und fehlende Raute', () => {
    expect(hexToAssColor('fff')).toBe('&H00FFFFFF');
    expect(hexToAssColor('00FF00')).toBe('&H0000FF00');
  });

  it('setzt die Ausrichtung passend zur Position', () => {
    const base = {
      font: 'DejaVu Sans',
      fontSize: 48,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      backgroundColor: null,
      marginVertical: 120,
      bold: true,
      uppercase: false,
      animation: 'none' as const,
      maxCharsPerLine: 38,
    };

    expect(buildForceStyle({ ...base, position: 'bottom' }, 1)).toContain('Alignment=2');
    expect(buildForceStyle({ ...base, position: 'center' }, 1)).toContain('Alignment=5');
    expect(buildForceStyle({ ...base, position: 'top' }, 1)).toContain('Alignment=8');
  });

  it('skaliert Schriftgroesse und Rand mit der Aufloesung', () => {
    const style = {
      font: 'DejaVu Sans',
      fontSize: 48,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      backgroundColor: null,
      position: 'bottom' as const,
      marginVertical: 120,
      bold: true,
      uppercase: false,
      animation: 'none' as const,
      maxCharsPerLine: 38,
    };

    expect(buildForceStyle(style, 1)).toContain('FontSize=48');
    expect(buildForceStyle(style, 0.5)).toContain('FontSize=24');
    expect(buildForceStyle(style, 0.5)).toContain('MarginV=60');
  });

  it('aktiviert den Kastenhintergrund nur bei gesetzter Farbe', () => {
    const style = {
      font: 'DejaVu Sans',
      fontSize: 48,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      position: 'bottom' as const,
      marginVertical: 120,
      bold: true,
      uppercase: false,
      animation: 'none' as const,
      maxCharsPerLine: 38,
    };

    expect(buildForceStyle({ ...style, backgroundColor: null }, 1)).not.toContain('BorderStyle=3');
    expect(buildForceStyle({ ...style, backgroundColor: '#000000' }, 1)).toContain('BorderStyle=3');
  });
});

describe('Filterpfade', () => {
  it('maskiert Doppelpunkte und Backslashes', () => {
    expect(escapeFilterPath('C:\\temp\\subs.srt')).toBe('C\\:/temp/subs.srt');
    expect(escapeFilterPath('subtitles.srt')).toBe('subtitles.srt');
  });
});

describe('Wasserzeichen', () => {
  it('liefert fuer jede Ecke eine Position', () => {
    expect(overlayPosition('top-left')).toBe('24:24');
    expect(overlayPosition('top-right')).toBe('W-w-24:24');
    expect(overlayPosition('bottom-left')).toBe('24:H-h-24');
    expect(overlayPosition('bottom-right')).toBe('W-w-24:H-h-24');
  });

  it('faellt bei unbekannter Angabe auf unten rechts zurueck', () => {
    expect(overlayPosition('mitte')).toBe('W-w-24:H-h-24');
  });
});
