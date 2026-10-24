import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createGtfsParser } from '../src/gtfs-csv.js';

test('accepts interior quotes while retaining quoted commas and newlines', async () => {
  let headers: string[] = [];
  const parser = Readable.from([
    'stop_id,stop_name\ns1,Ogrody Działkowe "Leśne"\ns2,"Park,\nCentralny"\n',
  ]).pipe(createGtfsParser((value) => (headers = value)));
  const rows: Array<Record<string, string>> = [];
  for await (const row of parser as AsyncIterable<Record<string, string>>) rows.push(row);

  assert.deepEqual(headers, ['stop_id', 'stop_name']);
  assert.deepEqual(rows, [
    { stop_id: 's1', stop_name: 'Ogrody Działkowe "Leśne"' },
    { stop_id: 's2', stop_name: 'Park,\nCentralny' },
  ]);
});
