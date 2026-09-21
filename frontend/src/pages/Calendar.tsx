import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PlatformChip, PostStatusBadge } from '@/components/common';
import { Button, Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn, formatTime, PLATFORM_META } from '@/lib/format';
import type { CalendarEntry } from '@/lib/types';

const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function EntryCard({ entry, draggable }: { entry: CalendarEntry; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    disabled: !draggable,
  });

  const meta = PLATFORM_META[entry.platform];

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined}
      className={cn(
        'rounded-lg border border-edge bg-surface-raised p-2.5 text-left transition-shadow',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        isDragging && 'shadow-glow ring-1 ring-brand-500/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tabular-nums text-ink-muted">
          {formatTime(entry.scheduledAt ?? entry.publishedAt)}
        </span>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta?.color }} />
      </div>
      <Link
        to={`/videos/${entry.videoId}`}
        className="mt-1 block line-clamp-2 text-xs font-medium text-ink hover:text-brand-400"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {entry.videoTitle}
      </Link>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span className="text-[10px] text-ink-faint">{meta?.label}</span>
        {entry.externalUrl ? (
          <a
            href={entry.externalUrl}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(event) => event.stopPropagation()}
            className="text-ink-faint hover:text-brand-400"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function DayColumn({ date, entries, isToday }: { date: Date; entries: CalendarEntry[]; isToday: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(date) });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[240px] flex-col gap-2 rounded-xl border p-2.5 transition-colors',
        isOver ? 'border-brand-500 bg-brand-500/10' : 'border-edge bg-surface/50',
      )}
    >
      <div className="flex items-baseline justify-between px-1">
        <span className={cn('text-xs font-semibold', isToday ? 'text-brand-400' : 'text-ink-muted')}>
          {DAY_NAMES[(date.getDay() + 6) % 7]}
        </span>
        <span className={cn('text-sm font-semibold tabular-nums', isToday ? 'text-brand-400' : 'text-ink')}>
          {date.getDate()}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="px-1 py-4 text-center text-[11px] text-ink-faint">Nichts geplant</p>
      ) : (
        entries.map((entry) => (
          <EntryCard key={entry.id} entry={entry} draggable={entry.status !== 'published'} />
        ))
      )}
    </div>
  );
}

export function CalendarPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return end;
  }, [weekStart]);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', weekStart.toISOString()],
    queryFn: () =>
      api.get<{ items: CalendarEntry[] }>(
        `/api/calendar?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
      ),
    refetchInterval: 30_000,
  });

  const reschedule = useMutation({
    mutationFn: ({ postId, scheduledAt }: { postId: string; scheduledAt: string }) =>
      api.patch(`/api/calendar/${postId}`, { scheduledAt }),
    onSuccess: () => {
      toast.success('Termin verschoben');
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: unknown) =>
      toast.error('Verschieben fehlgeschlagen', err instanceof ApiError ? err.message : 'Unbekannter Fehler'),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      return date;
    });
  }, [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data?.items ?? []) {
      const stamp = entry.scheduledAt ?? entry.publishedAt;
      if (!stamp) continue;
      const key = dayKey(new Date(stamp));
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aTime = new Date(a.scheduledAt ?? a.publishedAt ?? 0).getTime();
        const bTime = new Date(b.scheduledAt ?? b.publishedAt ?? 0).getTime();
        return aTime - bTime;
      });
    }
    return map;
  }, [data]);

  const onDragEnd = (event: DragEndEvent) => {
    const postId = String(event.active.id);
    const targetKey = event.over ? String(event.over.id) : null;
    if (!targetKey) return;

    const entry = (data?.items ?? []).find((item) => item.id === postId);
    if (!entry) return;

    const original = new Date(entry.scheduledAt ?? entry.publishedAt ?? Date.now());
    const [year, month, day] = targetKey.split('-').map(Number);
    if (!year || !month || !day) return;

    const next = new Date(original);
    next.setFullYear(year, month - 1, day);
    if (dayKey(next) === dayKey(original)) return;

    reschedule.mutate({ postId, scheduledAt: next.toISOString() });
  };

  const shiftWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
  };

  const todayKey = dayKey(new Date());

  return (
    <>
      <PageHeader
        title="Content Kalender"
        description="Geplante und veroeffentlichte Beitraege. Ziehe eine Karte auf einen anderen Tag, um sie zu verschieben."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} aria-label="Vorherige Woche">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              Heute
            </Button>
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(1)} aria-label="Naechste Woche">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <p className="mb-4 text-sm text-ink-muted">
          Woche vom {weekStart.toLocaleDateString('de-DE')} bis {new Date(weekEnd.getTime() - 1).toLocaleDateString('de-DE')}
        </p>

        {isLoading ? (
          <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-56" />
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
              {days.map((date) => (
                <DayColumn
                  key={dayKey(date)}
                  date={date}
                  entries={byDay.get(dayKey(date)) ?? []}
                  isToday={dayKey(date) === todayKey}
                />
              ))}
            </div>
          </DndContext>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-4 p-4 text-xs text-ink-muted">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Legende
          </span>
          {(['scheduled', 'queued', 'processing', 'published', 'failed'] as const).map((status) => (
            <PostStatusBadge key={status} status={status} />
          ))}
        </div>
      </Card>
    </>
  );
}
