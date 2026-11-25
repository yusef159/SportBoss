import { readFileSync } from 'node:fs';

export const equipment = ['Bodyweight', 'Dumbbells', 'Bench', 'Cable', 'Machine'];
export const kinds = { upper: 'Upper Body', lower: 'Lower Body', full: 'Full Body' };

const categories = [
  ['upper','push','Horizontal push','Chest', /chest press|bench press|squeeze press|neutral-grip dumbbell press|push-up/i],
  ['upper','push','Horizontal adduction','Chest', /chest fly|pec deck/i],
  ['upper','pull','Vertical pull','Back', /pulldown|pullover/i],
  ['upper','shoulder','Scapular elevation','Traps', /shrug/i],
  ['upper','shoulder','Shoulder raise','Shoulders', /reverse fly|y-t-w|front raise|lateral raise|rear-delt raise|scaption raise|upright row/i],
  ['upper','shoulder','Vertical push','Shoulders', /shoulder press|arnold press|overhead press/i],
  ['upper','pull','Horizontal pull','Back', /row/i],
  ['upper','arm','Elbow extension','Triceps', /triceps|skull crusher|overhead extension|tate press|close-grip dumbbell press/i],
  ['upper','grip','Grip and wrist','Forearms', /wrist|carry|static hold/i],
  ['lower','knee','Knee-dominant','Quads', /squat|lunge|leg extension|wall sit/i],
  ['lower','hip','Explosive hip extension','Glutes & Hamstrings', /hang clean/i],
  ['lower','hip','Hip hinge','Glutes & Hamstrings', /deadlift|pull-through/i],
  ['lower','hip','Hip extension','Glutes', /hip thrust|bridge|glute kickback/i],
  ['lower','hip','Knee flexion','Hamstrings', /^leg curl$/i],
  ['lower','leg','Hip abduction','Glutes', /hip abduction/i],
  ['lower','leg','Plantar flexion','Calves', /calf raise/i],
  ['core','core','Lateral flexion','Obliques', /side bend|heel touches/i],
  ['core','core','Trunk rotation','Obliques', /twist|bicycle crunch/i],
  ['core','core','Trunk flexion','Abs', /crunch|leg raise|flutter kicks/i],
  ['core','core','Trunk stability','Abs', /plank|mountain climbers|dead bug|bird dog|hollow body/i],
  ['upper','arm','Elbow flexion','Biceps', /curl/i],
];

function classify({ name, ...row }) {
  let match = categories.find(([, , , , pattern]) => pattern.test(name));
  if (!match) throw new Error('Missing exercise classification for ' + name);
  if (/close-grip push-up|diamond push-up/i.test(name)) {
    match = ['upper','push','Horizontal push','Triceps'];
  }
  const [region, bucket, pattern, muscle] = match;
  let gear = ['Dumbbells'];
  if (/cable|lat pulldown/i.test(name)) gear = ['Cable'];
  if (/^seated chest press|pec deck|leg extension|^leg curl$/i.test(name)) gear = ['Machine'];
  if (/push-up|wall sit|single-leg glute bridge|y-t-w/i.test(name) ||
      (region === 'core' && !/weighted|cable|dumbbell/i.test(name))) gear = ['Bodyweight'];
  if ((gear.includes('Dumbbells') && /bench|incline|chest-supported|decline|^flat |bulgarian|seated|hip thrust|pullover|spider curl|tate press|skull crusher|squeeze press|neutral-grip dumbbell press/i.test(name)) ||
      /incline push-up/i.test(name)) gear.push('Bench');
  if (/^(?:cable )?preacher curl$/i.test(name)) gear.push('Bench');
  const timed = /plank$|wall sit|static hold|hollow body hold|carry/i.test(name);
  return { ...row, name, region, bucket, muscle, pattern, gear, timed };
}

export const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8')).map(classify);
export const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
export const prescribe = exercise => ({
  id: exercise.id, sets: 3, reps: exercise.timed ? 30 : exercise.pattern === 'Explosive hip extension' ? 6 : 10,
});
export function eligible(gear, excluded = []) {
  const omitted = new Set(excluded);
  return catalog.filter(exercise => !omitted.has(exercise.id) && exercise.gear.every(item => gear.includes(item)));
}
export const inScope = (scope, exercise) => exercise.region === scope || exercise.region === 'core';
