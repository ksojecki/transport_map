import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCoverage } from '../src/routing.js';
import { baseRequest, fixture } from './fixtures.js';

test('uses weekday calendar, date additions/removals, and previous-day overnight service', () => {
  const { db, addProvider, addStop, addTrip } = fixture();
  try {
    addProvider('p', 'p:weekday');
    db.prepare('INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      'p',
      'p:sunday',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
      '20261001',
      '20261031',
    );
    db.prepare('INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      'p',
      'p:added',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '20261001',
      '20261031',
    );
    db.prepare('INSERT INTO calendar_dates VALUES (?,?,?,?)').run(
      'p',
      'p:weekday',
      '20261026',
      '2',
    );
    db.prepare('INSERT INTO calendar_dates VALUES (?,?,?,?)').run('p', 'p:added', '20261026', '1');
    addStop('p', 'p:start', 54.35, 18.65);
    addStop('p', 'p:removed', 54.35, 18.651);
    addStop('p', 'p:added-stop', 54.35, 18.652);
    addStop('p', 'p:overnight', 54.35, 18.653);
    addTrip('p', 'p:removed-trip', 'p:weekday', [
      ['p:start', '08:05:00', '08:05:00'],
      ['p:removed', '08:10:00', '08:10:00'],
    ]);
    addTrip('p', 'p:added-trip', 'p:added', [
      ['p:start', '08:15:00', '08:15:00'],
      ['p:added-stop', '08:20:00', '08:20:00'],
    ]);
    addTrip('p', 'p:night-trip', 'p:sunday', [
      ['p:start', '24:05:00', '24:05:00'],
      ['p:overnight', '24:15:00', '24:15:00'],
    ]);
    const result = calculateCoverage(db, baseRequest);
    assert.equal(result.status, 'ok');
    assert.equal(
      result.destinations.some((item) => item.stop.id === 'p:added-stop'),
      true,
    );
    assert.equal(
      result.destinations.some((item) => item.stop.id === 'p:removed'),
      false,
    );
    const overnight = calculateCoverage(db, { ...baseRequest, time: '00:00' });
    assert.equal(
      overnight.destinations.some((item) => item.stop.id === 'p:overnight'),
      true,
    );
  } finally {
    db.close();
  }
});

test('keeps provider stop namespaces separate and permits cross-provider transfers', () => {
  const { db, addProvider, addStop, addTrip } = fixture();
  try {
    addProvider('alpha');
    addProvider('beta');
    addStop('alpha', 'alpha:start', 54.35, 18.65);
    addStop('alpha', 'alpha:shared', 54.35, 18.651);
    addStop('beta', 'beta:start', 54.35, 18.65);
    addStop('beta', 'beta:shared', 54.35, 18.6511);
    addStop('beta', 'beta:end', 54.35, 18.652);
    addTrip('alpha', 'alpha:one', 'alpha:weekday', [
      ['alpha:start', '08:02:00', '08:02:00'],
      ['alpha:shared', '08:05:00', '08:05:00'],
    ]);
    addTrip('beta', 'beta:two', 'beta:weekday', [
      ['beta:shared', '08:06:00', '08:06:00'],
      ['beta:end', '08:10:00', '08:10:00'],
    ]);
    const result = calculateCoverage(db, baseRequest);
    const end = result.destinations.find((item) => item.stop.id === 'beta:end');
    assert.ok(end);
    assert.equal(end.journey.kind, 'transfer');
    assert.deepEqual(end.path.map((segment) => segment.provider).filter(Boolean), [
      'alpha',
      'beta',
    ]);
    assert.equal(
      result.destinations.some(
        (item) => item.stop.id === 'alpha:start' && item.stop.provider === 'beta',
      ),
      false,
    );
  } finally {
    db.close();
  }
});

test('selects the faster transfer, respects includeTransfers and journey, walk, and transfer limits', () => {
  const { db, addProvider, addStop, addTrip } = fixture();
  try {
    addProvider('p');
    addStop('p', 'p:start', 54.35, 18.65);
    addStop('p', 'p:mid', 54.35, 18.651);
    addStop('p', 'p:dest', 54.35, 18.652);
    addTrip('p', 'p:direct', 'p:weekday', [
      ['p:start', '08:10:00', '08:10:00'],
      ['p:dest', '08:30:00', '08:30:00'],
    ]);
    addTrip('p', 'p:first', 'p:weekday', [
      ['p:start', '08:05:00', '08:05:00'],
      ['p:mid', '08:10:00', '08:10:00'],
    ]);
    addTrip('p', 'p:second', 'p:weekday', [
      ['p:mid', '08:12:00', '08:12:00'],
      ['p:dest', '08:20:00', '08:20:00'],
    ]);
    const fastest = calculateCoverage(db, baseRequest).destinations.find(
      (item) => item.stop.id === 'p:dest',
    );
    assert.equal(fastest?.journey.kind, 'transfer');
    const directOnly = calculateCoverage(db, {
      ...baseRequest,
      includeTransfers: false,
    }).destinations.find((item) => item.stop.id === 'p:dest');
    assert.equal(directOnly?.journey.kind, 'direct');
    const capped = calculateCoverage(db, { ...baseRequest, journeyLimit: 10 });
    assert.equal(
      capped.destinations.some((item) => item.stop.id === 'p:dest'),
      false,
    );
    const noOrigin = calculateCoverage(db, { ...baseRequest, walkMinutes: 1, latitude: 54.35135 });
    assert.equal(noOrigin.status, 'no_origin_stops');
    const walking = calculateCoverage(db, {
      ...baseRequest,
      latitude: 54.3495,
      walkMinutes: 2,
      journeyLimit: 21,
    });
    assert.ok(
      walking.originStops.some(
        (stop) => stop.id === 'p:start' && stop.walkSeconds > 40 && stop.walkSeconds < 50,
      ),
    );
    assert.equal(
      walking.destinations.find((item) => item.stop.id === 'p:dest')?.circle.radiusMeters,
      72,
    );
    const transferTooLong = calculateCoverage(db, {
      ...baseRequest,
      minimumTransfer: 5,
    }).destinations.find((item) => item.stop.id === 'p:dest');
    assert.equal(transferTooLong?.journey.kind, 'direct');
  } finally {
    db.close();
  }
});

test('keeps timetable caches isolated between SQLite databases', () => {
  const first = fixture(),
    second = fixture();
  try {
    first.addProvider('one');
    first.addStop('one', 'one:start', 54.35, 18.65);
    first.addStop('one', 'one:end', 54.35, 18.651);
    first.addTrip('one', 'one:trip', 'one:weekday', [
      ['one:start', '08:05:00', '08:05:00'],
      ['one:end', '08:10:00', '08:10:00'],
    ]);
    second.addProvider('two');
    second.addStop('two', 'two:start', 54.35, 18.65);
    second.addStop('two', 'two:end', 54.35, 18.651);
    second.addTrip('two', 'two:trip', 'two:weekday', [
      ['two:start', '08:05:00', '08:05:00'],
      ['two:end', '08:10:00', '08:10:00'],
    ]);
    assert.equal(calculateCoverage(first.db, baseRequest).destinations[0].stop.provider, 'one');
    assert.equal(calculateCoverage(second.db, baseRequest).destinations[0].stop.provider, 'two');
  } finally {
    first.db.close();
    second.db.close();
  }
});
