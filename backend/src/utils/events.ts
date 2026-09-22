import type { Response } from 'express';
import { logger } from './logger.js';

/**
 * Server-Sent-Events fuer Live-Aktualisierungen im Dashboard.
 *
 * Bewusst SSE statt WebSocket: die Kommunikation ist einseitig (Backend ->
 * Browser), laeuft ueber gewoehnliches HTTP und kommt ohne zusaetzliche
 * Bibliothek oder Proxy-Sonderregel aus.
 */

export type AppEvent =
  | { type: 'job.updated'; jobId: string; videoId: string | null; status: string; progress: number; queue: string }
  | { type: 'video.updated'; videoId: string; status: string; progress: number }
  | { type: 'post.updated'; postId: string; videoId: string; platform: string; status: string }
  | { type: 'worker.updated'; workerId: string; status: string }
  | { type: 'log'; level: string; source: string; message: string }
  | { type: 'ping'; ts: number };

interface Subscriber {
  id: number;
  res: Response;
  userId: string;
}

class EventBus {
  private subscribers = new Map<number, Subscriber>();
  private nextId = 1;
  private keepAlive: NodeJS.Timeout | null = null;

  subscribe(res: Response, userId: string): () => void {
    const id = this.nextId++;
    this.subscribers.set(id, { id, res, userId });

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    if (!this.keepAlive) {
      // Kommentarzeilen halten die Verbindung durch Proxys offen.
      this.keepAlive = setInterval(() => {
        for (const sub of this.subscribers.values()) sub.res.write(': keep-alive\n\n');
      }, 25_000);
      this.keepAlive.unref?.();
    }

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0 && this.keepAlive) {
        clearInterval(this.keepAlive);
        this.keepAlive = null;
      }
    };
  }

  publish(event: AppEvent, ownerId?: string | null): void {
    if (this.subscribers.size === 0) return;
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const sub of this.subscribers.values()) {
      if (ownerId && sub.userId !== ownerId) continue;
      try {
        sub.res.write(payload);
      } catch (err) {
        logger.debug({ err: (err as Error).message }, 'SSE-Abonnent nicht mehr erreichbar');
        this.subscribers.delete(sub.id);
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

export const events = new EventBus();
