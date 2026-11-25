import { byId, eligible, inScope, prescribe } from './catalog.mjs';

export const durationOptions = [0, 30, 40, 50, 60, 75];
export const defaults = { split: 'alternate', gear: ['Bodyweight', 'Dumbbells', 'Bench'], goal: 3, rest: 60, duration: 0, excluded: [] };
const templates = {
  upper: [
    ['upper','push'], ['upper','pull'], ['upper','shoulder','arm','grip'],
    ['upper','shoulder','arm','grip'], ['upper','core'],
  ],
  lower: [
    ['lower','knee'], ['lower','hip'], ['lower','leg','knee','hip'],
    ['lower','leg','knee','hip'], ['lower','core'],
  ],
  full: [
    ['upper','push'], ['lower','knee'], ['upper','pull'], ['lower','hip'],
    ['upper','shoulder','arm','grip'], ['lower','core','leg'],
  ],
};
const extraSlots = {
  upper: [
    ['upper','push','pull'], ['upper','shoulder','arm','grip','core'],
    ['upper','push','pull'], ['upper','shoulder','arm','grip','core'],
  ],
  lower: [
    ['lower','knee','hip','leg'], ['lower','hip','leg','core'],
    ['lower','knee','hip','leg'], ['lower','hip','leg','core'],
  ],
  full: [
    ['upper','push','pull','shoulder','arm','grip'], ['lower','knee','hip','leg'],
    ['upper','push','pull','shoulder','arm','grip'], ['lower','knee','hip','leg'],
  ],
};

function estimatedSeconds(exercises, sets, rest) {
  // Allow five minutes to warm up, 90 seconds per exercise to set up, and 45 seconds per working set.
  return 300 + exercises * 90 + sets * 45 + Math.max(0, sets - 1) * rest;
}
export function estimatedMinutes(exercises, sets, rest) {
  return Math.round(estimatedSeconds(exercises, sets, rest) / 60);
}
export function standardEstimates(rest) {
  return Object.fromEntries(Object.entries(templates).map(([kind, slots]) =>
    [kind, estimatedMinutes(slots.length, slots.length * 3, rest)]));
}
function volumeFor(exercises, targetMinutes, rest) {
  if (!targetMinutes) return { sets: exercises * 3, cost: 0 };
  let best = { cost: Infinity };
  for (let sets = exercises * 2; sets <= exercises * 4; sets++) {
    const timeError = Math.abs(estimatedSeconds(exercises, sets, rest) - targetMinutes * 60);
    const cost = timeError + Math.abs(sets / exercises - 3) * 120;
    if (cost < best.cost) best = { sets, cost };
  }
  return best;
}

export function recommendation(settings, completed) {
  if (settings.split === 'full') return 'full';
  const lastSplit = completed.find(workout => workout.kind !== 'full');
  return lastSplit?.kind === 'upper' ? 'lower' : 'upper';
}

export function rotation(gear, completed, excluded = []) {
  const pool = eligible(gear, excluded);
  return Object.fromEntries(['upper','lower'].map(scope => {
    const ids = new Set(pool.filter(exercise => inScope(scope, exercise)).map(exercise => exercise.id));
    const used = new Set();
    const last = new Map();
    let cycles = 0;
    for (const [index, workout] of [...completed].reverse().entries()) {
      if (workout.kind !== scope && workout.kind !== 'full') continue;
      for (const { id } of workout.plan) {
        if (!ids.has(id)) continue;
        used.add(id);
        last.set(id, index);
      }
      if (ids.size && used.size === ids.size) {
        cycles++;
        used.clear();
      }
    }
    return [scope, { total: ids.size, used, last, cycles }];
  }));
}
function slots(kind, gear, excluded) {
  const pool = eligible(gear, excluded);
  return [...templates[kind], ...extraSlots[kind]].map(([scope, ...buckets]) => ({
    scope,
    choices: pool.filter(exercise => inScope(scope, exercise) && buckets.includes(exercise.bucket)),
  }));
}
function novelty(exercise, scope, coverage, kind) {
  const primary = Number(!coverage[scope].used.has(exercise.id));
  if (kind !== 'full' || exercise.region !== 'core') return primary;
  const other = scope === 'upper' ? 'lower' : 'upper';
  return primary + Number(!coverage[other].used.has(exercise.id));
}
function ranked(slot, coverage, kind, used = new Set()) {
  const { scope, choices } = slot;
  const progress = coverage[scope];
  return choices.filter(exercise => !used.has(exercise.id)).sort((a, b) =>
    novelty(b, scope, coverage, kind) - novelty(a, scope, coverage, kind) ||
    (progress.last.get(a.id) ?? -1) - (progress.last.get(b.id) ?? -1) ||
    a.name.localeCompare(b.name));
}

export function candidates(kind, gear, completed, excluded = [], { duration = 0, rest = defaults.rest } = {}) {
  const coverage = rotation(gear, completed, excluded);
  const baseCount = templates[kind].length;
  const available = slots(kind, gear, excluded);
  const spec = duration ? available : available.slice(0, baseCount);
  if (spec.slice(0, baseCount).some(slot => !slot.choices.length)) {
    throw new Error('This workout is missing a movement pattern. Restore exercises in the library or update your equipment in Settings.');
  }
  let beam = [{ plan: [], score: 0, unseen: 0, used: new Set() }];
  let selected;
  for (const [index, slot] of spec.entries()) {
    const next = [];
    for (const candidate of beam) {
      const ordered = ranked(slot, coverage, kind, candidate.used);
      const bestByBucket = new Map();
      for (const exercise of ordered) {
        if (!bestByBucket.has(exercise.bucket)) bestByBucket.set(exercise.bucket, exercise);
      }
      const options = new Set([...bestByBucket.values(), ...ordered.slice(0, 8)]);
      for (const exercise of options) {
        const overlaps = candidate.plan.filter(item => byId.get(item.id).bucket === exercise.bucket).length;
        const repeatMuscle = candidate.plan.filter(item => byId.get(item.id).muscle === exercise.muscle).length;
        const orderPenalty = Math.min(ordered.indexOf(exercise), 8) * 2;
        const repeats = overlaps * 22 + repeatMuscle * 12;
        const unseen = candidate.unseen + novelty(exercise, slot.scope, coverage, kind);
        const plan = [...candidate.plan, prescribe(exercise)];
        next.push({ plan, score: candidate.score - repeats - orderPenalty, unseen, used: new Set([...candidate.used, exercise.id]) });
      }
    }
    beam = next.sort((a, b) => (b.score + 34*b.unseen) - (a.score + 34*a.unseen)).slice(0, 48);
    if (!beam.length) break;
    const exerciseCount = index + 1;
    if (exerciseCount >= baseCount) {
      const volume = volumeFor(exerciseCount, duration, rest);
      if (!selected || volume.cost < selected.volume.cost) selected = { beam, volume };
    }
  }
  if (!selected) throw new Error('Too few distinct exercises are available. Restore exercises in the library or update your equipment in Settings.');
  beam = selected.beam;
  const best = beam[0];
  const alternatives = [best];
  const signatures = new Set([[...best.used].sort().join('|')]);
  for (const item of beam) {
    if (item.unseen !== best.unseen || item.score < best.score - 8) continue;
    const signature = [...item.used].sort().join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    alternatives.push(item);
    if (alternatives.length === 4) break;
  }
  const { sets } = selected.volume;
  return alternatives.map(({ plan }) => plan.map((exercise, index) => ({
    ...exercise, sets: Math.floor(sets / plan.length) + Number(index < sets % plan.length),
  })));
}

export function swapOptions(kind, plan, index, gear, completed, excluded = []) {
  const spec = slots(kind, gear, excluded);
  const used = new Set(plan.map(item => item.id));
  return ranked(spec[index], rotation(gear, completed, excluded), kind, used)
    .filter(exercise => {
      const current = byId.get(plan[index].id);
      const others = plan.filter((_, position) => position !== index).map(item => byId.get(item.id));
      const count = bucket => others.filter(item => item.bucket === bucket).length;
      return count(exercise.bucket) <= count(current.bucket);
    });
}

export async function selectPlan(kind, gear, plans, key = process.env.TYPESAFE_API_KEY, request = fetch) {
  const fallback = review => ({ plan: plans[0], source: 'rules', review });
  if (!key) return fallback({ status: 'disabled' });
  const questions = {};
  for (const index of plans.keys()) {
    questions['balance' + index] = { type: 'noul', instructions: 'Does candidate ' + index + ' distribute muscular work well for the requested session?' };
    questions['compatibility' + index] = { type: 'noul', instructions: 'Can candidate ' + index + ' be performed with the listed equipment?' };
  }
  const state = {
    session: kind, equipment: gear,
    candidates: plans.map((plan, index) => ({
      index,
      exercises: plan.map(({ id, sets, reps }) => {
        const { name, muscle, pattern, gear, timed } = byId.get(id);
        return { name, muscle, pattern, gear, sets, target: reps, unit: timed ? 'seconds' : 'reps' };
      }),
    })),
  };
  try {
    const response = await request('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: process.env.TYPESAFE_MODEL || 'jev-latest', state, questions }),
    });
    if (!response.ok) throw new Error('Evaluation unavailable');
    const { answers, model } = await response.json();
    const probability = name => {
      const answer = answers?.[name];
      return answer?.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1
        ? answer.noul : null;
    };
    const scores = plans.map((_, index) => ({
      index, balance: probability('balance' + index), compatibility: probability('compatibility' + index),
    }));
    if (scores.some(score => score.balance === null || score.compatibility === null)) {
      return fallback({ status: 'unavailable' });
    }
    const selection = scores.filter(score => score.balance >= .7 && score.compatibility >= .85)
      .sort((a, b) => b.balance - a.balance || b.compatibility - a.compatibility)[0];
    const review = { model: typeof model === 'string' ? model : null, scores, selected: selection?.index ?? 0 };
    if (selection) return { plan: plans[selection.index], source: 'jev', review: { ...review, status: 'selected' } };
    return fallback({ ...review, status: 'below-threshold' });
  } catch {
    // A provider error leaves the deterministic workout available.
  }
  return fallback({ status: 'unavailable' });
}
