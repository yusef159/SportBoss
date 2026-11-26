import { byId, eligible, inScope, prescribe } from './catalog.mjs';

export const durationOptions = [0, 30, 40, 50, 60, 75];
export const defaults = { split: 'alternate', gear: ['Bodyweight', 'Dumbbells', 'Bench'], goal: 3, rest: 60, duration: 0, excluded: [] };
const requiredMuscles = {
  upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Abs'],
  lower: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'],
};
const legacySlots = {
  upper: [
    ['upper','push'], ['upper','pull'], ['upper','shoulder','arm','grip'],
    ['upper','shoulder','arm','grip'], ['upper','core'],
    ['upper','push','pull'], ['upper','shoulder','arm','grip','core'],
    ['upper','push','pull'], ['upper','shoulder','arm','grip','core'],
  ],
  lower: [
    ['lower','knee'], ['lower','hip'], ['lower','leg','knee','hip'],
    ['lower','leg','knee','hip'], ['lower','core'],
    ['lower','knee','hip','leg'], ['lower','hip','leg','core'],
    ['lower','knee','hip','leg'], ['lower','hip','leg','core'],
  ],
};
const templates = {
  upper: requiredMuscles.upper.map(muscle => ['upper', muscle]),
  lower: requiredMuscles.lower.map(muscle => ['lower', muscle]),
  full: [
    ['upper','push'], ['lower','knee'], ['upper','pull'], ['lower','hip'],
    ['upper','shoulder','arm','grip'], ['lower','core','leg'],
  ],
};
const extraSlots = {
  upper: [
    ['upper','push','pull','shoulder','arm','grip','core'],
    ['upper','push','pull'], ['upper','shoulder','arm','grip','core'],
  ],
  lower: [
    ['lower','knee','hip','leg','core'], ['lower','hip','leg','core'],
    ['lower','knee','hip','leg'], ['lower','hip','leg','core'],
  ],
  full: [
    ['upper','push','pull','shoulder','arm','grip'], ['lower','knee','hip','leg'],
    ['upper','push','pull','shoulder','arm','grip'], ['lower','knee','hip','leg'],
  ],
};

function estimatedSeconds(exercises, sets, rest, work = sets * 45) {
  // Allow five minutes to warm up and 90 seconds per exercise to set up.
  return 300 + exercises * 90 + work + Math.max(0, sets - 1) * rest;
}
export function estimatedMinutes(exercises, sets, rest) {
  return Math.round(estimatedSeconds(exercises, sets, rest) / 60);
}

function secondsPerSet(exercise, reps) {
  // A standard set takes about 45 seconds including brief transitions.
  return 45 + (reps - prescribe(exercise).reps) * (exercise.timed ? 1 : 3);
}

function estimatedWorkoutSeconds(plan, rest) {
  const sets = plan.reduce((total, item) => total + item.sets, 0);
  const work = plan.reduce((total, item) => total + item.sets * secondsPerSet(byId.get(item.id), item.reps), 0);
  return estimatedSeconds(plan.length, sets, rest, work);
}

export function estimatedWorkoutMinutes(plan, rest) {
  return Math.round(estimatedWorkoutSeconds(plan, rest) / 60);
}
export function standardWorkoutCounts(gear, completed, excluded = []) {
  const coverage = rotation(gear, completed, excluded);
  return Object.fromEntries(Object.entries(templates).map(([kind, template]) => [
    kind, template.length + Number(rotationSlotChoices(kind, gear, excluded, coverage).length > 0),
  ]));
}
export function standardEstimates(rest, counts = standardWorkoutCounts(defaults.gear, [])) {
  return Object.fromEntries(Object.entries(counts).map(([kind, count]) =>
    [kind, estimatedMinutes(count, count * 3, rest)]));
}
function setsForExercise(sets, exercises, index) {
  return Math.floor(sets / exercises) + Number(index < sets % exercises);
}

const maxSets = 4;
const adjustments = [0, -1, 1, -2, 2, -3, 3];

function volumeFor(plan, targetMinutes, rest, adjustReps) {
  const count = plan.length;
  if (!targetMinutes) return { sets: count * 3, adjustment: 0, cost: 0 };
  const exercises = plan.map(({ id }) => byId.get(id));
  let best = { cost: Infinity };
  for (const adjustment of adjustReps ? adjustments : [0]) {
    const setTimes = exercises.map(exercise => secondsPerSet(exercise, prescribe(exercise, adjustment).reps));
    for (let sets = count * 2; sets <= count * maxSets; sets++) {
      const work = setTimes.reduce((total, seconds, index) => total + seconds * setsForExercise(sets, count, index), 0);
      const timeError = Math.abs(estimatedSeconds(count, sets, rest, work) - targetMinutes * 60);
      const cost = timeError + Math.abs(sets / count - 3) * 120 + Math.abs(adjustment) * 12;
      if (cost < best.cost) best = { sets, adjustment, cost };
    }
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
function matchesTarget(exercise, target) {
  return exercise.bucket === target || exercise.muscle === target ||
    (target === 'Hamstrings' && exercise.pattern === 'Hip hinge');
}

function slots(kind, gear, excluded, legacy = false) {
  const pool = eligible(gear, excluded);
  const template = legacy ? legacySlots[kind] : [...templates[kind], ...extraSlots[kind]];
  return template.map(([scope, ...targets]) => ({
    scope,
    choices: pool.filter(exercise => inScope(scope, exercise) &&
      targets.some(target => matchesTarget(exercise, target))),
  }));
}

function rotationSlotChoices(kind, gear, excluded, coverage) {
  const muscles = requiredMuscles[kind];
  if (!muscles) return [];
  const remaining = eligible(gear, excluded).filter(exercise =>
    inScope(kind, exercise) && !coverage[kind].used.has(exercise.id));
  // Give accessory exercises a slot when they are all that remains in the rotation.
  return remaining.some(exercise => muscles.some(muscle => matchesTarget(exercise, muscle))) ? [] : remaining;
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
  const missing = available.slice(0, baseCount).flatMap((slot, index) => slot.choices.length ? [] : [index]);
  if (missing.length) {
    if (requiredMuscles[kind]) {
      const muscles = missing.map(index => requiredMuscles[kind][index]).join(', ');
      throw new Error('No eligible exercises for ' + muscles + '. Restore exercises in the library or update your equipment in Settings.');
    }
    throw new Error('This workout is missing a movement pattern. Restore exercises in the library or update your equipment in Settings.');
  }
  const rotationChoices = duration ? [] : rotationSlotChoices(kind, gear, excluded, coverage);
  const minimumCount = baseCount + Number(rotationChoices.length > 0);
  const adjustReps = Boolean(requiredMuscles[kind]);
  const spec = duration ? available : available.slice(0, minimumCount);
  if (rotationChoices.length) spec[baseCount] = { scope: kind, choices: rotationChoices };
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
    if (exerciseCount >= minimumCount) {
      const volume = volumeFor(beam[0].plan, duration, rest, adjustReps);
      if (!selected || volume.cost < selected.volume.cost) selected = { beam, volume };
      if (duration && adjustReps && exerciseCount === baseCount) {
        // Add exercises only when the required ones cannot fill the target with sets and reps alone.
        const longestBase = beam[0].plan.map(({ id }) => ({
          ...prescribe(byId.get(id), adjustments.at(-1)), sets: maxSets,
        }));
        if (estimatedWorkoutSeconds(longestBase, rest) >= duration * 60) break;
      }
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
  return alternatives.map(({ plan }) => {
    const { sets, adjustment } = volumeFor(plan, duration, rest, adjustReps);
    return plan.map(({ id }, index) => ({
      ...prescribe(byId.get(id), adjustment), sets: setsForExercise(sets, plan.length, index),
    }));
  });
}

export function swapOptions(kind, plan, index, gear, completed, excluded = []) {
  const muscles = requiredMuscles[kind];
  const legacy = muscles && !muscles.every((muscle, position) => {
    const exercise = byId.get(plan[position]?.id);
    return exercise && matchesTarget(exercise, muscle);
  });
  const spec = slots(kind, gear, excluded, legacy);
  const used = new Set(plan.map(item => item.id));
  const options = ranked(spec[index], rotation(gear, completed, excluded), kind, used);
  if (muscles && !legacy && index < muscles.length) return options;
  return options.filter(exercise => {
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
