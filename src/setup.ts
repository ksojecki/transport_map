import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import unzipper from 'unzipper';
import { namespaceId } from './namespace-id.js';
import { createGtfsParser } from './gtfs-csv.js';

const feeds = [
  {
    id: 'gdansk',
    url: 'https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip',
  },
  { id: 'gdynia', url: 'http://api.zdiz.gdynia.pl/pt/gtfs.zip' },
  { id: 'skm', url: 'https://www.skm.pkp.pl/gtfs-mi-kpd.zip' },
  {
    id: 'polregio',
    url: 'https://transfer.polregio.pl/public/file/2xpjhbomseoindotgttcsg/GTFS.zip',
  },
] as const;

const columns = {
  stops: [
    'stop_id',
    'stop_code',
    'stop_name',
    'tts_stop_name',
    'stop_desc',
    'stop_lat',
    'stop_lon',
    'zone_id',
    'stop_url',
    'location_type',
    'parent_station',
    'stop_timezone',
    'wheelchair_boarding',
    'level_id',
    'platform_code',
  ],
  routes: [
    'route_id',
    'agency_id',
    'route_short_name',
    'route_long_name',
    'route_desc',
    'route_type',
    'route_url',
    'route_color',
    'route_text_color',
    'route_sort_order',
    'continuous_pickup',
    'continuous_drop_off',
  ],
  trips: [
    'route_id',
    'service_id',
    'trip_id',
    'trip_headsign',
    'trip_short_name',
    'direction_id',
    'block_id',
    'shape_id',
    'wheelchair_accessible',
    'bikes_allowed',
  ],
  stop_times: [
    'trip_id',
    'arrival_time',
    'departure_time',
    'stop_id',
    'stop_sequence',
    'stop_headsign',
    'pickup_type',
    'drop_off_type',
    'continuous_pickup',
    'continuous_drop_off',
    'shape_dist_traveled',
    'timepoint',
  ],
  calendar: [
    'service_id',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'start_date',
    'end_date',
  ],
  calendar_dates: ['service_id', 'date', 'exception_type'],
  feed_info: [
    'feed_publisher_name',
    'feed_publisher_url',
    'feed_lang',
    'default_lang',
    'feed_start_date',
    'feed_end_date',
    'feed_version',
    'feed_contact_email',
    'feed_contact_url',
  ],
} as const;

type TableName = keyof typeof columns;
const requiredColumns: Partial<Record<TableName, string[]>> = {
  stops: ['stop_id'],
  routes: ['route_id', 'route_type'],
  trips: ['route_id', 'service_id', 'trip_id'],
  stop_times: ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
  calendar: [
    'service_id',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'start_date',
    'end_date',
  ],
  calendar_dates: ['service_id', 'date', 'exception_type'],
};
const required = ['stops', 'routes', 'trips', 'stop_times'] as const;
const dataDir = join(process.cwd(), 'data');
const target = join(dataDir, 'gtfs.sqlite');
const extractedRoot = join(dataDir, 'gtfs');

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}) for ${url}`);
  await pipeline(response.body, createWriteStream(path));
}

async function extract(zipPath: string, destination: string): Promise<Map<string, string>> {
  const archive = await unzipper.Open.file(zipPath);
  const files = new Map<string, string>();
  for (const entry of archive.files) {
    if (entry.type !== 'File') continue;
    const name = basename(entry.path.replaceAll('\\', '/')).toLowerCase();
    if (!name.endsWith('.txt')) continue;
    if (files.has(name)) throw new Error(`Duplicate GTFS file: ${name}`);
    const path = join(destination, name);
    files.set(name, path);
    await pipeline(entry.stream(), createWriteStream(path, { flags: 'wx' }));
  }
  return files;
}

async function publish(stage: string): Promise<void> {
  await mkdir(extractedRoot, { recursive: true });
  const backup = join(stage, 'previous');
  await mkdir(backup);
  const replacements = [
    ...feeds.map((feed) => [join(stage, 'gtfs', feed.id), join(extractedRoot, feed.id)] as const),
    [join(stage, 'gtfs.sqlite'), target] as const,
  ];
  const movedOld: string[] = [];
  const movedNew: string[] = [];
  try {
    for (let i = 0; i < replacements.length; i++) {
      const [, destination] = replacements[i];
      try {
        await rename(destination, join(backup, String(i)));
        movedOld[i] = join(backup, String(i));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    for (let i = 0; i < replacements.length; i++) {
      const [source, destination] = replacements[i];
      await rename(source, destination);
      movedNew[i] = destination;
    }
  } catch (error) {
    for (const destination of movedNew.reverse())
      await rm(destination, { recursive: true, force: true });
    for (let i = 0; i < replacements.length; i++) {
      if (movedOld[i]) await rename(movedOld[i], replacements[i][1]);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const stage = await mkdtemp(join(dataDir, '.setup-'));
  const stagedDb = join(stage, 'gtfs.sqlite');
  const db = new Database(stagedDb);
  try {
    await mkdir(join(stage, 'gtfs'), { recursive: true });
    db.pragma('journal_mode = DELETE');
    db.exec(
      'CREATE TABLE feeds (provider TEXT PRIMARY KEY, imported_at TEXT NOT NULL, feed_version TEXT)',
    );
    for (const table of Object.keys(columns) as TableName[]) {
      const fields = columns[table];
      const primary =
        table === 'stops'
          ? 'stop_id'
          : table === 'routes'
            ? 'route_id'
            : table === 'trips'
              ? 'trip_id'
              : table === 'calendar'
                ? 'service_id'
                : table === 'calendar_dates'
                  ? 'service_id, date'
                  : table === 'stop_times'
                    ? 'trip_id, stop_sequence'
                    : '';
      db.exec(
        `CREATE TABLE ${quote(table)} (provider TEXT NOT NULL, ${fields.map((field) => `${quote(field)} TEXT`).join(', ')}${primary ? `, PRIMARY KEY (provider, ${primary.split(', ').map(quote).join(', ')})` : ''})`,
      );
    }
    db.exec('CREATE INDEX stop_times_stop_idx ON stop_times(provider, stop_id)');
    db.exec('CREATE INDEX calendar_dates_date_idx ON calendar_dates(provider, date)');
    db.exec('CREATE INDEX calendar_range_idx ON calendar(provider, start_date, end_date)');
    db.exec(
      'CREATE INDEX stop_times_trip_sequence_idx ON stop_times(provider, trip_id, stop_sequence)',
    );
    db.exec('CREATE INDEX trips_service_idx ON trips(provider, service_id)');
    db.exec('CREATE INDEX stops_coordinates_idx ON stops(provider, stop_lat, stop_lon)');

    db.exec('BEGIN');
    try {
      for (const feed of feeds) {
        const zipPath = join(stage, `${feed.id}.zip`);
        await download(feed.url, zipPath);
        const feedDirectory = join(stage, 'gtfs', feed.id);
        await mkdir(feedDirectory, { recursive: true });
        const available = await extract(zipPath, feedDirectory);
        for (const table of required)
          if (!available.has(`${table}.txt`))
            throw new Error(`${feed.id} is missing required ${table}.txt`);
        if (!available.has('calendar.txt') && !available.has('calendar_dates.txt'))
          throw new Error(`${feed.id} has no calendar.txt or calendar_dates.txt`);
        let feedVersion: string | null = null;
        for (const table of Object.keys(columns) as TableName[]) {
          const entry = available.get(`${table}.txt`);
          if (!entry) continue;
          let headers: string[] = [];
          const parser = createReadStream(entry).pipe(
            createGtfsParser((header) => (headers = header)),
          );
          const insert = db.prepare(
            `INSERT INTO ${quote(table)} (provider, ${columns[table].map(quote).join(', ')}) VALUES (${['?', ...columns[table].map(() => '?')].join(', ')})`,
          );
          let count = 0;
          try {
            for await (const row of parser as AsyncIterable<Record<string, string>>) {
              const values = columns[table].map(
                (field) => namespaceId(row[field] ?? '', field, feed.id) || null,
              );
              insert.run(feed.id, ...values);
              if (table === 'feed_info' && row.feed_version) feedVersion = row.feed_version;
              count++;
            }
          } catch (error) {
            throw new Error(
              `${feed.id}/${table}.txt: ${error instanceof Error ? error.message : error}`,
              { cause: error },
            );
          }
          const missing = (requiredColumns[table] ?? []).filter(
            (field) => !headers.includes(field),
          );
          if (missing.length)
            throw new Error(`${feed.id} ${table}.txt is missing columns: ${missing.join(', ')}`);
          if (count === 0 && (required as readonly string[]).includes(table))
            throw new Error(`${feed.id} has empty ${table}.txt`);
        }
        db.prepare('INSERT INTO feeds (provider, imported_at, feed_version) VALUES (?, ?, ?)').run(
          feed.id,
          new Date().toISOString(),
          feedVersion,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.close();
    await publish(stage);
    console.log(`Imported ${feeds.length} GTFS feeds into ${target}`);
  } finally {
    if (db.open) db.close();
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
