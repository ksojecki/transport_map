import Database from 'better-sqlite3';

export function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE feeds(provider TEXT);
    CREATE TABLE calendar(provider TEXT,service_id TEXT,monday TEXT,tuesday TEXT,wednesday TEXT,thursday TEXT,friday TEXT,saturday TEXT,sunday TEXT,start_date TEXT,end_date TEXT);
    CREATE TABLE calendar_dates(provider TEXT,service_id TEXT,date TEXT,exception_type TEXT);
    CREATE TABLE feed_info(provider TEXT,feed_start_date TEXT,feed_end_date TEXT);
    CREATE TABLE stops(provider TEXT,stop_id TEXT,stop_name TEXT,stop_lat TEXT,stop_lon TEXT);
    CREATE TABLE routes(provider TEXT,route_id TEXT,route_short_name TEXT,PRIMARY KEY(provider,route_id));
    CREATE TABLE trips(provider TEXT,trip_id TEXT,route_id TEXT,service_id TEXT);
    CREATE TABLE stop_times(provider TEXT,trip_id TEXT,arrival_time TEXT,departure_time TEXT,stop_id TEXT,stop_sequence TEXT,pickup_type TEXT,drop_off_type TEXT);
  `);
  const addProvider = (provider: string, service = `${provider}:weekday`, weekdays = '1111100') => {
    db.prepare('INSERT INTO feeds VALUES (?)').run(provider);
    db.prepare('INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      provider,
      service,
      ...weekdays,
      '20261001',
      '20261031',
    );
    db.prepare('INSERT INTO feed_info VALUES (?,?,?)').run(provider, '20261001', '20261031');
  };
  const addStop = (provider: string, id: string, latitude: number, longitude: number, name = id) =>
    db
      .prepare('INSERT INTO stops VALUES (?,?,?,?,?)')
      .run(provider, id, name, String(latitude), String(longitude));
  const addTrip = (
    provider: string,
    trip: string,
    service: string,
    stops: Array<[string, string, string]>,
  ) => {
    db.prepare('INSERT OR IGNORE INTO routes VALUES (?,?,?)').run(
      provider,
      `${provider}:route`,
      'R',
    );
    db.prepare('INSERT INTO trips VALUES (?,?,?,?)').run(
      provider,
      trip,
      `${provider}:route`,
      service,
    );
    const insert = db.prepare('INSERT INTO stop_times VALUES (?,?,?,?,?,?,?,?)');
    stops.forEach(([stop, arrival, departure], index) =>
      insert.run(provider, trip, arrival, departure, stop, String(index + 1), '0', '0'),
    );
  };
  return { db, addProvider, addStop, addTrip };
}

export const baseRequest = {
  latitude: 54.35,
  longitude: 18.65,
  date: '2026-10-26',
  time: '08:00',
  journeyLimit: 30,
  walkMinutes: 0,
  minimumTransfer: 0,
  includeTransfers: true,
};
