import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { JobStatus, Platform, PostStatus, VideoStatus } from './types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const numberFormat = new Intl.NumberFormat('de-DE');
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} Mio`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1).replace('.', ',')} Tsd`;
  return numberFormat.format(value);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const exponent = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const decimals = value >= 100 || exponent === 0 ? 0 : 1;
  const rounded = Number(value.toFixed(decimals));
  const rendered = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals).replace('.', ',');
  return `${rendered} ${BYTE_UNITS[exponent]}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dateFormat.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dateTimeFormat.format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '--:--';
  return timeFormat.format(new Date(value));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const diffMs = Date.now() - new Date(value).getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (Math.abs(diffSec) < 60) return 'gerade eben';
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return diffMin > 0 ? `vor ${diffMin} Min` : `in ${-diffMin} Min`;
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return diffHour > 0 ? `vor ${diffHour} Std` : `in ${-diffHour} Std`;
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 30) return diffDay > 0 ? `vor ${diffDay} Tg` : `in ${-diffDay} Tg`;
  return formatDate(value);
}

interface StatusMeta {
  label: string;
  tone: 'idle' | 'info' | 'progress' | 'success' | 'warn' | 'danger';
  dot: string;
}

export const VIDEO_STATUS: Record<VideoStatus, StatusMeta> = {
  DRAFT: { label: 'Entwurf', tone: 'idle', dot: 'bg-state-idle' },
  QUEUED: { label: 'In Warteschlange', tone: 'info', dot: 'bg-state-info' },
  WAITING_FOR_GPU: { label: 'Wartet auf GPU', tone: 'warn', dot: 'bg-state-warn' },
  GENERATING: { label: 'Wird generiert', tone: 'progress', dot: 'bg-brand-400' },
  PROCESSING: { label: 'Wird verarbeitet', tone: 'progress', dot: 'bg-brand-400' },
  GENERATED: { label: 'Fertig generiert', tone: 'info', dot: 'bg-state-info' },
  REVIEW_REQUIRED: { label: 'Freigabe noetig', tone: 'warn', dot: 'bg-state-warn' },
  APPROVED: { label: 'Freigegeben', tone: 'success', dot: 'bg-state-success' },
  SCHEDULED: { label: 'Geplant', tone: 'info', dot: 'bg-state-info' },
  PUBLISHING: { label: 'Wird veroeffentlicht', tone: 'progress', dot: 'bg-brand-400' },
  PUBLISHED: { label: 'Veroeffentlicht', tone: 'success', dot: 'bg-state-success' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'danger', dot: 'bg-state-danger' },
  ARCHIVED: { label: 'Archiviert', tone: 'idle', dot: 'bg-state-idle' },
};

export const JOB_STATUS: Record<JobStatus, StatusMeta> = {
  PENDING: { label: 'Wartet', tone: 'idle', dot: 'bg-state-idle' },
  WAITING_FOR_GPU: { label: 'Wartet auf GPU', tone: 'warn', dot: 'bg-state-warn' },
  RUNNING: { label: 'Laeuft', tone: 'progress', dot: 'bg-brand-400' },
  COMPLETED: { label: 'Fertig', tone: 'success', dot: 'bg-state-success' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'danger', dot: 'bg-state-danger' },
  CANCELLED: { label: 'Abgebrochen', tone: 'idle', dot: 'bg-state-idle' },
};

export const POST_STATUS: Record<PostStatus, StatusMeta> = {
  draft: { label: 'Entwurf', tone: 'idle', dot: 'bg-state-idle' },
  scheduled: { label: 'Geplant', tone: 'info', dot: 'bg-state-info' },
  queued: { label: 'In Warteschlange', tone: 'info', dot: 'bg-state-info' },
  processing: { label: 'Laedt hoch', tone: 'progress', dot: 'bg-brand-400' },
  published: { label: 'Veroeffentlicht', tone: 'success', dot: 'bg-state-success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger', dot: 'bg-state-danger' },
  cancelled: { label: 'Abgebrochen', tone: 'idle', dot: 'bg-state-idle' },
};

export const PLATFORM_META: Record<Platform, { label: string; color: string; short: string }> = {
  youtube: { label: 'YouTube', color: '#ff0033', short: 'YT' },
  tiktok: { label: 'TikTok', color: '#25f4ee', short: 'TT' },
  instagram: { label: 'Instagram', color: '#e1306c', short: 'IG' },
  facebook: { label: 'Facebook', color: '#1877f2', short: 'FB' },
};

export const FORMAT_LABEL: Record<string, string> = {
  youtube_video: 'YouTube Video',
  youtube_short: 'YouTube Short',
  tiktok: 'TikTok',
  instagram_reel: 'Instagram Reel',
  facebook_reel: 'Facebook Reel',
};

export const LANGUAGE_LABEL: Record<string, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  fr: 'Franzoesisch',
  it: 'Italienisch',
};

export function toneClasses(tone: StatusMeta['tone']): string {
  switch (tone) {
    case 'success':
      return 'bg-state-success/10 text-state-success border-state-success/25';
    case 'warn':
      return 'bg-state-warn/10 text-state-warn border-state-warn/25';
    case 'danger':
      return 'bg-state-danger/10 text-state-danger border-state-danger/25';
    case 'info':
      return 'bg-state-info/10 text-state-info border-state-info/25';
    case 'progress':
      return 'bg-brand-500/10 text-brand-400 border-brand-500/25';
    default:
      return 'bg-surface-hover text-ink-muted border-edge';
  }
}
