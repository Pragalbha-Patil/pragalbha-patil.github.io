const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeCheckboxUpdate(update) {
  const id = Number.isFinite(update?.id) ? Math.trunc(update.id) : NaN;
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return { id, checked: update?.checked === true };
}

function formatCheckboxUpdateEvent(update) {
  const normalized = normalizeCheckboxUpdate(update);
  if (!normalized) {
    return null;
  }
  const data = `{"id":${normalized.id},"checked":${normalized.checked}}`;
  return `event: checkbox-update\ndata: ${data}\n\n`;
}

function formatPresenceEvent(online) {
  const count = Number.isFinite(online) && online >= 0 ? Math.trunc(online) : 0;
  const data = `{"online":${count}}`;
  return `event: presence\ndata: ${data}\n\n`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const roomId = env.CHECKBOX_ROOM.idFromName('global');
    const room = env.CHECKBOX_ROOM.get(roomId);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({ ok: true, service: 'checkbox-worker' });
    }

    if (url.pathname === '/api/checked' && request.method === 'GET') {
      return room.fetch('https://room.internal/checked');
    }

    if (url.pathname === '/api/update' && request.method === 'POST') {
      const body = await parseJson(request);
      if (!body || !Number.isFinite(body.id) || typeof body.checked !== 'boolean') {
        return jsonResponse({ error: 'Invalid payload' }, 400);
      }

      return room.fetch('https://room.internal/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Math.trunc(body.id), checked: body.checked }),
      });
    }

    if (url.pathname === '/api/batch' && request.method === 'POST') {
      const body = await parseJson(request);
      if (!body || !Array.isArray(body.updates)) {
        return jsonResponse({ error: 'Invalid payload' }, 400);
      }

      return room.fetch('https://room.internal/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: body.updates }),
      });
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      return room.fetch('https://room.internal/events');
    }

    if (url.pathname === '/api/online' && request.method === 'GET') {
      return room.fetch('https://room.internal/online');
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

export class CheckboxRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.clients = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/checked' && request.method === 'GET') {
      const checkedIds = await this.getAllCheckedIds();
      return jsonResponse({ checkedIds });
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      const body = await parseJson(request);
      const id = Number.isFinite(body?.id) ? Math.trunc(body.id) : NaN;
      const checked = body?.checked === true;

      if (!Number.isFinite(id) || id < 1) {
        return jsonResponse({ error: 'Invalid checkbox id' }, 400);
      }

      await this.setCheckboxState(id, checked);
      this.broadcast({ id, checked });
      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/batch' && request.method === 'POST') {
      const body = await parseJson(request);
      const updates = Array.isArray(body?.updates) ? body.updates : [];

      for (const update of updates) {
        if (!Array.isArray(update) || update.length < 2) {
          continue;
        }
        const id = parseInt(update[0], 10);
        const checked = update[1] === true;
        if (!Number.isFinite(id) || id < 1) {
          continue;
        }
        await this.setCheckboxState(id, checked);
        this.broadcast({ id, checked });
      }

      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      return this.openEventStream(request);
    }

    if (url.pathname === '/online' && request.method === 'GET') {
      return jsonResponse({ online: this.clients.size });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }

  async setCheckboxState(id, checked) {
    const key = `c:${id}`;
    if (checked) {
      await this.ctx.storage.put(key, 1);
    } else {
      await this.ctx.storage.delete(key);
    }
  }

  async getAllCheckedIds() {
    const ids = [];
    let start;

    while (true) {
      const page = await this.ctx.storage.list({
        prefix: 'c:',
        start,
        limit: 1000,
      });

      if (page.size === 0) {
        break;
      }

      let lastKey = null;
      for (const [key] of page) {
        lastKey = key;
        const id = parseInt(key.slice(2), 10);
        if (Number.isFinite(id)) {
          ids.push(id);
        }
      }

      if (page.size < 1000 || !lastKey) {
        break;
      }

      start = `${lastKey}\u0000`;
    }

    return ids;
  }

  openEventStream(request) {
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const write = message => writer.write(encoder.encode(message));

    const client = { writer, write };
    this.clients.add(client);

    write(': connected\n\n');
    write(formatPresenceEvent(this.clients.size));
    this.broadcastPresence();

    const heartbeat = setInterval(() => {
      write(': ping\n\n').catch(() => {
        clearInterval(heartbeat);
      });
    }, 25000);

    const cleanup = async () => {
      clearInterval(heartbeat);
      request.signal?.removeEventListener('abort', onAbort);
      this.clients.delete(client);
      this.broadcastPresence();
      try {
        await writer.close();
      } catch {
        // Writer may already be closed.
      }
    };

    const onAbort = () => {
      this.ctx.waitUntil(cleanup());
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    return new Response(stream.readable, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  }

  broadcast(update) {
    const payload = formatCheckboxUpdateEvent(update);
    if (!payload) {
      return;
    }

    for (const client of this.clients) {
      client.write(payload).catch(async () => {
        this.clients.delete(client);
        try {
          await client.writer.close();
        } catch {
          // Ignore close errors.
        }
      });
    }
  }

  broadcastPresence() {
    const payload = formatPresenceEvent(this.clients.size);

    for (const client of this.clients) {
      client.write(payload).catch(async () => {
        this.clients.delete(client);
        try {
          await client.writer.close();
        } catch {
          // Ignore close errors.
        }
      });
    }
  }
}
