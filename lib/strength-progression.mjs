import { byId } from './catalog.mjs';
import { localTime, offsetDay, strength } from './storage.mjs';

const ranges = { '30d': 30, '90d': 90, '1y': 365, all: null };
const regions = ['overall', 'upper', 'lower'];
const percent = (value, baseline) => 100 * (value / baseline - 1);
const rounded = value => Math.round(value * 10) / 10;

function comparison(set, exercise) {
  if (exercise.timed) return { key: 'hold:' + set.kg, value: set.reps, method: 'hold' };
  if (!set.kg) return { key: 'reps', value: set.reps, method: 'reps' };
  if (set.reps <= 12) return { key: 'estimate', value: strength(set, false), method: 'estimate' };
  return { key: 'matched:' + set.reps, value: set.kg, method: 'matched' };
}

function sample(points, limit, keep = []) {
  if (points.length <= limit) return points;
  const indexes = new Set(keep);
  for (let i = 0; i < limit; i++) indexes.add(Math.round(i * (points.length - 1) / (limit - 1)));
  return [...indexes].sort((a, b) => a - b).map(index => points[index]);
}

function peakIndexes(points, value) {
  let min = -1;
  let max = -1;
  for (let index = 0; index < points.length; index++) {
    const score = value(points[index]);
    if (score == null) continue;
    if (min < 0 || score < value(points[min])) min = index;
    if (max < 0 || score > value(points[max])) max = index;
  }
  return [min, max].filter(index => index >= 0);
}

function collectSessions(rows) {
  const exercises = new Map();
  for (const row of rows) {
    const exercise = byId.get(row.exercise);
    if (!exercise || !Number.isFinite(row.kg) || row.kg < 0 || !Number.isInteger(row.reps) || row.reps <= 0) continue;
    const { key, value, method } = comparison(row, exercise);
    if (!exercises.has(row.exercise)) exercises.set(row.exercise, { exercise, tracks: new Map() });
    const entry = exercises.get(row.exercise);
    entry.lastPerformed = row.finished;
    if (!entry.tracks.has(key)) entry.tracks.set(key, { method, sessions: [] });
    const { sessions } = entry.tracks.get(key);
    const previous = sessions.at(-1);
    if (previous?.id === row.id && previous.value >= value) continue;
    if (previous?.id === row.id) sessions.pop();
    sessions.push({ id: row.id, finished: row.finished, kg: row.kg, reps: row.reps, value });
  }
  return exercises;
}

function preferredTrack(tracks) {
  return [...tracks.values()].sort((a, b) => {
    const latestA = a.sessions.at(-1);
    const latestB = b.sessions.at(-1);
    return Number(b.sessions.length > 1) - Number(a.sessions.length > 1) ||
      latestB.finished - latestA.finished || latestB.id - latestA.id ||
      Number(b.method === 'estimate') - Number(a.method === 'estimate') ||
      b.sessions.length - a.sessions.length;
  })[0];
}

function rangeTrend(entries, from) {
  const counts = { overall: 0, upper: 0, lower: 0 };
  const sums = { ...counts };
  const observed = new Set();
  const events = new Map();
  let improved = 0;
  const add = (day, scope, delta) => {
    if (!events.has(day)) events.set(day, {});
    const deltas = events.get(day);
    deltas[scope] = (deltas[scope] ?? 0) + delta;
  };
  for (const { exercise, sessions } of entries) {
    const firstInRange = from ? sessions.findIndex(point => point.day >= from) : 0;
    if (firstInRange === -1) continue;
    const baseline = sessions[Math.max(0, firstInRange - 1)];
    const start = Math.max(1, firstInRange);
    if (start >= sessions.length) continue;
    const scopes = exercise.region === 'core' ? ['overall'] : ['overall', exercise.region];
    const latest = sessions.at(-1);
    if (rounded(percent(latest.value, baseline.value)) > 0) improved++;
    for (const scope of scopes) {
      counts[scope]++;
      add(from && baseline.day < from ? from : baseline.day, scope, 0);
      let prior = 0;
      for (let i = start; i < sessions.length; i++) {
        const point = sessions[i];
        const change = percent(point.value, baseline.value);
        add(point.day, scope, change - prior);
        prior = change;
      }
    }
  }
  // A fixed denominator keeps rotation and new baselines from moving the line.
  // Missing sessions emit no change, so previously measured progress carries forward.
  const points = [...events.keys()].sort().map(day => {
    for (const [scope, delta] of Object.entries(events.get(day))) {
      sums[scope] += delta;
      observed.add(scope);
    }
    return { day, ...Object.fromEntries(regions.map(scope =>
      [scope, observed.has(scope) ? rounded(sums[scope] / counts[scope]) : null])) };
  });
  return {
    counts, improved, latest: points.at(-1) ?? null,
    points: sample(points, 60, regions.flatMap(scope => [
      ...peakIndexes(points, point => point[scope]),
      points.findIndex(point => point[scope] != null),
    ]).filter(index => index >= 0)),
  };
}

export function strengthProgression(db, now = Date.now()) {
  const rows = db.prepare(
    'SELECT w.id, w.finished, s.exercise, s.kg, s.reps FROM sets s JOIN workouts w ON w.id=s.workout ' +
    'WHERE w.finished <= ? ORDER BY w.finished, w.id, s.ordinal'
  ).iterate(now);
  const days = new Map();
  const dayOf = finished => {
    if (!days.has(finished)) days.set(finished, localTime(finished).day);
    return days.get(finished);
  };
  const cards = {};
  const entries = [];
  for (const [id, { exercise, tracks, lastPerformed }] of collectSessions(rows)) {
    const { method, sessions } = preferredTrack(tracks);
    for (const session of sessions) session.day = dayOf(session.finished);
    const first = sessions[0];
    const latest = sessions.at(-1);
    entries.push({ exercise, sessions });
    cards[id] = {
      method, lastPerformed, first: { kg: first.kg, reps: first.reps },
      current: { kg: latest.kg, reps: latest.reps, finished: latest.finished },
      change: sessions.length > 1 ? rounded(percent(latest.value, first.value)) : null,
      points: sample(sessions, 24, peakIndexes(sessions, point => point.value))
        .map(point => [point.finished, rounded(percent(point.value, first.value))]),
    };
  }
  const today = dayOf(now);
  return {
    cards, ranges: Object.fromEntries(Object.entries(ranges).map(([key, days]) =>
      [key, rangeTrend(entries, days ? offsetDay(today, 1 - days) : null)])),
  };
}
