// Reusable Server-Sent Events helpers.
// Used by the ingest pipeline stream and the Mission Control live feed.

import type { Request, Response } from 'express';

/**
 * Prepare a response for SSE: set the required headers and flush them so the
 * client opens the stream immediately. Returns nothing; use sseSend/sseDone
 * to push events.
 */
export function sseInit(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (e.g. nginx)
  // CORS is already applied app-wide via cors(); nothing extra needed here.
  res.flushHeaders?.();
  // Prime the stream so proxies forward bytes right away.
  res.write(': connected\n\n');
}

/** Write a single SSE message. Optional event name; data is JSON-encoded. */
export function sseSend(res: Response, data: unknown, event?: string): void {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Emit a terminal 'done' event and close the stream. */
export function sseDone(res: Response, payload: unknown = { done: true }): void {
  sseSend(res, payload, 'done');
  res.end();
}
