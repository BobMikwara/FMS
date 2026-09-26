/**
 * Real-time event bus.
 *
 * The frontend subscribes to `/api/stream` (Server-Sent Events) and receives
 * lightweight change notifications. Swapping this for a Redis/NATS fan-out or a
 * WebSocket gateway requires no frontend changes — the client only knows about
 * the event names and payload shape.
 */

export type RealtimeEvent =
  | { type: "reading"; tankId: string; stationId: string; volumeLiters: number; levelPercent: number; ts: string; deviceId: string }
  | { type: "alert"; alertId: string; severity: string; title: string; tankId: string | null; stationId: string }
  | { type: "device"; deviceId: string; status: string }
  | { type: "event"; eventId: string; tankId: string; eventType: string; volume: number; ts: string }
  | { type: "heartbeat"; at: string };

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The in-process event bus (see the module docblock for scaling notes). */
export function getBus() {
  return { subscribe, publish, publishThrottled, listenerCount };
}

export function publish(event: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("[realtime] listener failed", error);
    }
  }
}

export function listenerCount(): number {
  return listeners.size;
}

/** Coalesces bursts of events so the client is not flooded. */
let pending: RealtimeEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_MS = 1200;

export function publishThrottled(event: RealtimeEvent): void {
  pending.push(event);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = pending;
    pending = [];
    flushTimer = null;
    for (const item of batch) publish(item);
  }, FLUSH_MS);
}
