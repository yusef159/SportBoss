import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { byId, catalog, eligible, equipment } from '../lib/catalog.mjs';
import { candidates, defaults, durationOptions, estimatedWorkoutMinutes, rotation, selectPlan, swapOptions } from '../lib/planner.mjs';
import { awardWeeklyGoal, describeWorkout, exerciseTrend, localTime, openDatabase, overview, saveSettings } from '../lib/storage.mjs';
import { strengthProgression } from '../lib/strength-progression.mjs';
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
    assert.ok(Math.abs(estimatedWorkoutMinutes(long, defaults.rest) - 60) <= 2);
    const required = standard.slice(0, kind === 'full' ? 4 : 2).map(item => byId.get(item.id).bucket);
    for (const plan of extended) {
      assert.equal(new Set(plan.map(item => item.id)).size, plan.length);
      assert.deepEqual(plan.slice(0, required.length).map(item => byId.get(item.id).bucket), required);
      assert.ok(plan.every(item => item.id !== standard[0].id && item.sets >= 2 && item.sets <= 4));
    }
  }
});

test('short upper and lower sessions keep all required exercises and adjust reps or hold times', () => {
  const onlyTimedAbs = catalog.filter(exercise => exercise.muscle === 'Abs' && !exercise.timed).map(({ id }) => id);
  for (const [kind, count] of [['upper', 6], ['lower', 5]]) {
    const [standard] = candidates(kind, defaults.gear, []);
    for (const rest of [15, defaults.rest, 180]) {
      const plans = candidates(kind, defaults.gear, [], onlyTimedAbs, { duration: 30, rest });
      for (const plan of plans) {
        assert.equal(plan.length, count);
        assert.deepEqual(plan.map(({ id }) => byId.get(id).muscle), standard.map(({ id }) => byId.get(id).muscle));
        assert.ok(plan.some(({ id, reps }) => !byId.get(id).timed && reps !== 10));
        assert.ok(plan.some(({ id, reps }) => byId.get(id).timed && reps !== 30));
        const estimate = estimatedWorkoutMinutes(plan, rest);
        if (rest === 180) assert.ok(estimate > 30);
        else assert.ok(Math.abs(estimate - 30) <= 2);
      }
    }
    const [long] = candidates(kind, defaults.gear, [], [], { duration: 75 });
    assert.ok(long.length > count);
  }
});

test('every upper-body candidate and its swaps preserve all six muscle groups', () => {
  const required = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Abs'];
  for (const gear of [defaults.gear, ['Bodyweight', 'Cable']]) {
    const pool = eligible(gear);
    for (const duration of durationOptions) {
      for (const plan of candidates('upper', gear, [], [], { duration })) {
        assert.deepEqual(plan.slice(0, 6).map(({ id }) => byId.get(id).muscle), required);
        const used = new Set(plan.map(({ id }) => id));
        for (const [index, muscle] of required.entries()) {
          const swaps = swapOptions('upper', plan, index, gear, []);
          const expected = pool.filter(exercise => exercise.muscle === muscle && !used.has(exercise.id));
          assert.deepEqual(new Set(swaps), new Set(expected), muscle);
        }
      }
    }
  }
  const triceps = catalog.filter(exercise => exercise.muscle === 'Triceps').map(({ id }) => id);
  assert.throws(() => candidates('upper', defaults.gear, [], triceps), /No eligible exercises for Triceps/);

  const savedPlan = [
    'alternating-dumbbell-bench-press', 'alternating-dumbbell-row', 'alternating-dumbbell-curl',
    'alternating-front-raise', 'bent-knee-leg-raise', 'flat-dumbbell-bench-press',
  ].map(id => ({ id }));
  const legacySwaps = swapOptions('upper', savedPlan, 5, defaults.gear, []);
  assert.ok(legacySwaps.length);
  assert.ok(legacySwaps.every(exercise => ['push', 'pull'].includes(exercise.bucket)));
});

test('lower-body candidates and swaps cover quads, hamstrings, glutes, calves and abs', () => {
  const required = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];
  const target = exercise => exercise.pattern === 'Hip hinge' ? 'Hamstrings' : exercise.muscle;
  for (const gear of [defaults.gear, equipment]) {
    const pool = eligible(gear);
    for (const duration of durationOptions) {
      for (const plan of candidates('lower', gear, [], [], { duration })) {
        assert.deepEqual(plan.slice(0, 5).map(({ id }) => target(byId.get(id))), required);
        const used = new Set(plan.map(({ id }) => id));
        for (const [index, muscle] of required.entries()) {
          const swaps = swapOptions('lower', plan, index, gear, []);
          const expected = pool.filter(exercise => exercise.region !== 'upper' &&
            target(exercise) === muscle && !used.has(exercise.id));
          assert.deepEqual(new Set(swaps), new Set(expected), muscle);
        }
      }
    }
  }

  const hinges = catalog.filter(exercise => exercise.pattern === 'Hip hinge').map(({ id }) => id);
  const calves = catalog.filter(exercise => exercise.muscle === 'Calves').map(({ id }) => id);
  const [withLegCurl] = candidates('lower', equipment, [], hinges);
  assert.equal(withLegCurl[1].id, 'leg-curl');
  assert.throws(() => candidates('lower', defaults.gear, [], [...hinges, ...calves]),
    /No eligible exercises for Hamstrings, Calves/);

  const savedPlan = [
    'bulgarian-split-squat', 'dumbbell-hang-clean', 'seated-dumbbell-calf-raise',
    'dumbbell-hip-thrust', 'bent-knee-leg-raise',
  ].map(id => ({ id }));
  const legacySwaps = swapOptions('lower', savedPlan, 1, defaults.gear, []);
  assert.ok(legacySwaps.length);
  assert.ok(legacySwaps.every(exercise => exercise.bucket === 'hip'));
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

test('weekly goals extend a streak in Jerusalem and a missed week breaks it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-streak-'));
  const db = openDatabase(directory);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const insert = db.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('lower','[]','rules',?,?)");
  const complete = timestamp => {
    const finished = Date.parse(timestamp);
    insert.run(finished - 60000, finished);
    return finished;
  };
  saveSettings(db, { ...defaults, goal: 2 });
  assert.equal(awardWeeklyGoal(db, 2, complete('2026-06-07T20:30:00Z')), false);
  assert.equal(awardWeeklyGoal(db, 2, complete('2026-06-07T20:59:00Z')), true);
  const monday = Date.parse('2026-06-07T21:00:00Z');
  const status = now => overview(db, now).progress.weeklyGoal;
  assert.deepEqual(status(monday), { target: 2, reached: false, streak: 1 });
  assert.equal(awardWeeklyGoal(db, 2, complete('2026-06-07T21:01:00Z')), false);
  const reached = complete('2026-06-09T10:00:00Z');
  assert.equal(awardWeeklyGoal(db, 2, reached), true);
  assert.equal(awardWeeklyGoal(db, 2, reached), false);
  saveSettings(db, { ...defaults, goal: 4 });
  assert.deepEqual(status(reached), { target: 2, reached: true, streak: 2 });
  assert.deepEqual(status(monday + 7 * 86400000), { target: 4, reached: false, streak: 2 });
  assert.deepEqual(status(monday + 14 * 86400000), { target: 4, reached: false, streak: 0 });
});

test('existing workout history seeds weekly achievements once using the saved goal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-streak-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = openDatabase(directory);
  saveSettings(old, { ...defaults, goal: 2 });
  old.exec('DROP TABLE weekly_goal_achievements');
  const insert = old.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('lower','[]','rules',?,?)");
  for (const date of ['2024-06-03T12:00:00Z', '2024-06-04T12:00:00Z', '2024-06-10T12:00:00Z']) {
    const finished = Date.parse(date);
    insert.run(finished - 60000, finished);
  }
  old.close();
  const upgraded = openDatabase(directory);
  const now = Date.parse('2024-06-11T12:00:00Z');
  assert.deepEqual(overview(upgraded, now).progress.weeklyGoal, { target: 2, reached: false, streak: 1 });
  saveSettings(upgraded, { ...defaults, goal: 1 });
  upgraded.close();
  const reopened = openDatabase(directory);
  try {
    assert.deepEqual(overview(reopened, now).progress.weeklyGoal, { target: 1, reached: false, streak: 1 });
  } finally { reopened.close(); }
});

test('the working-weight trend uses the best logged weight for each rep count per completed workout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-trend-'));
  const db = openDatabase(directory);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const exercise = 'goblet-squat';
  const addWorkout = db.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('lower','[]','rules',?,?)");
  const addSet = db.prepare('INSERT INTO sets VALUES(?, ?, ?, ?, ?)');
  const first = Date.parse('2026-11-25T13:00:00Z');
  const second = first + 3600000;
  const session = addWorkout.run(first - 60000, first).lastInsertRowid;
  addSet.run(session, 0, exercise, 14, 12);
  addSet.run(session, 1, exercise, 16, 12);
  addSet.run(session, 2, exercise, 24, 8);
  const later = addWorkout.run(second - 60000, second).lastInsertRowid;
  addSet.run(later, 0, exercise, 22, 12);
  const unfinished = addWorkout.run(second + 60000, null).lastInsertRowid;
  addSet.run(unfinished, 0, exercise, 30, 12);
  const history = exerciseTrend(db, exercise);
  const at12 = history.filter(point => point.metric === 'weight' && point.reps === 12);
  assert.deepEqual(at12.map(point => [point.finished, point.value]), [[first, 16], [second, 22]]);
  assert.equal(at12[0].day, at12[1].day);
  assert.equal(history.find(point => point.metric === 'weight' && point.reps === 8).value, 24);
  assert.equal(history.filter(point => point.metric === 'kg').length, 2);
});

test('strength progression keeps a fixed comparison group through rotation and uses prior sets at range boundaries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-strength-'));
  const db = openDatabase(directory);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const addWorkout = db.prepare("INSERT INTO workouts(kind,plan,source,started,finished) VALUES('full','[]','rules',?,?)");
  const addSet = db.prepare('INSERT INTO sets VALUES(?, ?, ?, ?, ?)');
  const time = day => Date.parse(day + 'T12:00:00Z');
  const bench = 'flat-dumbbell-bench-press';
  const squat = 'goblet-squat';
  const incline = 'incline-dumbbell-bench-press';
  const plank = 'side-plank';
  const hold = 'dumbbell-static-hold';
  const row = 'alternating-dumbbell-row';
  const pushup = 'standard-push-up';
  function workout(day, ...sets) {
    const finished = day && time(day);
    const id = addWorkout.run((finished ?? time('2026-11-27')) - 60000, finished).lastInsertRowid;
    sets.forEach((set, ordinal) => addSet.run(id, ordinal, ...set));
  }
  workout('2026-10-01', [bench, 10, 11], [bench, 9, 10], [squat, 20, 8], [hold, 8, 30], [row, 8, 15]);
  workout('2026-10-17', [bench, 12, 1], [squat, 18, 8], [hold, 10, 40], [row, 10, 18], [pushup, 0, 10]);
  workout('2026-11-02', [bench, 12.5, 11], [plank, 0, 30]);
  workout('2026-11-09', [incline, 10, 11]);
  workout('2026-11-16', [squat, 16, 8], [pushup, 0, 11]);
  workout('2026-11-23', [incline, 10, 11], [bench, 40, 20]);
  workout('2026-12-01', [squat, 100, 8]);
  workout(null, [bench, 100, 11]);
  const now = time('2026-11-27');
  const { cards, ranges } = strengthProgression(db, now);
  assert.equal(cards[bench].change, 25);
  assert.deepEqual(cards[bench].first, { kg: 10, reps: 11 });
  assert.deepEqual(cards[bench].current, { kg: 12.5, reps: 11, finished: time('2026-11-02') });
  assert.equal(cards[bench].lastPerformed, time('2026-11-23'));
  assert.equal(cards[hold].change, null);
  assert.equal(cards[row].change, null);
  assert.equal(cards[plank].change, null);
  assert.equal(cards[incline].change, 0);
  assert.equal(cards[squat].change, -20);
  assert.equal(cards[pushup].change, 10);
  assert.deepEqual(ranges.all.counts, { overall: 4, upper: 3, lower: 1 });
  assert.equal(ranges.all.improved, 2);
  assert.deepEqual(ranges.all.latest, { day: '2026-11-23', overall: 3.8, upper: 11.7, lower: -20 });
  const withNewExercise = ranges.all.points.findIndex(point => point.day === '2026-11-09');
  const { day, ...then } = ranges.all.points[withNewExercise];
  const { day: previousDay, ...before } = ranges.all.points[withNewExercise - 1];
  assert.deepEqual(then, before);
  assert.equal(ranges['30d'].points[0].day, '2026-10-29');
  assert.deepEqual(ranges['30d'].latest, { day: '2026-11-23', overall: 9.4, upper: 16.3, lower: -11.1 });
  saveSettings(db, { ...defaults, excluded: [bench], gear: ['Bodyweight'] });
  assert.deepEqual(strengthProgression(db, now), { cards, ranges });
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
  assert.equal(awardWeeklyGoal(db, 1, now), true);
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
  assert.deepEqual(after.progress.weeklyGoal, { target: defaults.goal, reached: false, streak: 0 });
  for (const table of ['workouts', 'sets', 'workout_reviews', 'preferences', 'weekly_goal_achievements']) {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count, 0, table);
  }
  assert.equal(db.prepare('SELECT state FROM reminders WHERE day=?').get(day).state, 'sent');
  const [repeated] = await server.request('/api/reset-data', { confirm: true });
  assert.equal(repeated, 200);
});

test('completing a workout returns the weekly goal celebration once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sportboss-streak-api-'));
  const server = await startServer(directory);
  const db = openDatabase(directory);
  t.after(async () => {
    db.close();
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const request = server.request;
  await request('/api/settings', { ...defaults, goal: 2 });
  const insert = db.prepare("INSERT INTO workouts(kind,plan,source,started) VALUES('upper',?,'rules',?)");
  const plan = JSON.stringify([{ id: 'standard-push-up', sets: 1, reps: 10 }]);
  const finish = async () => {
    const id = Number(insert.run(plan, Date.now()).lastInsertRowid);
    const set = { id, ordinal: 0, kg: 0, reps: 10 };
    const [status, result] = await request('/api/set', set);
    assert.equal(status, 200);
    return { result, set };
  };
  assert.equal((await finish()).result.weeklyGoalReached, false);
  const { result, set } = await finish();
  assert.equal(result.weeklyGoalReached, true);
  assert.deepEqual(result.progress.weeklyGoal, { target: 2, reached: true, streak: 1 });
  assert.equal((await request('/api/set', set))[1].weeklyGoalReached, undefined);
  assert.equal((await finish()).result.weeklyGoalReached, false);
  const [, settings] = await request('/api/settings', { ...defaults, goal: 4 });
  assert.deepEqual(settings.progress.weeklyGoal, { target: 2, reached: true, streak: 1 });
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
  assert.equal(settings.standardCounts.upper, 6);
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

  await request('/api/discard', { id: pending.id });
  await request('/api/settings', { ...defaults, duration: 30, rest: 15 });
  const [, { pending: short }] = await request('/api/generate', { kind: 'upper' });
  assert.equal(short.plan.length, 6);
  assert.equal(short.estimatedMinutes, estimatedWorkoutMinutes(short.plan, 15));
  const first = short.plan[0];
  assert.ok(first.reps < 10);
  const firstSwap = { id: short.id, index: 0, from: first.id };
  const [, shortChoices] = await request('/api/swaps', firstSwap);
  const [, afterSwap] = await request('/api/swap', { ...firstSwap, exercise: shortChoices[0].id });
  assert.equal(afterSwap.pending.plan[0].sets, first.sets);
  assert.equal(afterSwap.pending.plan[0].reps, first.reps);
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
  const adjusted = describeWorkout(db, { id, plan: [{ id: exercise, sets: 2, reps: 7 }] });
  assert.deepEqual(adjusted.prefill, { kg: 10.5, reps: 7 });
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
  const [strengthStatus, strength] = await request('/api/strength');
  assert.equal(strengthStatus, 200);
  assert.equal(strength.cards[firstExercise].change, null);
  assert.equal(strength.ranges.all.latest, null);
  const [ , detail] = await request('/api/workout/' + id);
  assert.deepEqual(detail, result.summary);
  assert.ok(detail.started <= detail.finished);
  assert.equal(detail.finished - detail.started, detail.duration);
  assert.equal(result.progress.history[0].started, detail.started);
  assert.equal(result.progress.history[0].finished, detail.finished);
});
