import type Database from 'better-sqlite3';
import { buildContours, type Point } from './contours.js';

const WALKING_SPEED = 1.2;
const TRANSFER_WALK_SECONDS = 120;
type Stop = Point & { id: string; provider: string; name: string };
type StopTime = {
  stop: Stop;
  tripId: string;
  routeId: string;
  routeName: string;
  departure: number;
  arrival: number;
  sequence: number;
  pickup: string;
  dropOff: string;
  tripKey: string;
};
type Trip = {
  tripId: string;
  routeId: string;
  routeName: string;
  provider: string;
  serviceId: string;
};
type Leg = { trip: Trip; board: StopTime; end: StopTime; walkFrom?: Stop };
type Journey = {
  arrival: number;
  departure: number;
  walkSeconds: number;
  transferWaitSeconds: number;
  legs: Leg[];
};
const dateCaches = new WeakMap<
  Database.Database,
  Map<
    string,
    { active: Set<string>; rowsByStop: Map<string, StopTime[]>; byTrip: Map<string, StopTime[]> }
  >
>();
const rad = (n: number) => (n * Math.PI) / 180;
function distance(a: Point, b: Point): number {
  const dLat = rad(b.latitude - a.latitude),
    dLon = rad(b.longitude - a.longitude),
    x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function timeSeconds(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function activeServices(db: Database.Database, provider: string, date: string): Set<string> {
  const day = date.replaceAll('-', ''),
    weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      new Date(`${date}T00:00:00Z`).getUTCDay()
    ];
  const active = new Set(
    (
      db
        .prepare(
          `SELECT service_id FROM calendar WHERE provider=? AND start_date<=? AND end_date>=? AND "${weekday}"='1'`,
        )
        .all(provider, day, day) as Array<{ service_id: string }>
    ).map((r) => r.service_id),
  );
  for (const row of db
    .prepare('SELECT service_id, exception_type FROM calendar_dates WHERE provider=? AND date=?')
    .all(provider, day) as Array<{ service_id: string; exception_type: string }>) {
    if (row.exception_type === '1') active.add(row.service_id);
    else if (row.exception_type === '2') active.delete(row.service_id);
  }
  return active;
}
function timetable(db: Database.Database, date: string) {
  const dateCache =
    dateCaches.get(db) ??
    new Map<
      string,
      { active: Set<string>; rowsByStop: Map<string, StopTime[]>; byTrip: Map<string, StopTime[]> }
    >();
  dateCaches.set(db, dateCache);
  if (dateCache.has(date)) return dateCache.get(date)!;
  const providers = (
    db.prepare('SELECT provider FROM feeds').all() as Array<{ provider: string }>
  ).map((row) => row.provider);
  const active = new Set<string>();
  for (const provider of providers) {
    const services = new Set([
      ...activeServices(db, provider, date),
      ...activeServices(db, provider, previousDate(date)),
    ]);
    for (const service of services) active.add(service);
  }
  const rowsByStop = new Map<string, StopTime[]>(),
    byTrip = new Map<string, StopTime[]>();
  for (const provider of providers) {
    const services = new Map<string, number[]>();
    for (const [service, offset] of [...activeServices(db, provider, date)].map(
      (id) => [id, 0] as const,
    ))
      services.set(service, [offset]);
    for (const service of activeServices(db, provider, previousDate(date)))
      services.set(service, [...(services.get(service) ?? []), -86400]);
    if (!services.size) continue;
    const servicesList = [...services.keys()];
    const placeholders = servicesList.map(() => '?').join(',');
    const query = db.prepare(
      `SELECT s.trip_id,t.route_id,t.service_id,r.route_short_name,s.stop_id,s.arrival_time,s.departure_time,s.stop_sequence,s.pickup_type,s.drop_off_type,p.stop_name,p.stop_lat,p.stop_lon FROM trips t JOIN stop_times s ON s.provider=t.provider AND s.trip_id=t.trip_id JOIN stops p ON p.provider=s.provider AND p.stop_id=s.stop_id LEFT JOIN routes r ON r.provider=t.provider AND r.route_id=t.route_id WHERE t.provider=? AND t.service_id IN (${placeholders}) ORDER BY t.trip_id,CAST(s.stop_sequence AS INTEGER)`,
    );
    const grouped = new Map<string, StopTime[]>();
    for (const row of query.all(provider, ...servicesList) as Array<{
      trip_id: string;
      route_id: string;
      service_id: string;
      route_short_name: string;
      stop_id: string;
      arrival_time: string;
      departure_time: string;
      stop_sequence: string;
      pickup_type: string;
      drop_off_type: string;
      stop_name: string;
      stop_lat: string;
      stop_lon: string;
    }>) {
      const arrival = timeSeconds(row.arrival_time),
        departure = timeSeconds(row.departure_time),
        latitude = Number(row.stop_lat),
        longitude = Number(row.stop_lon);
      if (
        arrival === null ||
        departure === null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      )
        continue;
      const offsets = services.get(row.service_id)!;
      const stop: Stop = {
        id: row.stop_id,
        provider,
        name: row.stop_name || row.stop_id,
        latitude,
        longitude,
      };
      for (const offset of offsets) {
        const key = `${provider}|${row.trip_id}|${offset}`;
        const rows = grouped.get(key) ?? [];
        rows.push({
          stop,
          tripId: row.trip_id,
          routeId: row.route_id,
          routeName: row.route_short_name || row.route_id,
          departure: departure + offset,
          arrival: arrival + offset,
          sequence: Number(row.stop_sequence),
          pickup: row.pickup_type || '0',
          dropOff: row.drop_off_type || '0',
          tripKey: key,
        });
        grouped.set(key, rows);
      }
    }
    for (const [key, list] of grouped) {
      byTrip.set(key, list);
      for (const row of list) {
        const rows = rowsByStop.get(row.stop.id) ?? [];
        rows.push(row);
        rowsByStop.set(row.stop.id, rows);
      }
    }
  }
  for (const rows of rowsByStop.values()) rows.sort((a, b) => a.departure - b.departure);
  const result = { active, rowsByStop, byTrip };
  dateCache.set(date, result);
  while (dateCache.size > 3) dateCache.delete(dateCache.keys().next().value!);
  return result;
}
function routePath(legs: Leg[], byTrip: Map<string, StopTime[]>) {
  const path: Array<Record<string, unknown>> = [];
  for (const leg of legs) {
    if (leg.walkFrom)
      path.push({
        kind: 'transfer_walk',
        fromStopId: leg.walkFrom.id,
        toStopId: leg.board.stop.id,
        from: { latitude: leg.walkFrom.latitude, longitude: leg.walkFrom.longitude },
        to: { latitude: leg.board.stop.latitude, longitude: leg.board.stop.longitude },
      });
    const times = byTrip.get(leg.board.tripKey) ?? [],
      start = times.indexOf(leg.board),
      end = times.indexOf(leg.end);
    for (let i = start; i >= 0 && i < end; i++) {
      const from = times[i].stop,
        to = times[i + 1].stop;
      path.push({
        kind: 'ride',
        provider: leg.trip.provider,
        routeId: leg.trip.routeId,
        routeName: leg.trip.routeName,
        tripId: leg.trip.tripId,
        fromStopId: from.id,
        toStopId: to.id,
        from: { latitude: from.latitude, longitude: from.longitude },
        to: { latitude: to.latitude, longitude: to.longitude },
      });
    }
  }
  return path;
}

export function calculateCoverage(
  db: Database.Database,
  input: {
    latitude: number;
    longitude: number;
    date: string;
    time: string;
    journeyLimit: number;
    walkMinutes: number;
    minimumTransfer: number;
    includeTransfers: boolean;
  },
) {
  const providers = (
    db.prepare('SELECT provider FROM feeds').all() as Array<{ provider: string }>
  ).map((row) => row.provider);
  const coverage = providers.map((provider) => {
    const row = db
      .prepare(
        'SELECT MIN(start_date) AS start, MAX(end_date) AS end FROM calendar WHERE provider=?',
      )
      .get(provider) as { start: string | null; end: string | null };
    const exceptions = db
      .prepare('SELECT MIN(date) AS start, MAX(date) AS end FROM calendar_dates WHERE provider=?')
      .get(provider) as { start: string | null; end: string | null };
    const feed = db
      .prepare(
        'SELECT MIN(feed_start_date) AS start, MAX(feed_end_date) AS end FROM feed_info WHERE provider=?',
      )
      .get(provider) as { start: string | null; end: string | null };
    const starts = [row.start, exceptions.start, feed.start].filter((value): value is string =>
      Boolean(value),
    );
    const ends = [row.end, exceptions.end, feed.end].filter((value): value is string =>
      Boolean(value),
    );
    const start = starts.length ? starts.sort()[0] : null,
      end = ends.length ? ends.sort().at(-1)! : null;
    return {
      provider,
      start: start?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') ?? null,
      end: end?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') ?? null,
      status:
        start &&
        end &&
        input.date.replaceAll('-', '') >= start &&
        input.date.replaceAll('-', '') <= end
          ? 'covered'
          : 'outside_coverage',
    };
  });
  const covered = coverage.some((item) => item.status === 'covered');
  const snapshot = covered
    ? timetable(db, input.date)
    : {
        active: new Set<string>(),
        rowsByStop: new Map<string, StopTime[]>(),
        byTrip: new Map<string, StopTime[]>(),
      };
  const startSeconds = Number(input.time.slice(0, 2)) * 3600 + Number(input.time.slice(3, 5)) * 60;
  const deadline = startSeconds + input.journeyLimit * 60;
  const origin: Point = { latitude: input.latitude, longitude: input.longitude };
  const maxWalk = input.walkMinutes * 60;
  const allStops = db
    .prepare('SELECT provider,stop_id,stop_name,stop_lat,stop_lon FROM stops')
    .all() as Array<{
    provider: string;
    stop_id: string;
    stop_name: string;
    stop_lat: string;
    stop_lon: string;
  }>;
  const stops = allStops
    .map((r): Stop => ({
      id: r.stop_id,
      provider: r.provider,
      name: r.stop_name || r.stop_id,
      latitude: Number(r.stop_lat),
      longitude: Number(r.stop_lon),
    }))
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  const bucketSize = 0.001;
  const buckets = new Map<string, Stop[]>();
  const bucketKey = (latitude: number, longitude: number) =>
    `${Math.floor(latitude / bucketSize)}|${Math.floor(longitude / bucketSize)}`;
  for (const stop of stops) {
    const key = bucketKey(stop.latitude, stop.longitude),
      bucket = buckets.get(key) ?? [];
    bucket.push(stop);
    buckets.set(key, bucket);
  }
  const within = (point: Point, maxDistance: number) => {
    const latRange = Math.ceil(maxDistance / 111_000 / bucketSize) + 1;
    const lonRange =
      Math.ceil(
        maxDistance / (111_000 * Math.max(0.01, Math.cos(rad(point.latitude)))) / bucketSize,
      ) + 1;
    const nearbyStops: Array<{ stop: Stop; walkSeconds: number }> = [];
    const latBucket = Math.floor(point.latitude / bucketSize),
      lonBucket = Math.floor(point.longitude / bucketSize);
    for (let lat = latBucket - latRange; lat <= latBucket + latRange; lat++)
      for (let lon = lonBucket - lonRange; lon <= lonBucket + lonRange; lon++) {
        for (const stop of buckets.get(`${lat}|${lon}`) ?? []) {
          const walkSeconds = distance(point, stop) / WALKING_SPEED;
          if (walkSeconds <= maxDistance / WALKING_SPEED) nearbyStops.push({ stop, walkSeconds });
        }
      }
    return nearbyStops;
  };
  const origins = within(origin, maxWalk * WALKING_SPEED).filter(
    ({ walkSeconds }) => walkSeconds <= input.journeyLimit * 60,
  );
  const direct = new Map<string, Journey>(),
    transfers = new Map<string, Journey>();
  const nearby = new Map<string, Array<{ stop: Stop; walkSeconds: number }>>();
  const walkTransfer = input.minimumTransfer * 60;
  const consider = (map: Map<string, Journey>, stop: Stop, journey: Journey) => {
    const key = `${stop.provider}|${stop.id}`,
      current = map.get(key);
    if (!current || journey.arrival < current.arrival) map.set(key, journey);
  };
  for (const { stop: originStop, walkSeconds: originWalk } of origins) {
    const departures = snapshot.rowsByStop.get(originStop.id) ?? [];
    let low = 0,
      high = departures.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (departures[mid].departure < startSeconds + originWalk) low = mid + 1;
      else high = mid;
    }
    for (let k = low; k < departures.length && departures[k].departure <= deadline; k++) {
      const board = departures[k];
      if (['1', '2', '3', '4'].includes(board.pickup)) continue;
      const times = snapshot.byTrip.get(board.tripKey) ?? [];
      const index = times.indexOf(board);
      if (index < 0) continue;
      const firstLeg: Leg = {
        trip: {
          tripId: board.tripId,
          routeId: board.routeId,
          routeName: board.routeName,
          provider: board.stop.provider,
          serviceId: '',
        },
        board,
        end: board,
      };
      for (let i = index + 1; i < times.length; i++) {
        const end = times[i];
        if (end.arrival > deadline) break;
        if (['1', '2', '3', '4'].includes(end.dropOff)) continue;
        const journey: Journey = {
          arrival: end.arrival,
          departure: board.departure,
          walkSeconds: originWalk,
          transferWaitSeconds: 0,
          legs: [{ ...firstLeg, end }],
        };
        consider(direct, end.stop, journey);
        if (input.includeTransfers) {
          const firstLegEnd = end;
          const endKey = `${firstLegEnd.stop.provider}|${firstLegEnd.stop.id}`;
          let near = nearby.get(endKey);
          if (!near) {
            near = within(firstLegEnd.stop, TRANSFER_WALK_SECONDS * WALKING_SPEED);
            nearby.set(endKey, near);
          }
          for (const candidate of near) {
            const ready = firstLegEnd.arrival + candidate.walkSeconds + walkTransfer;
            const nextDepartures = snapshot.rowsByStop.get(candidate.stop.id) ?? [];
            let nextLow = 0,
              nextHigh = nextDepartures.length;
            while (nextLow < nextHigh) {
              const mid = (nextLow + nextHigh) >>> 1;
              if (nextDepartures[mid].departure < ready) nextLow = mid + 1;
              else nextHigh = mid;
            }
            for (
              let nextIndex = nextLow;
              nextIndex < nextDepartures.length && nextDepartures[nextIndex].departure <= deadline;
              nextIndex++
            ) {
              const nextBoard = nextDepartures[nextIndex];
              if (
                (nextBoard.tripId === board.tripId &&
                  nextBoard.stop.provider === board.stop.provider) ||
                ['1', '2', '3', '4'].includes(nextBoard.pickup)
              )
                continue;
              const secondTimes = snapshot.byTrip.get(nextBoard.tripKey) ?? [];
              const secondIndex = secondTimes.indexOf(nextBoard);
              if (secondIndex < 0) continue;
              for (let j = secondIndex + 1; j < secondTimes.length; j++) {
                const finalStop = secondTimes[j];
                if (finalStop.arrival > deadline) break;
                if (['1', '2', '3', '4'].includes(finalStop.dropOff)) continue;
                consider(transfers, finalStop.stop, {
                  arrival: finalStop.arrival,
                  departure: board.departure,
                  walkSeconds: originWalk + candidate.walkSeconds,
                  transferWaitSeconds: Math.max(
                    0,
                    nextBoard.departure - firstLegEnd.arrival - candidate.walkSeconds,
                  ),
                  legs: [
                    { ...firstLeg, end: firstLegEnd },
                    {
                      trip: {
                        tripId: nextBoard.tripId,
                        routeId: nextBoard.routeId,
                        routeName: nextBoard.routeName,
                        provider: nextBoard.stop.provider,
                        serviceId: '',
                      },
                      board: nextBoard,
                      end: finalStop,
                      walkFrom:
                        candidate.stop.id === firstLegEnd.stop.id ? undefined : firstLegEnd.stop,
                    },
                  ],
                });
              }
            }
          }
        }
      }
    }
  }
  const destinations = [];
  for (const key of new Set([
    ...direct.keys(),
    ...(input.includeTransfers ? transfers.keys() : []),
  ])) {
    const directJourney = direct.get(key),
      transferJourney = input.includeTransfers ? transfers.get(key) : undefined;
    const journey =
      !transferJourney || (directJourney && directJourney.arrival <= transferJourney.arrival)
        ? directJourney!
        : transferJourney;
    const [provider, ...id] = key.split('|');
    const stop = stops.find((item) => item.provider === provider && item.id === id.join('|'))!;
    const durationSeconds = journey.arrival - startSeconds,
      remaining = Math.max(0, input.journeyLimit * 60 - durationSeconds);
    const radiusMeters = Math.min(maxWalk, remaining * WALKING_SPEED);
    const kind = journey.legs.length > 1 ? 'transfer' : 'direct';
    destinations.push({
      stop,
      journey: {
        kind,
        departure: journey.departure,
        arrival: journey.arrival,
        durationSeconds,
        walkSeconds: journey.walkSeconds,
        waitSeconds: Math.max(0, journey.departure - startSeconds - journey.walkSeconds),
        transferWaitSeconds: journey.transferWaitSeconds,
      },
      circle: { radiusMeters },
      path: routePath(journey.legs, snapshot.byTrip),
      transferStops: journey.legs.slice(1).map((leg) => leg.walkFrom ?? leg.board.stop),
    });
  }
  const selected = destinations.sort((a, b) => a.journey.arrival - b.journey.arrival);
  const counted = {
    direct: selected.filter((item) => item.journey.kind === 'direct').length,
    transfers: selected.filter((item) => item.journey.kind === 'transfer').length,
    origins: origins.length,
  };
  const contours = buildContours(
    selected.map((item) => ({
      point: item.stop,
      minutes: item.journey.durationSeconds / 60,
      radiusMeters: item.circle.radiusMeters,
    })),
    input.journeyLimit,
  );
  const status = !covered
    ? 'outside_coverage'
    : !snapshot.active.size
      ? 'no_active_service'
      : !origins.length
        ? 'no_origin_stops'
        : 'ok';
  return {
    status,
    date: input.date,
    time: input.time,
    coverage: {
      start:
        coverage
          .map((item) => item.start)
          .filter(Boolean)
          .sort()[0] ?? null,
      end:
        coverage
          .map((item) => item.end)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      providers: coverage,
    },
    counts: counted,
    originWalk: { center: origin, radiusMeters: maxWalk },
    originStops: origins.map(({ stop, walkSeconds }) => ({ ...stop, walkSeconds })),
    destinations: selected,
    contours,
  };
}
