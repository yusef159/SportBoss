import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { byId, catalog, equipment } from '../lib/catalog.mjs';
import { candidates, defaults, estimatedMinutes, rotation, selectPlan } from '../lib/planner.mjs';
import { localTime, openDatabase } from '../lib/storage.mjs';
import { createApp } from '../server.mjs';
import { sendDueReminder } from '../reminders.mjs';

test('the imported catalog has valid images and meaningful classifications', async () => {
  assert.equal(catalog.length, 112);
  assert.equal(byId.size, catalog.length);
  for (const item of catalog) {
    const bytes = await readFile(new URL('../public' + item.image, import.meta.url));
    assert.equal(bytes.readUInt16BE(), 0xffd8, item.name);
  }
  assert.equal(byId.get('standing-dumbbell-calf-raise').region, 'lower');
  assert.equal(byId.get('lying-leg-raise').region, 'core');
  assert.equal(byId.get('seated-chest-press').gear[0], 'Machine');
  assert.equal(byId.get('side-plank').timed, true);
});

test('all equipped exercises complete two cycles across all training approaches', () => {
  for (const gear of [defaults.gear, equipment]) {
    for (const schedule of [['upper','lower'], ['full'], ['upper','full','lower']]) {
      const history = [];
      for (let week = 0; week < 160; week++) {
        const kind = schedule[week % schedule.length];
        const [plan] = candidates(kind, gear, history);
        assert.equal(new Set(plan.map(item => item.id)).size, plan.length);
        assert.ok(plan.every(({ id }) => byId.get(id).gear.every(item => gear.includes(item))));
        const previous = rotation(gear, history);
        history.unshift({ kind, plan });
        const current = rotation(gear, history);
        for (const scope of ['upper','lower']) {
          if (current[scope].cycles > previous[scope].cycles) {
            const credited = plan.filter(({ id }) => {
              const { region } = byId.get(id);
              return region === scope || region === 'core';
            }).map(({ id }) => id);
            assert.equal(new Set([...previous[scope].used, ...credited]).size, current[scope].total);
          }
        }
        if (current.upper.cycles >= 2 && current.lower.cycles >= 2) break;
      }
      const final = rotation(gear, history);
      assert.ok(final.upper.cycles >= 2 && final.lower.cycles >= 2, schedule.join('/'));
    }
  }
});

test('workout length changes set counts and adds exercises while retaining the base movement patterns', () => {
  for (const kind of ['upper', 'lower', 'full']) {
    const [standard] = candidates(kind, defaults.gear, []);
    const [short] = candidates(kind, defaults.gear, [], [], { duration: 30 });
    const extended = candidates(kind, defaults.gear, [], [standard[0].id], { duration: 60 });
    const [long] = extended;
    const setCount = plan => plan.reduce((count, item) => count + item.sets, 0);
    assert.ok(setCount(short) < setCount(standard));
    assert.ok(long.length > standard.length);
    assert.ok(setCount(long) > setCount(standard));
    assert.ok(Math.abs(estimatedMinutes(long.length, setCount(long), defaults.rest) - 60) <= 2);
    const required = standard.slice(0, kind === 'full' ? 4 : 2).map(item => byId.get(item.id).bucket);
    for (const plan of extended) {
      assert.equal(new Set(plan.map(item => item.id)).size, plan.length);
      assert.deepEqual(plan.slice(0, required.length).map(item => byId.get(item.id).bucket), required);
      assert.ok(plan.every(item => item.id !== standard[0].id && item.sets >= 2 && item.sets <= 4));
    }
  }
});

test('Jev chooses a credible alternative and falls back on invalid responses', async () => {
  const plans = candidates('upper', defaults.gear, []);
  const select = await selectPlan('upper', defaults.gear, plans, 'mock-key', async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(options.body);
    assert.equal(Object.keys(body.questions).length, plans.length * 2);
    const answers = Object.fromEntries(plans.flatMap((_, index) => [
      ['balance' + index, { type: 'noul', noul: index === 1 ? .95 : .75 }],
      ['compatibility' + index, { type: 'noul', noul: .98 }],
    ]));
    return { ok: true, json: async () => ({ model: 'jev-mock', answers }) };
  });
  assert.equal(select.source, 'jev');
  assert.deepEqual(select.plan, plans[1]);
  assert.equal(select.review.selected, 1);
  assert.equal(select.review.model, 'jev-mock');
  assert.equal(select.review.scores.length, plans.length);
  assert.deepEqual(await selectPlan('upper', defaults.gear, plans, 'mock-key', async () => {
    throw new Error('Unavailable');
  }), { plan: plans[0], source: 'rules', review: { status: 'unavailable' } });
});

test('Jerusalem dates account for daylight saving and local midnight', () => {
  assert.deepEqual(localTime(Date.parse('2026-07-01T21:10:00Z')), { day: '2026-07-02', time: '00:10' });
  assert.deepEqual(localTime(Date.parse('2026-01-01T21:10:00Z')), { day: '2026-01-01', time: '23:10' });
});

test('reminders send once per scheduled Jerusalem day and skip completed days', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'form-reminder-test-'));
  const db = openDatabase(directory);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const settings = { token: '123:example', chat: '456', appUrl: new URL('https://form.invalid'), time: '18:00', days: ['Wed','Thu'] };
  let now = Date.parse('2026-11-25T15:59:00Z');
  const messages = [];
  const run = () => sendDueReminder(db, settings, { clock: () => now, request: async (_, request) => {
    messages.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  await run();
  assert.equal(messages.length, 0);
  now += 60000;
  await Promise.all([run(), run()]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /https:\/\/form\.invalid/);
  now += 86400000;
  db.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('full','[]','rules',?,?)").run(now - 5000, now);
  await run();
  assert.equal(messages.length, 1);
});

async function startServer(directory) {
  const instance = createApp({ dataDir: directory, username: 'test', password: 'test-password' });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  const base = 'http://127.0.0.1:' + instance.address().port;
  const auth = 'Basic ' + Buffer.from('test:test-password').toString('base64');
  async function request(path, body, headers = {}) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: auth, ...(body && { 'Content-Type': 'application/json' }), ...headers },
      body: body && JSON.stringify(body),
    });
    return [response.status, await response.json()];
  }
  return { base, request, stop: async () => {
    if (!instance.listening) return;
    const closed = once(instance, 'close');
    instance.close();
    await closed;
  } };
}
test('reset requires confirmation and clears saved training data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-reset-'));
  const server = await startServer(directory);
  const db = openDatabase(directory);
  t.after(async () => {
    db.close();
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  });

  const exercise = 'standing-dumbbell-calf-raise';
  const now = Date.now();
  const day = localTime(now).day;
  db.prepare('INSERT INTO preferences VALUES(1, ?)').run(JSON.stringify({ rest: 90, excluded: [exercise] }));
  const workout = db.prepare("INSERT INTO workouts(kind, plan, source, started, finished) VALUES('lower', '[]', 'rules', ?, ?)")
    .run(now - 60000, now).lastInsertRowid;
  db.prepare('INSERT INTO sets VALUES(?, 0, ?, 10, 12)').run(workout, exercise);
  db.prepare("INSERT INTO workout_reviews VALUES(?, '{}')").run(workout);
  db.exec("INSERT INTO workouts(kind, plan, source) VALUES('upper', '[]', 'rules')");
  db.prepare("INSERT INTO reminders VALUES(?, 'sent', ?)").run(day, now);

  const [unconfirmed] = await server.request('/api/reset-data', {});
  assert.equal(unconfirmed, 400);
  const [crossSite] = await server.request('/api/reset-data', { confirm: true }, { Origin: 'https://example.invalid' });
  assert.equal(crossSite, 403);
  const [unauthenticated] = await server.request('/api/reset-data', { confirm: true }, { Authorization: 'Basic invalid' });
  assert.equal(unauthenticated, 401);
  const [, before] = await server.request('/api/overview');
  assert.equal(before.progress.history.length, 1);
  assert.ok(before.pending);

  const [status, after] = await server.request('/api/reset-data', { confirm: true });
  assert.equal(status, 200);
  assert.deepEqual(after.settings, defaults);
  assert.deepEqual(after.progress.history, []);
  assert.deepEqual(after.progress.records, []);
  assert.equal(after.pending, null);
  for (const table of ['workouts', 'sets', 'workout_reviews', 'preferences']) {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count, 0, table);
  }
  assert.equal(db.prepare('SELECT state FROM reminders WHERE day=?').get(day).state, 'sent');
  const [repeated] = await server.request('/api/reset-data', { confirm: true });
  assert.equal(repeated, 200);
});
test('exercise exclusions persist and apply to generation, swaps and rotation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-exclusions-'));
  let server = await startServer(directory);
  t.after(async () => { await server.stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (...args) => server.request(...args);
  const [, baseline] = await request('/api/generate', { kind: 'upper' });
  const id = baseline.pending.id;
  const omitted = baseline.pending.plan[0].id;
  const swap = { id, index: 0, from: omitted };
  const [, alternatives] = await request('/api/swaps', swap);
  const blockedSwap = alternatives[0].id;
  await request('/api/exercise-preference', { id: blockedSwap, excluded: true });
  const [status, changed] = await request('/api/exercise-preference', { id: omitted, excluded: true });
  assert.equal(status, 200);
  assert.equal(changed.progress.rotation.upper.total, baseline.progress.rotation.upper.total - 2);
  assert.equal((await request('/api/start', { id }))[0], 409);
  assert.equal((await request('/api/swap', { ...swap, exercise: blockedSwap }))[0], 400);
  const [, permitted] = await request('/api/swaps', swap);
  assert.ok(permitted.some(item => item.id !== blockedSwap));
  assert.ok(permitted.every(item => item.id !== blockedSwap && item.id !== omitted));
  assert.equal((await request('/api/swap', { ...swap, exercise: permitted[0].id }))[0], 200);
  assert.equal((await request('/api/start', { id }))[0], 200);
  const [, settings] = await request('/api/settings', { ...changed.settings, rest: 90 });
  assert.deepEqual(settings.settings.excluded, [blockedSwap, omitted].sort());
  await server.stop();
  server = await startServer(directory);
  const [, saved] = await request('/api/overview');
  assert.deepEqual(saved.settings.excluded, [blockedSwap, omitted].sort());
  const [, restored] = await request('/api/exercise-preference', { id: blockedSwap, excluded: false });
  assert.deepEqual(restored.settings.excluded, [omitted]);
  assert.equal(restored.progress.rotation.upper.total, baseline.progress.rotation.upper.total - 1);
  await request('/api/discard', { id });
  const [generated, next] = await request('/api/generate', { kind: 'upper' });
  assert.equal(generated, 200);
  assert.ok(next.pending.plan.every(item => item.id !== omitted));
});

test('duration settings reach the workout preview and swaps keep the scheduled sets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-duration-'));
  const { request, stop } = await startServer(directory);
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const [status, settings] = await request('/api/settings', { ...defaults, duration: 60 });
  assert.equal(status, 200);
  assert.equal(settings.settings.duration, 60);
  const [generated, { pending }] = await request('/api/generate', { kind: 'upper' });
  assert.equal(generated, 200);
  assert.ok(pending.plan.length > 5);
  assert.ok(Math.abs(pending.estimatedMinutes - 60) <= 2);
  const index = pending.plan.findIndex(item => item.sets > 3);
  assert.ok(index >= 0);
  const swap = { id: pending.id, index, from: pending.plan[index].id };
  const [, choices] = await request('/api/swaps', swap);
  assert.ok(choices.length);
  const [swapped, updated] = await request('/api/swap', { ...swap, exercise: choices[0].id });
  assert.equal(swapped, 200);
  assert.equal(updated.pending.plan[index].sets, pending.plan[index].sets);
  assert.equal(updated.pending.totalSets, pending.totalSets);
  const extraIndex = pending.plan.length - 1;
  assert.equal((await request('/api/swaps', { id: pending.id, index: extraIndex, from: pending.plan[extraIndex].id }))[0], 200);
});

test('weight prefill remembers the latest set of the same exercise', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-weight-'));
  const db = openDatabase(directory);
  const exercise = 'flat-dumbbell-bench-press';
  const plan = JSON.stringify([{ id: exercise, sets: 3, reps: 10 }]);
  const insertWorkout = db.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('upper',?,'rules',?,?)");
  const insertSet = db.prepare('INSERT INTO sets VALUES(?, ?, ?, ?, ?)');
  const older = insertWorkout.run(plan, 1000, 2000).lastInsertRowid;
  insertSet.run(older, 0, exercise, 20, 12);
  const recent = insertWorkout.run(plan, 3000, 4000).lastInsertRowid;
  insertSet.run(recent, 0, exercise, 0, 10);
  insertSet.run(recent, 1, exercise, 7.5, 9);
  insertSet.run(recent, 2, exercise, 10.5, 8);
  const id = insertWorkout.run(plan, null, null).lastInsertRowid;
  db.close();
  const server = await startServer(directory);
  t.after(async () => { await server.stop(); await rm(directory, { recursive: true, force: true }); });
  const [startStatus, started] = await server.request('/api/start', { id });
  assert.equal(startStatus, 200);
  assert.deepEqual(started.pending.prefill, { kg: 10.5, reps: 10 });
  const [setStatus, updated] = await server.request('/api/set', { id, ordinal: 0, kg: 11.5, reps: 10 });
  assert.equal(setStatus, 200);
  assert.deepEqual(updated.pending.prefill, { kg: 11.5, reps: 9 });
});

test('workout API persists preview, sets, rest, history, and metrics across restart', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'form-test-'));
  let server = await startServer(directory);
  t.after(async () => { await server?.stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (...args) => server.request(...args);
  assert.equal((await fetch(server.base + '/')).status, 401);
  assert.equal((await fetch(server.base + '/healthz')).status, 200);
  assert.equal((await request('/api/generate', { kind: 'upper' }, { Origin: 'https://example.com' }))[0], 403);
  const builds = await Promise.all([request('/api/generate', { kind: 'upper' }), request('/api/generate', { kind: 'lower' })]);
  assert.equal(builds[0][1].pending.id, builds[1][1].pending.id);
  assert.equal(builds[0][1].aiConfigured, false);
  assert.equal(builds[0][1].pending.review.status, 'disabled');
  let { pending } = builds[0][1];
  const id = pending.id;
  const from = pending.plan[0].id;
  const { 1: swaps } = await request('/api/swaps', { id, index: 0, from });
  assert.ok(swaps.length);
  [ , { pending }] = await request('/api/swap', { id, index: 0, from, exercise: swaps[0].id });
  assert.equal(pending.plan[0].id, swaps[0].id);
  assert.equal(pending.review.modified, true);
  [ , { pending }] = await request('/api/start', { id });
  assert.ok(pending.started);
  const payload = { id, ordinal: 0, kg: byId.get(pending.next.id).gear.includes('Bodyweight') ? 0 : 12.5, reps: 9 };
  const firstExercise = pending.next.id;
  assert.equal((await request('/api/set', payload))[0], 200);
  assert.equal((await request('/api/set', payload))[0], 200);
  assert.equal((await request('/api/set', { ...payload, ordinal: 1 }))[0], 409);
  await server.stop();
  server = await startServer(directory);
  [ , { pending }] = await request('/api/overview');
  assert.equal(pending.sets.length, 1);
  assert.deepEqual([pending.prefill.kg, pending.prefill.reps], [payload.kg, payload.reps]);
  assert.ok(pending.rest_until > Date.now());
  let result;
  while (pending) {
    [ , { pending }] = await request('/api/skip-rest', { id, until: pending.rest_until });
    const item = byId.get(pending.next.id);
    const [status, updated] = await request('/api/set', { id, ordinal: pending.sets.length,
      kg: item.gear.includes('Bodyweight') ? 0 : 13, reps: item.timed ? 30 : 10 });
    assert.equal(status, 200, updated.error);
    result = updated;
    pending = updated.pending;
  }
  assert.ok(result.summary.achievements.length);
  assert.equal(result.progress.history.length, 1);
  assert.equal(result.recommendation, builds[0][1].pending.kind === 'upper' ? 'lower' : 'upper');
  const [ , points] = await request('/api/trend/' + firstExercise);
  assert.ok(points.length);
  const [ , detail] = await request('/api/workout/' + id);
  assert.deepEqual(detail, result.summary);
  assert.ok(detail.started <= detail.finished);
  assert.equal(detail.finished - detail.started, detail.duration);
  assert.equal(result.progress.history[0].started, detail.started);
  assert.equal(result.progress.history[0].finished, detail.finished);
});
