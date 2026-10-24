# Backend API contract

The server is started with `pnpm start` and serves the existing `index.html` and `app.js` from the repository root. JSON errors use `{ "error": "..." }`.

- `GET /api/health` → `{ status: "ok", database: "ready" }`
- `GET /api/addresses/suggest?q=...` (Photon) and `GET /api/addresses/search?q=...` (Nominatim) → `{ results: [{ address, latitude, longitude }] }`. Results are bounded to the Tricity area.
- `POST /api/coverage` accepts `{ latitude, longitude, date: "YYYY-MM-DD", time: "HH:MM", journeyLimit: 0..90, walkMinutes: 0..15, minimumTransfer: 0..5, includeTransfers: boolean }`.

A successful coverage response is ready to render:

```ts
{
  status: 'ok' | 'outside_coverage' | 'no_active_service' | 'no_origin_stops',
  date: string,
  time: string,
  coverage: { start: string | null, end: string | null,
    providers: Array<{ provider: string, start: string | null, end: string | null,
      status: 'covered' | 'outside_coverage' }> },
  counts: { direct: number, transfers: number, origins: number },
  originWalk: { center: { latitude: number, longitude: number }, radiusMeters: number },
  originStops: Array<{ id: string, provider: string, name: string, latitude: number,
    longitude: number, walkSeconds: number }>,
  destinations: Array<{
    stop: { id: string, provider: string, name: string, latitude: number, longitude: number },
    journey: { kind: 'direct' | 'transfer', departure: number, arrival: number,
      durationSeconds: number, walkSeconds: number, waitSeconds: number,
      transferWaitSeconds: number },
    circle: { radiusMeters: number },
    path: Array<{ kind: 'ride' | 'transfer_walk', provider?: string, routeId?: string,
      routeName?: string, tripId?: string, fromStopId: string, toStopId: string,
      from: { latitude: number, longitude: number }, to: { latitude: number, longitude: number } }>,
    transferStops: Array<{ id: string, provider: string, name: string,
      latitude: number, longitude: number }>
  }>,
  contours: Array<{ minutes: number, lines: Array<Array<{ latitude: number, longitude: number }>> }>
}
```

`departure` and `arrival` are seconds from midnight on the selected service date; an overnight GTFS time can be negative after shifting the previous service day. `durationSeconds` is measured from the requested time and therefore includes origin walk, waiting, in-vehicle time, transfer walk, and transfer wait. Valid requests with no usable service or nearby origin stops return HTTP 200 and a status; invalid input returns HTTP 400. IDs retain their GTFS provider prefix.
