import assert from 'node:assert/strict';
import test from 'node:test';
import { namespaceId } from '../src/namespace-id.js';

test('namespaces shared GTFS IDs and their references by provider', () => {
  for (const field of ['stop_id', 'route_id', 'trip_id', 'service_id']) {
    assert.equal(namespaceId('shared', field, 'alpha'), 'alpha:shared');
    assert.equal(namespaceId('shared', field, 'beta'), 'beta:shared');
  }
  assert.equal(namespaceId('', 'stop_id', 'alpha'), '');
  assert.equal(namespaceId('shared', 'route_short_name', 'alpha'), 'shared');
});
