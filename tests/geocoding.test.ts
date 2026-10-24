import assert from 'node:assert/strict';
import test from 'node:test';
import { rankExplicitLocality } from '../src/geocoding.js';

const results = [
  { address: 'Jana z Kolna 1, Pruszcz Gdański', locality: { city: 'Pruszcz Gdański' } },
  { address: 'Jana z Kolna 1, Gdańsk', locality: { city: 'Gdańsk' } },
];

test('keeps nearby municipalities and ranks the explicitly requested locality', () => {
  assert.deepEqual(
    rankExplicitLocality('Jana z Kolna 1, Gdansk', results).map(({ address }) => address),
    ['Jana z Kolna 1, Gdańsk', 'Jana z Kolna 1, Pruszcz Gdański'],
  );
  assert.deepEqual(rankExplicitLocality('Jana z Kolna 1', results), results);
});
