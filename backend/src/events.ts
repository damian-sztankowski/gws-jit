import type express from 'express';

const sseClients = new Set<express.Response>();

export function registerSseClient(res: express.Response): () => void {
  sseClients.add(res);
  return () => {
    sseClients.delete(res);
  };
}

export function broadcastEvent(
  eventType: string,
  payload: Record<string, unknown> = {}
): void {
  const data = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
    ...payload
  });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function logStructured(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  component: string,
  message: string,
  meta: Record<string, unknown> = {}
): void {
  if (process.env.NODE_ENV === 'production') {
    const entry = JSON.stringify({
      severity,
      component,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    });
    if (severity === 'ERROR') {
      console.error(entry);
    } else {
      console.log(entry);
    }
    return;
  }

  const prefix = `[${component}]`;
  if (severity === 'ERROR') {
    console.error(prefix, message, Object.keys(meta).length ? meta : '');
  } else if (severity === 'WARNING') {
    console.warn(prefix, message, Object.keys(meta).length ? meta : '');
  } else {
    console.log(prefix, message);
  }
}
