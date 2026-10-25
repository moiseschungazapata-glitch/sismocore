import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilters, filterSearch, invalidDateRange, matchesEvent, filterError } from '../../apps/web/src/lib/filters.ts';

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

test('Advanced filters survive navigation and intersect inclusive bounds with geography',()=>{
 const f=readFilters('?mag_min=4.5&mag_max=4.5&prof_min=30&prof_max=30&region=LIMA&lat=-12&lon=-77&radio=1&poligono='+encodeURIComponent(JSON.stringify([[-13,-78],[-11,-78],[-11,-76],[-13,-76]])))
 assert.deepEqual(readFilters(filterSearch(f)),f)
 const event={id:'1',id_externo:'2026-1',lugar:'Lima',region:'LIMA',magnitud:4.5,profundidad:30,latitud:-12,longitud:-77,ocurrido_en:'2026-10-24T12:00:00Z'}
 assert.equal(matchesEvent(event,f),true)
 assert.equal(matchesEvent({...event,magnitud:null},f),false)
 assert.equal(matchesEvent({...event,latitud:-12.1},f),false)
 assert.ok(filterError({...f,minMagnitude:'6'}))
 assert.ok(filterError({...f,polygon:'[]'}))
})
