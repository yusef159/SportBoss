import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { byId, catalog, equipment, kinds, swapPrescription } from './lib/catalog.mjs';
import { candidates, durationOptions, selectPlan, swapOptions } from './lib/planner.mjs';
import { startReminders } from './reminders.mjs';
import { strengthProgression } from './lib/strength-progression.mjs';
import {
  awardWeeklyGoal, completedWorkouts, describeWorkout, exerciseTrend, getSettings, openDatabase,
  overview, pendingWorkout, saveSettings, summary, transaction, workoutById,
} from './lib/storage.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest();
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
function json(response, code, body, additional) {
  response.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...additional });
  response.end(JSON.stringify(body));
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) fail('Expected JSON.', 415);
  let input = '';
  for await (const chunk of request) {
    input += chunk;
    if (input.length > 16000) fail('Request is too large.', 413);
  }
  try {
    const body = JSON.parse(input);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* Use the same response for malformed and unexpected JSON. */ }
  fail('Invalid JSON.');
}
const isInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isKind = value => Object.hasOwn(kinds, value);
const phaseWorkout = (db, id, started) => {
  const workout = pendingWorkout(db);
  if (!workout || workout.id !== id || Boolean(workout.started) !== started) {
    fail('This workout changed. Refresh and try again.', 409);
  }
  return workout;
};

async function api(db, request, path, typesafeKey, appState) {
  if (request.method === 'GET') {
    if (path === '/api/overview') return overview(db);
    if (path === '/api/catalog') return catalog;
    if (path === '/api/strength') return strengthProgression(db);
    if (path.startsWith('/api/trend/')) {
      const id = path.slice('/api/trend/'.length);
      if (!byId.has(id)) fail('Exercise not found.', 404);
      return exerciseTrend(db, id);
    }
    const match = /^\/api\/workout\/(\d+)$/.exec(path);
    if (match) {
      const workout = workoutById(db, Number(match[1]));
      if (!workout?.finished) fail('Workout not found.', 404);
      return summary(db, workout);
    }
    fail('Page not found.', 404);
  }
  if (request.method !== 'POST') fail('Method not allowed.', 405);
  const origin = request.headers.origin;
  if (request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && !['http://' + request.headers.host, 'https://' + request.headers.host].includes(origin))) {
    fail('Cross-site requests are blocked.', 403);
  }
  const data = await readBody(request);
  if (path === '/api/reset-data') {
    if (data.confirm !== true) fail('Confirm that you want to reset your training data.');
    const result = transaction(db, () => {
      db.exec('DELETE FROM workouts; DELETE FROM preferences; DELETE FROM weekly_goal_achievements;');
      return overview(db);
    });
    appState.resetVersion++;
    return result;
  }
  if (path === '/api/settings') {
    const { split, gear, goal, rest, duration } = data;
    if (!['alternate', 'full'].includes(split) || !Array.isArray(gear) || !gear.includes('Bodyweight') ||
        gear.some(item => !equipment.includes(item)) || !isInteger(goal, 1, 7) || !isInteger(rest, 15, 180) ||
        (duration !== undefined && !durationOptions.includes(duration))) {
      fail('Check your training preferences.');
    }
    return transaction(db, () => {
      const active = pendingWorkout(db);
      if (active && active.plan.some(item => !byId.get(item.id)?.gear.every(piece => gear.includes(piece)))) {
        fail('Your current workout uses equipment you deselected.', 409);
      }
      const settings = getSettings(db);
      saveSettings(db, { ...settings, split, gear: equipment.filter(item => gear.includes(item)), goal, rest,
        duration: duration ?? settings.duration });
      const now = Date.now();
      const weeklyGoalReached = awardWeeklyGoal(db, goal, now);
      return { ...overview(db, now), weeklyGoalReached };
    });
  }
  if (path === '/api/exercise-preference') {
    if (!byId.has(data.id) || typeof data.excluded !== 'boolean') fail('Select a valid exercise and routine preference.');
    return transaction(db, () => {
      const settings = getSettings(db);
      const excluded = new Set(settings.excluded);
      if (data.excluded) excluded.add(data.id);
      else excluded.delete(data.id);
      saveSettings(db, { ...settings, excluded: [...excluded].sort() });
      return overview(db);
    });
  }
  if (path === '/api/generate') {
    if (!isKind(data.kind)) fail('Select a workout type.');
    if (pendingWorkout(db)) return overview(db);
    const { resetVersion } = appState;
    const settings = getSettings(db);
    const history = completedWorkouts(db);
    let proposals;
    try { proposals = candidates(data.kind, settings.gear, history, settings.excluded, settings); }
    catch (error) { fail(error.message, 422); }
    const { plan, source, review } = await selectPlan(data.kind, settings.gear, proposals, typesafeKey);
    return transaction(db, () => {
      if (appState.resetVersion !== resetVersion) fail('Training data was reset. Generate again.', 409);
      if (pendingWorkout(db)) return overview(db);
      const current = getSettings(db);
      if (current.gear.join() !== settings.gear.join() || current.excluded.join() !== settings.excluded.join() ||
          current.duration !== settings.duration || current.rest !== settings.rest ||
          completedWorkouts(db)[0]?.id !== history[0]?.id) {
        fail('Training preferences or history changed. Generate again.', 409);
      }
      const { lastInsertRowid } = db.prepare('INSERT INTO workouts(kind, plan, source) VALUES(?, ?, ?)')
        .run(data.kind, JSON.stringify(plan), source);
      db.prepare('INSERT INTO workout_reviews VALUES(?, ?)').run(lastInsertRowid, JSON.stringify(review));
      return overview(db);
    });
  }
  if (path === '/api/swaps' || path === '/api/swap') {
    return transaction(db, () => {
      const workout = phaseWorkout(db, data.id, false);
      if (!isInteger(data.index, 0, workout.plan.length - 1) || workout.plan[data.index].id !== data.from) {
        fail('This exercise changed. Refresh and try again.', 409);
      }
      const { gear, excluded } = getSettings(db);
      const options = swapOptions(workout.kind, workout.plan, data.index, gear, completedWorkouts(db), excluded);
      if (path === '/api/swaps') return options;
      const replacement = options.find(exercise => exercise.id === data.exercise);
      if (!replacement) fail('Select a compatible replacement.');
      workout.plan[data.index] = swapPrescription(workout.plan[data.index], replacement);
      db.prepare('UPDATE workouts SET plan=? WHERE id=?').run(JSON.stringify(workout.plan), workout.id);
      const saved = db.prepare('SELECT content FROM workout_reviews WHERE workout=?').get(workout.id);
      const review = saved ? JSON.parse(saved.content) : {};
      db.prepare('INSERT OR REPLACE INTO workout_reviews VALUES(?, ?)').run(workout.id, JSON.stringify({ ...review, modified: true }));
      return overview(db);
    });
  }
  if (path === '/api/start' || path === '/api/discard' || path === '/api/skip-rest') {
    return transaction(db, () => {
      const workout = pendingWorkout(db);
      if (!workout || workout.id !== data.id) fail('This workout changed. Refresh and try again.', 409);
      if (path === '/api/start' && !workout.started) {
        const { excluded } = getSettings(db);
        if (workout.plan.some(item => excluded.includes(item.id))) fail('Swap or restore excluded exercises before starting.', 409);
        db.prepare('UPDATE workouts SET started=? WHERE id=?').run(Date.now(), workout.id);
      }
      if (path === '/api/skip-rest' && workout.rest_until === data.until) {
        db.prepare('UPDATE workouts SET rest_until=NULL WHERE id=?').run(workout.id);
      }
      if (path === '/api/discard') db.prepare('DELETE FROM workouts WHERE id=?').run(workout.id);
      return overview(db);
    });
  }
  if (path === '/api/set') {
    return transaction(db, () => {
      const { id, ordinal, kg, reps } = data;
      const workout = workoutById(db, isInteger(id, 1, Number.MAX_SAFE_INTEGER) ? id : 0);
      if (!workout?.started || !isInteger(ordinal, 0, 100) || typeof kg !== 'number' ||
          !isInteger(kg * 2, 0, 600) || !isInteger(reps, 1, 600)) fail('Check your set details.');
      const detail = describeWorkout(db, workout);
      if (ordinal < detail.sets.length) {
        const already = detail.sets[ordinal];
        if (already.kg !== kg || already.reps !== reps) fail('This set has already been recorded.', 409);
        return { ...overview(db), summary: workout.finished ? summary(db, workout) : null };
      }
      if (!detail.next || ordinal !== detail.sets.length) fail('This workout changed. Refresh and try again.', 409);
      const exercise = byId.get(detail.next.id);
      if ((!exercise.timed && reps > 100) || (exercise.gear.includes('Bodyweight') && kg !== 0)) fail('Check your set details.');
      const now = Date.now();
      if (workout.rest_until > now) fail('Finish or skip the rest timer first.', 409);
      db.prepare('INSERT INTO sets VALUES(?, ?, ?, ?, ?)').run(id, ordinal, exercise.id, kg, reps);
      const done = ordinal + 1 === detail.totalSets;
      const { goal, rest } = getSettings(db);
      db.prepare('UPDATE workouts SET finished=?, rest_until=? WHERE id=?').run(
        done ? now : null, done ? null : now + rest * 1000, id,
      );
      const weeklyGoalReached = done && awardWeeklyGoal(db, goal, now);
      return { ...overview(db, now), weeklyGoalReached, summary: done ? summary(db, workoutById(db, id)) : null };
    });
  }
  fail('Page not found.', 404);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
export function createApp({ dataDir, username = 'form', password, typesafeKey = '', reminderEnv } = {}) {
  const db = openDatabase(dataDir);
  const credential = password ? digest('Basic ' + Buffer.from(username + ':' + password).toString('base64')) : null;
  const appState = { resetVersion: 0 };
  const server = createServer((request, response) => serve(db, request, response, credential, typesafeKey, appState));
  let stopReminders;
  if (reminderEnv) {
    server.once('listening', () => {
      try {
        stopReminders = startReminders(db, reminderEnv);
      } catch (error) {
        console.error('Telegram reminders disabled:', error.message);
      }
    });
  }
  server.once('close', async () => {
    const pending = stopReminders?.();
    if (pending) await pending;
    db.close();
  });
  return server;
}
async function serve(db, request, response, credential, typesafeKey, appState) {
  try {
    const path = new URL(request.url, 'http://app.invalid').pathname;
    if (path === '/healthz' && request.method === 'GET') {
      db.prepare('SELECT 1 FROM workouts LIMIT 1').get();
      return json(response, 200, { ok: true });
    }
    if (credential && !timingSafeEqual(credential, digest(request.headers.authorization || ''))) {
      return json(response, 401, { error: 'Sign in to SportBoss.' }, { 'WWW-Authenticate': 'Basic realm="SportBoss", charset="UTF-8"' });
    }
    if (path.startsWith('/api/')) {
      const result = await api(db, request, path, typesafeKey, appState);
      if (result.settings) result.aiConfigured = Boolean(typesafeKey);
      return json(response, 200, result);
    }
    if (!['GET', 'HEAD'].includes(request.method)) fail('Method not allowed.', 405);
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (!/^(?:index\.html|app\.js|styles\.css|hero\.jpg|sportboss\.svg|[a-z-]+\.woff2|exercises\/[a-z0-9-]+\.jpg)$/.test(name)) fail('Page not found.', 404);
    const file = join(root, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) fail('Page not found.', 404);
    response.writeHead(200, {
      ...headers, 'Content-Type': mimeTypes[extname(file)], 'Content-Length': info.size,
      'Cache-Control': name.endsWith('.jpg') ? 'private, max-age=86400' : 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    if (!error.status) console.error(error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Try again.' });
    else response.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const password = process.env.APP_PASSWORD;
  if (!password && !['127.0.0.1', '::1', 'localhost'].includes(host) && process.env.ALLOW_UNAUTHENTICATED !== '1') {
    throw new Error('A non-loopback bind requires APP_PASSWORD or ALLOW_UNAUTHENTICATED=1.');
  }
  const server = createApp({
    username: process.env.APP_USER, password, typesafeKey: process.env.TYPESAFE_API_KEY,
    reminderEnv: process.env,
  });
  server.listen(Number(process.env.PORT || 8787), host, () => {
    console.log('SportBoss is ready at http://' + host + ':' + server.address().port + ' (data: ' + resolve(process.env.DATA_DIR || 'data') + ')');
  });
}
