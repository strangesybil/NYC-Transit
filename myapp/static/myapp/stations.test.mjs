import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchStations, stationAlerts, stationOutages} from './stations.js';
const catalog = JSON.parse(await readFile(new URL('../../data/stations.json', import.meta.url)));
const stations = catalog.stations;

test('case-insensitive search, duplicate names, route filter and no results', () => {
  assert.ok(searchStations(stations, '  ASTORIA  ').length > 0);
  const duplicates = searchStations(stations, '23 St').filter(s => s.name === '23 St');
  assert.ok(duplicates.length > 1);
  assert.ok(new Set(duplicates.map(s => s.id)).size === duplicates.length);
  assert.ok(searchStations(stations, '23 St', '1').every(s => s.lines.includes('1')));
  assert.equal(searchStations(stations, 'no such station').length, 0);
});
test('station alerts deduplicate and exclude unrelated lines', () => {
  const a = {id:'a', routes:['N','W'], active:true};
  const b = {id:'b', routes:['A'], active:false};
  assert.deepEqual(stationAlerts([a,a,b], {lines:['N','W']}), [a]);
});
test('equipment requires exact name/alias and route, scheduled outages last', () => {
  const station = {lines:['N'], outage_names:['Astoria Blvd', 'Astoria Boulevard']};
  const a = {station:'Astoria Blvd', lines:['N'], upcoming:true};
  const b = {station:'Astoria Boulevard', lines:['N'], upcoming:false};
  assert.deepEqual(stationOutages([a,b,{station:'Astoria Blvd',lines:['A']},{station:'Astoria',lines:['N']}], station), [b,a]);
  assert.deepEqual(stationOutages([], station), []);
});

// Load the real store with only its Firebase token provider replaced.
const source = await readFile(new URL('./favorites.js', import.meta.url), 'utf8');
async function store() {
  return import('data:text/javascript;base64,' + Buffer.from(source.replace('import { getIdToken } from "./auth.js";', 'const getIdToken = async () => "test-token";') + `\n// ${Math.random()}`).toString('base64'));
}
const response = (data, status=200) => ({ok:status<400, status, json:async()=>data});
test('late favorite loads cannot restore signed-out data', async () => {
  const old = globalThis.fetch;
  try {
    let finish;
    globalThis.fetch = () => new Promise(resolve => {finish=resolve;});
    const s = await store();
    const pending = s.loadFavorites(true);
    await new Promise(resolve => setImmediate(resolve));
    await s.loadFavorites(false);
    finish(response({favorites:[{id:1,kind:'route',name:'A'},{id:2,kind:'station',station_id:'1'}]}));
    await pending;
    assert.deepEqual(s.favoriteRoutes(), []);
    assert.deepEqual(s.savedStations(), []);
  } finally { globalThis.fetch = old; }
});
test('station persistence, pending-click guard and failed deletion retain state', async () => {
  const old = globalThis.fetch;
  try {
    const s = await store();
    const favorite = {id:2,kind:'station',station_id:'1',name:'Astoria-Ditmars Blvd'};
    globalThis.fetch = async () => response({favorites:[favorite]});
    await s.loadFavorites(true);
    assert.equal(s.isStationSaved('1'), true);
    let finish; let requests=0;
    globalThis.fetch = () => {requests++; return new Promise(resolve=>{finish=resolve;});};
    const pending = s.toggleStation('1');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.stationPending('1'), true);
    await s.toggleStation('1');
    assert.equal(requests,1);
    finish(response({error:'Service unavailable'},503));
    await assert.rejects(pending, /Service unavailable/);
    assert.equal(s.isStationSaved('1'),true);
    assert.equal(s.stationPending('1'),false);
    globalThis.fetch = async () => response({},204);
    await s.toggleStation('1');
    assert.equal(s.isStationSaved('1'),false);
  } finally {globalThis.fetch=old;}
});
test('late station save cannot restore favorites after sign-out', async () => {
  const old=globalThis.fetch;
  try {
    const s=await store(); let finish;
    globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const pending=s.toggleStation('1');
    await new Promise(resolve=>setImmediate(resolve));
    await s.loadFavorites(false);
    finish(response({favorite:{id:2,kind:'station',station_id:'1'}}));
    await pending;
    assert.deepEqual(s.savedStations(),[]);
  } finally {globalThis.fetch=old;}
});
