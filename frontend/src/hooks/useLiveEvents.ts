import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

type EventName = 'job.updated' | 'video.updated' | 'post.updated' | 'worker.updated' | 'log';

const INVALIDATIONS: Record<EventName, string[][]> = {
  'job.updated': [['dashboard'], ['jobs'], ['videos'], ['video']],
  'video.updated': [['dashboard'], ['videos'], ['video'], ['calendar']],
  'post.updated': [['dashboard'], ['calendar'], ['publishing'], ['video'], ['videos']],
  'worker.updated': [['services'], ['workers']],
  log: [['logs']],
};

export function useLiveEvents(enabled: boolean): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const scheduled = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) return undefined;

    const source = new EventSource('/api/system/events', { withCredentials: true });
    let closed = false;

    const invalidate = (keys: string[][]) => {
      for (const key of keys) {
        const id = key.join('.');
        const existing = scheduled.current.get(id);
        if (existing) window.clearTimeout(existing);
        scheduled.current.set(
          id,
          window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: key });
            scheduled.current.delete(id);
          }, 350),
        );
      }
    };

    source.addEventListener('connected', () => setConnected(true));
    source.onopen = () => setConnected(true);
    source.onerror = () => {
      if (!closed) setConnected(false);
    };

    for (const name of Object.keys(INVALIDATIONS) as EventName[]) {
      source.addEventListener(name, () => invalidate(INVALIDATIONS[name]));
    }

    return () => {
      closed = true;
      source.close();
      for (const timer of scheduled.current.values()) window.clearTimeout(timer);
      scheduled.current.clear();
      setConnected(false);
    };
  }, [enabled, queryClient]);

  return { connected };
}
