import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calculateCoverage } from './routing.js';
import { validCoverageRequest } from './validation.js';
import { rankExplicitLocality } from './geocoding.js';

const app = Fastify({ logger: true });
const db = new Database(join(process.cwd(), 'data', 'gtfs.sqlite'), {
  readonly: true,
  fileMustExist: true,
});
const tricity = { south: 54.1, west: 18.2, north: 54.7, east: 19.0 };
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

app.get('/api/health', async () => ({ status: 'ok', database: 'ready' }));
app.get<{ Querystring: { q?: string } }>('/api/addresses/suggest', async (request, reply) => {
  const q = request.query.q?.trim();
  if (!q || q.length < 3 || q.length > 200)
    return reply.code(400).send({ error: 'q must contain 3 to 200 characters' });
  const params = new URLSearchParams({
    q,
    limit: '5',
    lat: '54.352',
    lon: '18.646',
    lang: 'pl',
    bbox: `${tricity.west},${tricity.south},${tricity.east},${tricity.north}`,
  });
  try {
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return reply.code(502).send({ error: 'Address provider unavailable' });
    const payload = (await response.json()) as {
      features?: Array<{
        properties?: Record<string, string>;
        geometry?: { coordinates?: number[] };
      }>;
    };
    const results = (payload.features ?? []).flatMap((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [],
        p = feature.properties ?? {};
      if (
        !bounded(latitude, tricity.south, tricity.north) ||
        !bounded(longitude, tricity.west, tricity.east)
      )
        return [];
      const address = [
        [p.street, p.housenumber].filter(Boolean).join(' ') || p.name,
        p.city || p.district,
      ]
        .filter(Boolean)
        .join(', ');
      return address ? [{ address, latitude, longitude }] : [];
    });
    return { results };
  } catch {
    return reply.code(502).send({ error: 'Address provider unavailable' });
  }
});
app.get<{ Querystring: { q?: string } }>('/api/addresses/search', async (request, reply) => {
  const q = request.query.q?.trim();
  if (!q || q.length < 3 || q.length > 200)
    return reply.code(400).send({ error: 'q must contain 3 to 200 characters' });
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    countrycodes: 'pl',
    viewbox: `${tricity.west},${tricity.north},${tricity.east},${tricity.south}`,
    bounded: '1',
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'mapa-transportu/1.0 (local Tricity transit planner)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return reply.code(502).send({ error: 'Address provider unavailable' });
    const results = (
      (await response.json()) as Array<{
        display_name?: string;
        lat?: string;
        lon?: string;
        address?: Record<string, unknown>;
      }>
    ).flatMap((item) => {
      const latitude = Number(item.lat),
        longitude = Number(item.lon);
      return item.display_name &&
        bounded(latitude, tricity.south, tricity.north) &&
        bounded(longitude, tricity.west, tricity.east)
        ? [{ address: item.display_name, latitude, longitude, locality: item.address }]
        : [];
    });
    return {
      results: rankExplicitLocality(q, results).map(({ address, latitude, longitude }) => ({
        address,
        latitude,
        longitude,
      })),
    };
  } catch {
    return reply.code(502).send({ error: 'Address provider unavailable' });
  }
});
app.post<{ Body: Record<string, unknown> }>('/api/coverage', async (request, reply) => {
  const body = request.body;
  if (!validCoverageRequest(body)) {
    return reply.code(400).send({ error: 'Invalid coverage request' });
  }
  return calculateCoverage(db, body);
});
app.get('/', async (_request, reply) =>
  reply.type('text/html; charset=utf-8').send(await readFile(join(process.cwd(), 'index.html'))),
);
app.get('/app.js', async (_request, reply) =>
  reply.type('text/javascript; charset=utf-8').send(await readFile(join(process.cwd(), 'app.js'))),
);

const port = Number(process.env.PORT || 3000);
try {
  await app.listen({ host: process.env.HOST || '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  db.close();
  process.exit(1);
}
