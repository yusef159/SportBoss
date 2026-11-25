import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { byId } from './catalog.mjs';
import { defaults, durationOptions, estimatedMinutes, rotation, recommendation, standardEstimates } from './planner.mjs';

export const zone = 'Asia/Jerusalem';
const israelClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function localTime(now = Date.now()) {
  const parts = Object.fromEntries(israelClock.formatToParts(now).map(part => [part.type, part.value]));
  return { day: parts.year + '-' + parts.month + '-' + parts.day, time: parts.hour + ':' + parts.minute };
}
export function offsetDay(day, offset) {
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}
export function openDatabase(location = process.env.DATA_DIR || 'data') {
  mkdirSync(location, { recursive: true });
  const db = new DatabaseSync(resolve(location, 'fitness.sqlite'));
  db.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;" +
    "CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, plan TEXT NOT NULL," +
    " source TEXT NOT NULL, started INTEGER, finished INTEGER, rest_until INTEGER);" +
    "CREATE UNIQUE INDEX IF NOT EXISTS single_pending ON workouts((1)) WHERE finished IS NULL;" +
    "CREATE TABLE IF NOT EXISTS sets (workout INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE," +
    " ordinal INTEGER NOT NULL, exercise TEXT NOT NULL, kg REAL NOT NULL, reps INTEGER NOT NULL," +
    " PRIMARY KEY(workout, ordinal));" +
    "CREATE INDEX IF NOT EXISTS exercise_sets ON sets(exercise, workout);" +
    "CREATE TABLE IF NOT EXISTS workout_reviews (workout INTEGER PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE, content TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS reminders (day TEXT PRIMARY KEY, state TEXT NOT NULL, attempted INTEGER NOT NULL);"
  );
  return db;
}
export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
const unpack = row => row && { ...row, plan: JSON.parse(row.plan) };
export const getSettings = db => ({ ...defaults, ...JSON.parse(db.prepare('SELECT content FROM preferences WHERE id=1').get()?.content || '{}') });
export function saveSettings(db, settings) {
  db.prepare('INSERT OR REPLACE INTO preferences VALUES(1, ?)').run(JSON.stringify(settings));
}
export const completedWorkouts = db => db.prepare('SELECT * FROM workouts WHERE finished IS NOT NULL ORDER BY finished DESC, id DESC').all().map(unpack);
export const pendingWorkout = db => unpack(db.prepare('SELECT * FROM workouts WHERE finished IS NULL').get());
export const workoutById = (db, id) => unpack(db.prepare('SELECT * FROM workouts WHERE id=?').get(id));
const setsFor = (db, id) => db.prepare('SELECT ordinal, exercise, kg, reps FROM sets WHERE workout=? ORDER BY ordinal').all(id);
export const strength = (set, timed) => {
  if (timed || set.kg === 0) return set.reps;
  return set.kg * (1 + (Math.min(set.reps, 30) - 1) / 30);
};

export function describeWorkout(db, workout) {
  if (!workout) return null;
  const sets = setsFor(db, workout.id);
  const schedule = workout.plan.flatMap(item => Array.from({ length: item.sets }, (_, index) => ({ ...item, set: index + 1 })));
  const next = schedule[sets.length];
  const previousSets = next ? db.prepare(
    'SELECT s.kg, s.reps FROM sets s WHERE s.exercise=? AND s.workout=(' +
    'SELECT w.id FROM workouts w JOIN sets prior ON w.id=prior.workout WHERE prior.exercise=? AND w.finished IS NOT NULL ' +
    'ORDER BY w.finished DESC, w.id DESC LIMIT 1) ORDER BY s.ordinal'
  ).all(next.id, next.id) : [];
  const previous = previousSets.at(-1);
  const priorSet = next && sets.findLast(set => set.exercise === next.id);
  const recent = priorSet ?? previous;
  const repTarget = next && (previousSets[next.set - 1] ?? recent);
  const review = db.prepare('SELECT content FROM workout_reviews WHERE workout=?').get(workout.id);
  return {
    ...workout, sets, totalSets: schedule.length, next: next || null,
    estimatedMinutes: estimatedMinutes(workout.plan.length, schedule.length, getSettings(db).rest),
    previous: previous ?? null, prefill: recent ? { kg: recent.kg, reps: repTarget.reps } : null,
    review: review ? JSON.parse(review.content) : null,
  };
}

export function progress(db, settings, completed) {
  const today = localTime().day;
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
  const monday = offsetDay(today, -(weekday + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index) => offsetDay(monday, index));
  const counts = new Map();
  const history = completed.map(({ id, kind, started, finished, plan }) => {
    const day = localTime(finished).day;
    counts.set(day, (counts.get(day) || 0) + 1);
    return { id, kind, day, started, finished, duration: finished - started, count: plan.length };
  });
  const coverage = rotation(settings.gear, completed, settings.excluded);
  const records = new Map();
  const metricValue = item => strength(item, byId.get(item.exercise)?.timed);
  for (const item of db.prepare(
    'SELECT s.exercise, s.kg, s.reps, w.finished FROM sets s JOIN workouts w ON w.id=s.workout ' +
    'WHERE w.finished IS NOT NULL ORDER BY w.finished, w.id, s.ordinal'
  ).iterate()) {
    const exercise = byId.get(item.exercise);
    if (!exercise) continue;
    const key = item.exercise + (item.kg ? '-weighted' : '-unweighted');
    if (!records.has(key) || metricValue(item) > metricValue(records.get(key))) records.set(key, item);
  }
  return {
    today, week: days.map(day => ({ day, count: counts.get(day) || 0 })),
    history, records: [...records.values()].sort((a, b) => b.finished - a.finished)
      .map(item => ({ ...item, day: localTime(item.finished).day })),
    rotation: Object.fromEntries(Object.entries(coverage).map(([scope, state]) => [
      scope, { total: state.total, used: [...state.used], cycles: state.cycles },
    ])),
  };
}

export function overview(db) {
  const settings = getSettings(db);
  const completed = completedWorkouts(db);
  return {
    settings, recommendation: recommendation(settings, completed), durationOptions, standardEstimates: standardEstimates(settings.rest),
    pending: describeWorkout(db, pendingWorkout(db)), progress: progress(db, settings, completed),
  };
}

export function exerciseTrend(db, exerciseId) {
  const exercise = byId.get(exerciseId);
  const points = new Map();
  for (const row of db.prepare(
    'SELECT w.id, w.finished, s.kg, s.reps FROM sets s JOIN workouts w ON s.workout=w.id ' +
    'WHERE s.exercise=? AND w.finished IS NOT NULL ORDER BY w.finished, w.id, s.ordinal'
  ).iterate(exerciseId)) {
    const metric = row.kg && !exercise.timed ? 'kg' : (exercise.timed ? 'seconds' : 'reps');
    const value = strength(row, exercise.timed);
    const key = row.id + '/' + metric;
    if (!points.has(key) || points.get(key).value < value) {
      points.set(key, { day: localTime(row.finished).day, value: Math.round(value * 10) / 10, metric, kg: row.kg, reps: row.reps });
    }
  }
  return [...points.values()].slice(-20);
}

export function summary(db, workout) {
  const sets = setsFor(db, workout.id);
  const achievements = [];
  for (const { id } of workout.plan) {
    const exercise = byId.get(id);
    if (!exercise) continue;
    const past = db.prepare(
      'SELECT s.kg, s.reps, w.id FROM sets s JOIN workouts w ON w.id=s.workout ' +
      'WHERE s.exercise=? AND w.finished IS NOT NULL AND (w.finished < ? OR (w.finished = ? AND w.id < ?)) ' +
      'ORDER BY w.finished DESC, w.id DESC'
    ).all(id, workout.finished, workout.finished, workout.id);
    for (const weighted of [false, true]) {
      const matching = sets.filter(set => set.exercise === id && Boolean(set.kg) === weighted);
      if (!matching.length) continue;
      const previous = past.filter(set => Boolean(set.kg) === weighted);
      const value = set => strength(set, exercise.timed);
      const best = Math.max(...matching.map(value));
      const recent = Math.max(0, ...previous.filter(set => set.id === previous[0]?.id).map(value));
      const record = previous.reduce((maximum, set) => Math.max(maximum, value(set)), 0);
      if (best > recent + 0.01) {
        achievements.push({ id, kind: !previous.length ? 'Baseline set' : best > record + 0.01 ? 'Personal record' : 'Improved',
          gain: previous.length ? Math.round((best - recent) * 10) / 10 : null,
          unit: exercise.timed ? 'sec' : weighted ? 'kg est. 1RM' : 'reps' });
      }
    }
  }
  return {
    id: workout.id, kind: workout.kind, started: workout.started, finished: workout.finished,
    duration: workout.finished - workout.started,
    count: workout.plan.length, sets: sets.length, achievements,
    exercises: workout.plan.map(({ id }) => ({ id, sets: sets.filter(set => set.exercise === id).map(({ kg, reps }) => ({ kg, reps })) })),
  };
}
