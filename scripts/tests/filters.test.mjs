import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilters, filterSearch, invalidDateRange } from '../../apps/web/src/lib/filters.ts';

test('Both dates survive navigation and either endpoint can be used independently',() => {
  const value = readFilters('?q=Lima&desde=2026-10-01&hasta=2026-10-23');
  assert.equal(value.since,'2026-10-01');
  assert.equal(value.until,'2026-10-23');
  assert.deepEqual(readFilters(filterSearch(value)),value);
  assert.equal(readFilters('?hasta=2026-10-23').since,'');
  assert.equal(invalidDateRange(value),false);
});
test('Impossible calendar dates are rejected and reversed ranges are identifiable',() => {
  assert.equal(readFilters('?hasta=2026-02-30').until,'');
  assert.equal(readFilters('?desde=2026-13-01').since,'');
  assert.equal(readFilters('?hasta=2024-02-29').until,'2024-02-29');
  assert.equal(invalidDateRange(readFilters('?desde=2026-10-23&hasta=2026-10-22')),true);
  assert.equal(invalidDateRange(readFilters('?desde=2026-10-23&hasta=2026-10-23')),false);
});
