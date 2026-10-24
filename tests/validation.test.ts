import assert from 'node:assert/strict';
import test from 'node:test';
import { validCoverageRequest } from '../src/validation.js';
import { baseRequest } from './fixtures.js';

test('accepts valid coverage inputs and rejects invalid dates, times, bounds, and types', () => {
  assert.equal(validCoverageRequest(baseRequest), true);
  for (const invalid of [
    { ...baseRequest, date: '2026-02-30' },
    { ...baseRequest, time: '24:00' },
    { ...baseRequest, latitude: 91 },
    { ...baseRequest, longitude: Infinity },
    { ...baseRequest, journeyLimit: 91 },
    { ...baseRequest, walkMinutes: -1 },
    { ...baseRequest, minimumTransfer: 5.1 },
    { ...baseRequest, includeTransfers: 1 },
    null,
  ])
    assert.equal(validCoverageRequest(invalid), false, JSON.stringify(invalid));
});
