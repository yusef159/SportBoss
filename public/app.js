const icons = {
  today: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  library: '<path d="M4 5h4v15H4zM11 5h4v15h-4zM18 5l3 14"/>',
  progress: '<path d="M3 3v17h18M6 15l5-5 3 3 6-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M4 9l2-1 1-3 3 1 2-2 2 2 3-1 1 3 2 1-1 3 1 3-2 1-1 3-3-1-2 2-2-2-3 1-1-3-2-1 1-3z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dumbbell: '<path d="M5 7v10m3-12v14m8-14v14m3-12v10M8 12h8M2 10v4m20-4v4"/>',
  bench: '<path d="M3 10h18v4H3zM6 14v5m12-5v5"/>',
  cable: '<path d="M5 21V3h13v5m-5 3h10l-5 5-5-5Zm-8 9h7"/>',
  machine: '<path d="M4 21V3h13v9m-9 2h8l4 4h-8l-4-4Zm4 4v3m-10 0h20"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5"/>',
  upper: '<path d="M9 3v2.5L6 6.6a4 4 0 0 0-2.4 2.7L2 15l3.8 1 1.5-3.8L8.5 21h7l1.2-8.8 1.5 3.8 3.8-1-1.6-5.7A4 4 0 0 0 18 6.6l-3-1.1V3M9 10.5q3 2 6 0"/>',
  lower: '<path d="M7 3h10l1 6.5-1 5.5 1.5 4H21v2h-6l-2.1-5.5L12 10l-.9 5.5L9 21H3v-2h2.5L7 15l-1-5.5L7 3Zm-.5 3h11"/>',
  full: '<circle cx="12" cy="4" r="2"/><path d="m3 8 5 2 4-1 4 1 5-2m-9 1v6m0 0-5 6m5-6 5 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  rotate: '<path d="M20 7v5h-5M4 17v-5h5m-4-2a7.5 7.5 0 0 1 12-4l3 4m-16 4 3 4a7.5 7.5 0 0 0 12-4"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  swap: '<path d="M3 7h16m-4-4 4 4-4 4m6 6H5m4-4-4 4 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 3v5m-4 2h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
};
const icon = (name, size = 20) => '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (icons[name] || icons.dumbbell) + '</svg>';
const labels = { upper: 'Upper Body', lower: 'Lower Body', full: 'Full Body' };
const descriptions = { upper: 'Chest, back, shoulders & arms', lower: 'Quads, hamstrings, glutes & calves', full: 'Upper and lower body in one session' };
const gearOptions = ['Bodyweight', 'Dumbbells', 'Bench', 'Cable', 'Machine'];
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const safe = value => String(value ?? '').replace(/[&<>"']/g, mark => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[mark]);
const dateText = (day, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(day + 'T12:00:00Z'));
const dateLong = day => dateText(day, { weekday: 'long', month: 'long', day: 'numeric' });
const dateShort = day => dateText(day, { month: 'short', day: 'numeric' });
const workoutDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'short', day: 'numeric',
});
const workoutClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function duration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes === 0) return 'Under 1 min';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return minutes + ' min';
  return hours + ' hr' + (minutes ? ' ' + minutes + ' min' : '');
}
function workoutTiming({ started, finished }) {
  const startDate = workoutDate.format(started);
  const endDate = workoutDate.format(finished);
  const time = value => '<time datetime="' + new Date(value).toISOString() + '">' + workoutClock.format(value) + '</time>';
  return '<span class="workout-timing"><span>' + startDate + '</span><span>' + time(started) + ' – ' +
    (startDate === endDate ? '' : endDate + ' ') + time(finished) + '</span></span>';
}
let data, library, exercises;
let view = metaView();
let busy = false;
let timer;
let toastTimer;
let restAlarm;
let restDeadline = null;
let audioContext;
let selectedKind;
let filters = { search: '', equipment: '', region: '', routine: '' };
let activeValues = { kg: 0, reps: 10 };
let activeKey;
let trendId;
let trendMetric;
let trendReps;
let trendSelection;
let trendPoints;
let trendRequest = 0;
let recap;
const stepWidth = 21;

function metaView() {
  const name = location.hash.slice(1);
  return ['library','progress','settings'].includes(name) ? name : 'today';
}
function notify(message) {
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => notice.classList.remove('visible'), 4200);
}
function enableWorkoutAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    audioContext ||= new Context();
    if (audioContext.state !== 'running') void audioContext.resume().catch(() => {});
  } catch {
    // The on-screen rest notification still works when audio is unavailable.
  }
}
function playRestChime() {
  if (audioContext?.state !== 'running') return;
  for (const [index, frequency] of [880, 1175].entries()) {
    const time = audioContext.currentTime + index * .24;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(.001, time);
    envelope.gain.exponentialRampToValueAtTime(.18, time + .02);
    envelope.gain.exponentialRampToValueAtTime(.001, time + .31);
    oscillator.connect(envelope).connect(audioContext.destination);
    oscillator.start(time);
    oscillator.stop(time + .32);
  }
}
function checkRestAlarm() {
  if (restAlarm === undefined) return;
  clearTimeout(restAlarm);
  const remaining = restDeadline - Date.now();
  if (remaining > 0) {
    restAlarm = setTimeout(checkRestAlarm, remaining);
    return;
  }
  restAlarm = undefined;
  notify('Rest complete. Ready for your next set.');
  playRestChime();
}
function scheduleRestAlarm(deadline) {
  if (restDeadline === deadline) return;
  clearTimeout(restAlarm);
  restAlarm = undefined;
  restDeadline = deadline;
  if (deadline > Date.now()) restAlarm = setTimeout(checkRestAlarm, deadline - Date.now());
}
async function api(path, body) {
  const response = await fetch('/api/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Could not reach the server.'), { status: response.status });
  return result;
}
function nav() {
  const links = [['today','Today'],['library','Exercise Library'],['progress','Progress']];
  const link = ([page, label], mobile = false) => '<a href="#' + page + '" class="' + (view === page ? 'current' : '') + '"' +
    (view === page ? ' aria-current="page"' : '') + '>' + icon(page, 18) + '<span>' +
    (mobile && page === 'library' ? 'Library' : label) + '</span></a>';
  document.querySelector('#header').innerHTML = '<div class="header-wrap"><a href="#today" class="brand" aria-label="SportBoss home">' +
    '<img class="brand-mark" src="/sportboss.svg" alt="" width="28" height="28">SportBoss</a><nav class="desktop-nav" aria-label="Main navigation">' +
    links.map(item => link(item)).join('') + '</nav><a class="settings-link ' + (view === 'settings' ? 'current' : '') +
    '" href="#settings" aria-label="Training settings">' + icon('settings', 19) + '<span>Settings</span></a></div>';
  document.querySelector('#mobile').innerHTML = links.concat([['settings','Settings']]).map(item => link(item, true)).join('');
}
function title(name, text, right = '') {
  return '<div class="page-title"><div><h1>' + name + '</h1><p>' + text + '</p></div>' + right + '</div>';
}
function button(label, action, symbol, className = 'primary', attributes = '') {
  return '<button type="button" class="button ' + className + '" data-action="' + action + '" ' + attributes + '>' +
    (symbol ? icon(symbol, 19) : '') + '<span>' + label + '</span></button>';
}
function photo(exercise, cls = '', expandable = true) {
  if (!exercise?.image) return '<div class="photo ' + cls + '">' + icon('dumbbell', 30) + '</div>';
  const image = '<img src="' + safe(exercise.image) + '" alt="' + safe(exercise.name) + '" loading="lazy" decoding="async">';
  if (!expandable) return '<div class="photo ' + cls + '">' + image + '</div>';
  return '<button type="button" class="photo photo-button ' + cls + '" data-action="view-photo" data-id="' + safe(exercise.id) +
    '" aria-label="Enlarge image for ' + safe(exercise.name) + '">' + image + '</button>';
}
function weeklyCard() {
  const { week, today } = data.progress;
  const count = week.reduce((sum, item) => sum + item.count, 0);
  return '<section class="panel widget"><div class="widget-title"><span class="icon-box">' + icon('calendar') +
    '</span><h2>Weekly consistency</h2></div><div class="week-count"><strong>' + count +
    '</strong><span> / ' + data.settings.goal + ' workouts</span></div><div class="week-grid">' +
    week.map(day => '<div class="week-day' + (day.count ? ' done' : '') + (day.day === today ? ' today' : '') +
      '" title="' + dateLong(day.day) + ' · ' + day.count + ' workouts"><span>' + dateText(day.day, { weekday: 'short' }) +
      '</span><b>' + (day.count ? icon('check', 15) : Number(day.day.slice(-2))) + '</b></div>').join('') +
    '</div></section>';
}
function rotationCard() {
  const bars = Object.entries(data.progress.rotation).map(([scope, item]) => {
    const percent = item.total ? Math.round(item.used.length / item.total * 100) : 0;
    return '<div class="rotation-item"><div><strong>' + labels[scope] + '</strong><span>' + item.used.length + ' / ' +
      item.total + ' complete</span></div><progress value="' + percent + '" max="100">' + percent +
      '%</progress><small>Cycle ' + (item.cycles + 1) + '</small></div>';
  }).join('');
  return '<section class="panel widget"><div class="widget-title"><span class="icon-box">' + icon('rotate') +
    '</span><h2>Exercise rotation</h2></div>' + bars + '<a class="text-link" href="#library">Browse exercises ' +
    icon('chevron', 16) + '</a></section>';
}
function today() {
  const pick = selectedKind || data.recommendation;
  const target = data.settings.duration;
  const cards = Object.keys(labels).map(kind => '<button class="type-card' + (pick === kind ? ' selected' : '') +
    '" data-action="select" data-kind="' + kind + '" aria-pressed="' + (pick === kind) +
    '"><span class="icon-box">' + icon(kind, 21) + '</span><strong>' + labels[kind] + '</strong><span>' + descriptions[kind] +
    '</span><i>' + (pick === kind ? icon('check', 13) : '') + '</i></button>').join('');
  return title('Training Hub', 'Plan your next workout and track your progress.',
    '<div class="date-chip">' + icon('calendar', 17) + safe(dateLong(data.progress.today)) + '</div>') +
    '<div class="dashboard"><div class="dashboard-main"><section class="hero panel"><div class="hero-image"></div><div class="hero-copy"><span class="eyebrow">' +
    icon('target', 15) + (pick === data.recommendation ? 'Recommended workout' : 'Selected workout') +
    '</span><h2>' + labels[pick] + '</h2><p>' + descriptions[pick] + '</p><div class="hero-metrics">' +
    (target ? '' : '<span>' + icon('dumbbell', 17) + (pick === 'full' ? '6' : '5') + ' exercises</span>') +
    '<span>' + icon('clock', 16) + (target ? target + ' min target' : 'About ' + data.standardEstimates[pick] + ' min') +
    '</span></div>' + button('Generate workout', 'generate', 'play') + '<p class="ai-status">' +
    (data.aiConfigured ? 'TypeSafe AI review configured' : 'Rule-based planning · TypeSafe AI is off') + '</p></div></section>' +
    '<section class="type-section"><div class="section-head"><h2>Choose your workout</h2><p>Select a session to match your training plan.</p></div><div class="types">' +
    cards + '</div></section></div><aside class="dashboard-side">' + weeklyCard() + rotationCard() + '</aside></div>';
}
function sourceText(workout) {
  if (workout.review?.modified) return 'Manually adjusted workout';
  return workout.source === 'jev' ? 'Selected by TypeSafe AI' : 'Rule-based workout';
}
function planReview(workout) {
  const review = workout.review;
  const patterns = new Map();
  for (const slot of workout.plan) {
    const { pattern } = exercises.get(slot.id);
    patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
  }
  const messages = {
    disabled: 'TypeSafe AI was disabled when this workout was generated.',
    unavailable: 'TypeSafe did not return a usable review. The app selected its highest-ranked rule-based plan.',
    'below-threshold': 'No candidate met both AI thresholds. The app kept its highest-ranked rule-based plan.',
    selected: 'TypeSafe selected the highest-scoring plan that met both thresholds.',
  };
  const status = messages[review?.status] || (workout.source === 'rules'
    ? 'This saved workout used the rule-based planner.'
    : 'Detailed scores were unavailable when this plan was saved.');
  const percent = value => Math.round(value * 100) + '%';
  const scores = review?.scores?.map(score => '<tr><th scope="row">Candidate ' + (score.index + 1) +
    (score.index === review.selected ? ' <small>' + (review.modified ? 'Original choice' : 'Selected') + '</small>' : '') +
    '</th><td>' + percent(score.balance) + '</td><td>' + percent(score.compatibility) + '</td></tr>').join('');
  return '<details class="plan-review"><summary>How this workout was selected</summary><p>' + status +
    (review?.modified ? ' Exercise swaps changed the original plan.' : '') + '</p>' +
    '<h3>Movement patterns in this plan</h3><ul>' + [...patterns].map(([pattern, count]) =>
      '<li>' + safe(pattern) + (count > 1 ? ' × ' + count : '') + '</li>').join('') + '</ul>' +
    (scores ? '<h3>' + (review.modified ? 'Original TypeSafe review' : 'TypeSafe review') +
      (review.model ? ' · ' + safe(review.model) : '') + '</h3><p>Minimum scores are 70% for balance and 85% for equipment compatibility.</p>' +
      '<div class="review-table"><table><thead><tr><th scope="col">Plan</th><th scope="col">Balance</th>' +
      '<th scope="col">Equipment</th></tr></thead><tbody>' + scores + '</tbody></table></div>' : '') + '</details>';
}
function preview(workout) {
  const excluded = new Set(data.settings.excluded);
  const needsSwap = workout.plan.some(slot => excluded.has(slot.id));
  const lines = workout.plan.map((slot, index) => {
    const item = exercises.get(slot.id);
    return '<div class="exercise-row">' + photo(item) + '<div class="row-copy"><strong>' + safe(item.name) +
      '</strong><span>' + safe(item.muscle) + ' · ' + safe(item.gear.join(' + ')) + '</span>' +
      (excluded.has(item.id) ? '<span class="exclusion-label">Excluded from routine</span>' : '') + '</div><span class="set-target">' +
      slot.sets + ' × ' + slot.reps + (item.timed ? ' sec' : '') + '</span>' +
      button('Swap', 'swaps', 'swap', 'secondary compact', 'data-index="' + index + '"') + '</div>';
  }).join('');
  return title(labels[workout.kind], 'Preview your workout and swap individual exercises.') +
    '<section class="panel session-panel"><div class="session-header"><div><h2>Workout plan</h2><p>' + workout.plan.length +
    ' exercises · ' + workout.totalSets + ' sets · About ' + workout.estimatedMinutes + ' min</p><p>' + sourceText(workout) + '</p></div>' +
    button('Discard', 'discard-preview', null, 'subtle compact') + '</div><div class="exercise-list">' + lines +
    '</div>' + planReview(workout) + (needsSwap ? '<p class="hint">Swap or restore the excluded exercises before starting.</p>' : '') +
    '<footer>' + button('Start workout', 'start', 'play', 'primary', needsSwap ? 'disabled' : '') + '</footer></section>';
}
function minutesSeconds(totalSeconds) {
  return Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
}
function restFill(remainingMs, totalSeconds) {
  return Math.min(100, Math.max(0, remainingMs / (totalSeconds * 10))) + '%';
}
function trainingHeader(workout, exerciseNumber) {
  const steps = [
    ['Exercise', 'dumbbell', exerciseNumber, workout.plan.length],
    ['Set', 'layers', workout.next.set, workout.next.sets],
  ];
  const progress = steps.map(([label, symbol, current, total]) =>
    '<div class="training-step"><dt>' + icon(symbol, 17) + ' ' + label + '</dt><dd><strong>' +
    current + '</strong> of ' + total + '</dd></div>').join('');
  return '<header class="training-header"><div class="training-heading"><h1>' + labels[workout.kind] + '</h1>' +
    button('End workout', 'discard-active', 'stop', 'end-workout') + '</div>' +
    '<dl class="training-steps" aria-label="Workout progress">' + progress + '</dl></header>';
}
function training(workout) {
  const next = workout.next;
  const item = exercises.get(next.id);
  const key = workout.id + '/' + workout.sets.length;
  if (activeKey !== key) {
    activeKey = key;
    activeValues = { kg: workout.prefill?.kg ?? 0, reps: workout.prefill?.reps ?? next.reps };
  }
  const remainingRest = Math.max(0, (workout.rest_until ?? 0) - Date.now());
  const rest = Math.ceil(remainingRest / 1000);
  const exerciseIndex = workout.plan.findIndex(slot => slot.id === next.id);
  const weight = item.gear.includes('Bodyweight') ? '' :
    '<div class="weight-control"><div class="control-label">Weight</div><div class="weight-value"><strong id="weight-val">' +
    activeValues.kg.toFixed(1) + '</strong><span> kg</span></div><div class="ruler-wrap"><div class="ruler" id="ruler" role="slider" tabindex="0" aria-label="Weight in kilograms" aria-valuemin="0" aria-valuemax="300" aria-valuenow="' +
    activeValues.kg + '"><div class="ruler-track">' +
    Array.from({ length: 601 }, (_, i) => '<span class="tick ' + (i % 10 === 0 ? ' major' : i % 2 === 0 ? ' medium' : '') +
      '">' + (i % 10 === 0 ? '<small>' + i / 2 + '</small>' : '') + '</span>').join('') +
    '</div></div><span class="ruler-marker"></span></div><p class="hint">Swipe to adjust in 0.5 kg steps</p></div>';
  return trainingHeader(workout, exerciseIndex + 1) +
    '<section class="panel session-panel workout-active"><progress aria-label="Sets completed" value="' + workout.sets.length + '" max="' +
    workout.totalSets + '"></progress><div class="active-exercise">' + photo(item, 'active-photo') + '<div><div class="eyebrow">' +
    safe(item.muscle) + '</div><h2>' + safe(item.name) + '</h2><p>' + safe(item.pattern) + ' · ' + safe(item.gear.join(' + ')) +
    '</p><p class="previous">' + (workout.previous ? 'Last session · ' + (workout.previous.kg ? workout.previous.kg + ' kg × ' : '') +
    workout.previous.reps + (item.timed ? ' sec' : ' reps') : 'First session for this exercise') + '</p></div></div>' +
    '<div class="set-controls">' + weight + '<div class="rep-control"><span class="control-label">' + (item.timed ? 'Duration' : 'Repetitions') +
    '</span><div class="stepper">' + button('Decrease', 'rep-minus', 'minus', 'secondary icon-only') +
    '<strong id="rep-val">' + activeValues.reps + (item.timed ? 's' : '') + '</strong>' +
    button('Increase', 'rep-plus', 'plus', 'secondary icon-only') + '</div></div></div>' +
    '<section id="rest-banner" class="rest-banner" aria-labelledby="rest-title" ' + (rest ? '' : 'hidden') +
    '><div class="rest-ring" style="--rest-fill:' + restFill(remainingRest, data.settings.rest) +
    '"><strong id="rest-count" role="timer" aria-label="Rest time remaining">' + minutesSeconds(rest) +
    '</strong></div><div class="rest-copy"><h3 id="rest-title">Rest between sets</h3><p>Next up <span>' + safe(item.name) +
    '</span></p></div>' + button('Skip rest', 'skip-rest', null, 'secondary compact') +
    '</section><footer>' + button('Complete set', 'complete', 'check', 'primary complete', rest ? 'disabled' : '') + '</footer></section>';
}
function wireTraining() {
  const ruler = document.querySelector('#ruler');
  if (ruler) {
    const setWeight = value => {
      activeValues.kg = Math.max(0, Math.min(300, value));
      document.querySelector('#weight-val').textContent = activeValues.kg.toFixed(1);
      ruler.setAttribute('aria-valuenow', String(activeValues.kg));
    };
    ruler.scrollLeft = activeValues.kg * 2 * stepWidth;
    ruler.addEventListener('scroll', () => setWeight(Math.round(ruler.scrollLeft / stepWidth) / 2), { passive: true });
    ruler.addEventListener('keydown', event => {
      const delta = { ArrowLeft: -.5, ArrowDown: -.5, ArrowRight: .5, ArrowUp: .5, PageDown: -5, PageUp: 5 }[event.key];
      if (delta === undefined && !['Home','End'].includes(event.key)) return;
      event.preventDefault();
      setWeight(event.key === 'Home' ? 0 : event.key === 'End' ? 300 : activeValues.kg + delta);
      ruler.scrollLeft = activeValues.kg * 2 * stepWidth;
    });
    let drag;
    ruler.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { x: event.clientX, left: ruler.scrollLeft };
      ruler.setPointerCapture(event.pointerId);
      ruler.classList.add('dragging');
    });
    ruler.addEventListener('pointermove', event => {
      if (drag) ruler.scrollLeft = drag.left + drag.x - event.clientX;
    });
    ruler.addEventListener('lostpointercapture', () => {
      drag = null;
      ruler.classList.remove('dragging');
      ruler.scrollLeft = Math.round(ruler.scrollLeft / stepWidth) * stepWidth;
    });
  }
  const restBanner = document.querySelector('#rest-banner');
  if (!restBanner.hidden) {
    const ring = restBanner.querySelector('.rest-ring');
    const countdown = restBanner.querySelector('#rest-count');
    timer = setInterval(() => {
      const remaining = Math.max(0, data.pending.rest_until - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      const display = minutesSeconds(seconds);
      if (countdown.textContent !== display) countdown.textContent = display;
      ring.style.setProperty('--rest-fill', restFill(remaining, data.settings.rest));
      if (!seconds) {
        clearInterval(timer);
        restBanner.hidden = true;
        document.querySelector('[data-action=complete]').disabled = false;
      }
    }, 100);
  }
}
function libraryGrid() {
  const used = data.progress.rotation;
  const excluded = new Set(data.settings.excluded);
  const query = filters.search.trim().toLowerCase();
  const items = library.filter(item => {
    const searchable = [item.name, item.muscle, item.pattern, ...item.gear].join(' ').toLowerCase();
    return (!query || searchable.includes(query)) && (!filters.equipment || item.gear.includes(filters.equipment)) &&
      (!filters.region || item.region === filters.region) && (!filters.routine || excluded.has(item.id) === (filters.routine === 'excluded'));
  });
  return '<p class="result-count">' + items.length + ' exercise' + (items.length === 1 ? '' : 's') + '</p><div class="library-grid">' +
    items.map(item => {
      const omitted = excluded.has(item.id);
      const done = Object.keys(used).some(scope => used[scope].used.includes(item.id));
      const label = omitted ? 'Restore' : 'Exclude';
      return '<article class="panel library-card">' + photo(item) + '<div class="library-card-body"><span class="tag">' +
        safe(item.muscle) + '</span><h2>' +
        safe(item.name) + '</h2><p>' + safe(item.pattern) + ' · ' + safe(item.gear.join(' + ')) + '</p>' +
        (done ? '<small class="covered">' + icon('check', 14) + ' Completed this cycle</small>' : '') +
        button(label + (omitted ? '<small class="routine-status">Excluded</small>' : ''),
          'exercise-preference', omitted ? 'plus' : 'minus', 'secondary compact routine-button' + (omitted ? ' is-excluded' : ''),
          'data-exercise-id="' + safe(item.id) + '" data-excluded="' + !omitted + '" aria-label="' +
          label + ' ' + safe(item.name) + (omitted ? ' to your routine, currently excluded' : ' from your routine') + '"') + '</div></article>';
    }).join('') + '</div>' + (items.length ? '' : '<div class="panel empty">No exercises match these filters.</div>');
}
const option = (value, text, current) => '<option value="' + safe(value) + '"' + (value === current ? ' selected' : '') + '>' + safe(text) + '</option>';
function libraryPage() {
  return title('Exercise Library', 'Browse your catalog and exclude exercises you want to leave out of future workouts.') +
    '<div class="filters"><label class="search-field">' + icon('search') +
    '<input id="search" type="search" aria-label="Search exercises" placeholder="Search exercises" value="' + safe(filters.search) + '"></label>' +
    '<select id="region" aria-label="Body region">' + option('', 'All body regions', filters.region) +
    ['upper','lower','core'].map(region => option(region, labels[region] || 'Core', filters.region)).join('') + '</select>' +
    '<select id="equipment" aria-label="Equipment">' + option('', 'All equipment', filters.equipment) +
    gearOptions.map(gear => option(gear, gear, filters.equipment)).join('') + '</select><select id="routine" aria-label="Workout inclusion">' +
    option('', 'All routine statuses', filters.routine) + option('included', 'Included', filters.routine) +
    option('excluded', 'Excluded', filters.routine) + '</select></div><div id="library-results">' + libraryGrid() + '</div>';
}
const trendMeasures = {
  weight: ['Working weight', 'kg'], kg: ['Estimated 1RM', 'kg'],
  reps: ['Repetitions', 'reps'], seconds: ['Hold time', 'sec'],
};
const trendNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
function trendAxis(values, fractional) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const ideal = (high - low || Math.max(high * .15, 1)) / 3;
  const scale = 10 ** Math.floor(Math.log10(ideal));
  const step = Math.max(fractional ? .5 : 1, [1, 2, 5, 10].find(size => size * scale >= ideal) * scale);
  const bottom = Math.max(0, Math.floor((low - step * .35) / step));
  const top = Math.ceil((high + step * .35) / step);
  const levels = Array.from({ length: top - bottom + 1 }, (_, index) => (top - index) * step);
  const height = value => (top - value / step) / (top - bottom) * 100;
  return { levels, height };
}
function trendGraph(series, unit) {
  const { levels, height } = trendAxis(series.map(point => point.value), unit === 'kg');
  const datesAt = limit => {
    const count = Math.min(series.length, limit);
    return new Set(Array.from({ length: count }, (_, index) =>
      count > 1 ? Math.round(index * (series.length - 1) / (count - 1)) : 0));
  };
  const dates = datesAt(5);
  const compactDates = datesAt(3);
  const points = series.map((point, index) => ({
    ...point, x: series.length === 1 ? 50 : 4 + index * 92 / (series.length - 1), y: height(point.value),
    label: dateShort(point.day) + ' · ' + workoutClock.format(point.finished) + ' · ' + trendNumber.format(point.value) + ' ' + unit,
  }));
  const selected = points[trendSelection] ? trendSelection : points.length - 1;
  const path = points.map(point => point.x + ',' + point.y).join(' ');
  const pointButtons = points.map(({ x, y, label }, index) =>
    '<button type="button" class="trend-point" data-action="trend-point" data-index="' + index + '" style="--x:' + x +
    '%;--y:' + y + '%" aria-pressed="' + (index === selected) + '" aria-label="' + safe(label) + '" title="' + safe(label) + '"></button>').join('');
  const dateLabels = points.map(({ x, day }, index) => dates.has(index)
    ? '<span class="' + (compactDates.has(index) ? '' : 'trend-extra-date') + '" style="--x:' + x + '%">' + dateShort(day) + '</span>' : '').join('');
  return '<div class="trend-graph"><div class="trend-axis" aria-hidden="true">' + levels.map(value =>
    '<span style="--y:' + height(value) + '%">' + trendNumber.format(value) + ' ' + unit + '</span>').join('') +
    '</div><div class="trend-plot" role="group" aria-label="Progress by workout" style="--point-width:' +
    (points.length > 1 ? 92 / (points.length - 1) + '%' : '34px') + '">' +
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
    levels.map(value => '<line x1="0" y1="' + height(value) + '" x2="100" y2="' + height(value) +
      '" vector-effect="non-scaling-stroke"/>').join('') +
    (points.length > 1 ? '<polyline points="' + path + '" vector-effect="non-scaling-stroke"/>' : '') +
    '</svg>' + pointButtons + '</div><div class="trend-dates" aria-hidden="true">' + dateLabels + '</div></div>' +
    '<p id="trend-reading" class="trend-reading" aria-live="polite">' + safe(points[selected].label) + '</p>';
}
function trends() {
  if (!trendPoints?.length) {
    return '<div class="empty">' + (trendPoints ? 'No completed sets for this exercise.' : 'Loading progression…') + '</div>';
  }
  const metrics = Object.keys(trendMeasures).filter(metric => trendPoints.some(point => point.metric === metric));
  if (!metrics.includes(trendMetric)) trendMetric = metrics[0];
  let series = trendPoints.filter(point => point.metric === trendMetric);
  const [measure, unit] = trendMeasures[trendMetric];
  let repOptions = [];
  if (trendMetric === 'weight') {
    const appearances = new Map();
    for (const point of [...series].reverse()) appearances.set(point.reps, (appearances.get(point.reps) || 0) + 1);
    if (!appearances.has(trendReps)) trendReps = [...appearances].sort((a, b) => b[1] - a[1])[0][0];
    repOptions = [...appearances.keys()].sort((a, b) => a - b);
    series = series.filter(point => point.reps === trendReps);
  }
  const latest = series.at(-1).value;
  const first = series[0].value;
  const change = series.length > 1 && first > 0 ? Math.round((latest - first) / first * 1000) / 10 : null;
  const controls = (metrics.length > 1 ? '<select id="metric" aria-label="Progress measurement">' +
    metrics.map(metric => option(metric, trendMeasures[metric][0], trendMetric)).join('') + '</select>' : '') +
    (repOptions.length > 1 ? '<select id="trend-reps" aria-label="Repetitions per set">' +
      repOptions.map(reps => option(reps, reps + ' reps', trendReps)).join('') + '</select>' : '');
  const comparison = change === null
    ? (series.length === 1 ? '<span class="trend-baseline">First recorded workout</span>' : '')
    : '<span class="trend-change' + (change > 0 ? ' gain' : change < 0 ? ' loss' : '') +
      '" title="Change from the first workout shown">' + (change > 0 ? '+' : '') + change + '%</span>';
  return (controls ? '<div class="trend-controls">' + controls + '</div>' : '') +
    '<p class="trend-measure">' + measure + (trendMetric === 'weight' ? ' at ' + trendReps + ' repetitions' : '') + '</p>' +
    '<div class="trend-summary"><strong>' + trendNumber.format(latest) + ' ' + unit + '</strong>' + comparison + '</div>' +
    trendGraph(series, unit);
}
function progressPage() {
  const { history, records } = data.progress;
  const ids = [...new Set(records.map(record => record.exercise))];
  if (!ids.includes(trendId)) trendId = ids[0];
  const rows = history.map(row => '<button type="button" class="history-row" data-action="history" data-id="' + row.id +
    '"><span class="icon-box">' + icon(row.kind) + '</span><span class="history-details"><strong>' + labels[row.kind] + '</strong>' +
    workoutTiming(row) + '<small>' + row.count + ' exercises</small></span><span class="history-duration">' + duration(row.duration) + '</span>' +
    icon('chevron', 17) + '</button>').join('');
  const prs = records.map(record => {
    const exercise = exercises.get(record.exercise);
    return '<div class="record"><span><strong>' + safe(exercise.name) + '</strong><small>' +
      dateShort(record.day) +
      '</small></span><strong>' + (record.kg ? record.kg + ' kg × ' : '') + record.reps + (exercise.timed ? 's' : ' reps') + '</strong></div>';
  }).join('');
  return title('Progress', 'See your strength, personal records and training history.') +
    '<div class="dashboard"><div class="dashboard-main progress-main"><section class="panel widget progression"><div class="widget-title"><span class="icon-box">' +
    icon('progress') + '</span><h2>Strength progression</h2></div>' +
    (ids.length ? '<select id="trend" aria-label="Exercise progression">' + ids.map(id => option(id, exercises.get(id).name, trendId)).join('') +
      '</select><div id="trend-content">' + trends() + '</div>' : '<div class="empty">Complete your first workout to see your strength trend.</div>') +
    '</section><section class="panel widget"><div class="widget-title"><span class="icon-box">' + icon('calendar') +
    '</span><h2>Workout history</h2></div>' + (rows || '<div class="empty">Your completed workouts will appear here.</div>') +
    '</section></div><aside class="dashboard-side">' + weeklyCard() + rotationCard() +
    '<section class="panel widget"><div class="widget-title"><span class="icon-box">' + icon('trophy') +
    '</span><h2>Personal records</h2></div>' + (prs || '<div class="empty">Log a workout to set your first baseline.</div>') +
    '</section></aside></div>';
}
function settingsSection(heading, symbol, content) {
  return '<section class="panel settings-section"><div class="settings-section-title"><span class="icon-box">' +
    icon(symbol, 20) + '</span><h2>' + heading + '</h2></div>' + content + '</section>';
}
function settingsSelect(label, name, symbol, options) {
  return '<label class="settings-field"><span>' + label + '</span><span class="settings-select">' +
    icon(symbol, 18) + '<select name="' + name + '">' + options + '</select>' + icon('chevron', 16) + '</span></label>';
}
function settingsPage() {
  const { split, gear, goal, rest, duration } = data.settings;
  const splitChoices = [
    ['alternate', 'Upper / Lower', 'Alternate upper and lower body', 'rotate'],
    ['full', 'Full Body', 'Train your whole body each session', 'full'],
  ];
  const trainingPlan = '<fieldset><legend>Training split</legend><div class="settings-splits">' +
    splitChoices.map(([value, label, detail, symbol]) => '<label class="settings-choice split-choice">' +
      '<input type="radio" name="split" value="' + value + '"' + (value === split ? ' checked' : '') + '>' +
      '<span class="split-choice-top">' + icon(symbol, 21) + '<span class="choice-indicator"></span></span>' +
      '<strong>' + label + '</strong><small>' + detail + '</small></label>').join('') +
    '</div></fieldset><fieldset aria-describedby="duration-hint"><legend>Target workout length</legend><div class="settings-durations">' +
    data.durationOptions.map(minutes => '<label class="settings-choice duration-choice"><input type="radio" name="duration" value="' +
      minutes + '"' + (minutes === duration ? ' checked' : '') + '><span>' + (minutes ? minutes + ' min' : 'Auto') + '</span></label>').join('') +
    '</div><p id="duration-hint" class="hint settings-hint">Applies to newly generated workouts.</p></fieldset>';
  const equipmentIcons = { Bodyweight: 'full', Dumbbells: 'dumbbell', Bench: 'bench', Cable: 'cable', Machine: 'machine' };
  const equipment = '<div class="gear-options">' + gearOptions.map(item => {
    const alwaysIncluded = item === 'Bodyweight';
    return '<label class="settings-choice gear-choice"><input type="checkbox" name="gear" value="' + item + '"' +
      (gear.includes(item) ? ' checked' : '') + (alwaysIncluded ? ' disabled' : '') + '>' + icon(equipmentIcons[item], 19) +
      '<span><strong>' + item + '</strong>' + (alwaysIncluded ? '<small>Always included</small>' : '') +
      '</span><span class="gear-indicator">' + icon('check', 13) + '</span></label>';
  }).join('') + '</div>';
  const goalOptions = Array.from({ length: 7 }, (_, i) => option(i + 1, i + 1 + (i ? ' workouts' : ' workout'), goal)).join('');
  const restOptions = [...new Set([15,30,45,60,75,90,120,150,180,rest])].sort((a,b) => a-b)
    .map(sec => option(sec, sec + ' seconds', rest)).join('');
  const session = '<div class="settings-numbers">' + settingsSelect('Weekly workout goal', 'goal', 'calendar', goalOptions) +
    settingsSelect('Rest between sets', 'rest', 'clock', restOptions) + '</div>';
  const dataControls = '<div class="settings-data">' + settingsSection('Training data', 'rotate',
    '<p class="hint">Clear your workout history, current workout, and training preferences.</p>' +
    button('Reset data', 'confirm-reset-data', null, 'secondary')) + '</div>';
  return '<div class="settings-heading">' + title('Training Settings', 'Customize how SportBoss plans your workouts.') +
    '</div><form id="settings-form" class="settings-form">' + settingsSection('Training plan', 'target', trainingPlan) +
    settingsSection('Equipment', 'dumbbell', equipment) + settingsSection('Session preferences', 'settings', session) +
    '<button class="button primary settings-save" type="submit">' + icon('check', 19) + 'Save preferences</button></form>' + dataControls;
}
function recapPanel(result) {
  return '<div class="summary-metrics"><div><strong>' + duration(result.duration) + '</strong><span>Duration</span></div><div><strong>' +
    result.count + '</strong><span>Exercises</span></div><div><strong>' + result.sets + '</strong><span>Sets logged</span></div></div>' +
    '<div class="summary-timing">' + icon('clock', 18) + '<div>' + workoutTiming(result) + '<small>Jerusalem time</small></div></div>' +
    '<h3>Achievements</h3>' + (result.achievements.length ? result.achievements.map(item =>
      '<div class="record"><span><strong>' + safe(exercises.get(item.id)?.name || item.id) + '</strong><small>' + safe(item.kind) +
      '</small></span><strong>' + (item.gain === null ? 'First log' : '+' + item.gain + ' ' + safe(item.unit)) + '</strong></div>').join('') :
      '<p class="hint">No new records or improvements this session.</p>') + '<h3>Logged sets</h3>' +
    result.exercises.map(item => {
      const exercise = exercises.get(item.id);
      const bodyweight = exercise?.gear.includes('Bodyweight');
      const rows = item.sets.map((set, index) => '<tr><th scope="row">' + (index + 1) +
        '</th><td>' + (bodyweight && set.kg === 0 ? 'Bodyweight' : set.kg + ' kg') +
        '</td><td>' + set.reps + (exercise?.timed ? ' sec' : '') + '</td></tr>').join('');
      return '<table class="logged-sets"><caption>' + safe(exercise?.name || item.id) +
        '</caption><thead><tr><th scope="col">Set</th><th scope="col">Weight</th><th scope="col">' +
        (exercise?.timed ? 'Time' : 'Reps') + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }).join('');
}
function showDialog(name, content, className = '') {
  dialog.className = className;
  dialog.innerHTML = '<div class="dialog-head"><h2 id="dialog-title">' + name +
    '</h2><button type="button" class="button icon-only subtle" data-action="close" aria-label="Close">' + icon('close') +
    '</button></div><div class="dialog-body">' + content + '</div>';
  if (!dialog.open) dialog.showModal();
}
function render() {
  clearInterval(timer);
  nav();
  if (!data) return;
  scheduleRestAlarm(data.pending?.rest_until ?? null);
  app.setAttribute('aria-busy', 'false');
  if (view === 'library') app.innerHTML = libraryPage();
  else if (view === 'progress') app.innerHTML = progressPage();
  else if (view === 'settings') app.innerHTML = settingsPage();
  else if (recap) {
    app.innerHTML = title('Workout complete', labels[recap.kind] + ' session saved.') + '<section class="panel session-panel recap">' +
      recapPanel(recap) + '<footer>' + button('Back to Today', 'clear-recap', 'check') + '</footer></section>';
  } else if (data.pending?.started) {
    app.innerHTML = training(data.pending);
    wireTraining();
  } else if (data.pending) app.innerHTML = preview(data.pending);
  else app.innerHTML = today();
  if (view === 'progress' && trendId && !trendPoints) void loadTrend();
}
async function loadTrend() {
  const request = ++trendRequest;
  try {
    const points = await api('trend/' + trendId);
    if (request !== trendRequest) return;
    trendPoints = points;
    const content = document.querySelector('#trend-content');
    if (content) content.innerHTML = trends();
  } catch (error) { notify(error.message); }
}
async function mutation(path, body) {
  data = await api(path, body);
  if (data.summary) {
    recap = data.summary;
    selectedKind = undefined;
    trendPoints = undefined;
  }
  render();
}
document.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (event.isTrusted && (data?.pending?.started || control?.dataset.action === 'start')) enableWorkoutAudio();
  if (!control || busy || control.disabled) return;
  const action = control.dataset.action;
  const workout = data?.pending;
  const id = workout?.id;
  if (action === 'select') {
    selectedKind = control.dataset.kind;
    render();
    document.querySelector('[data-kind="' + selectedKind + '"]')?.focus({ preventScroll: true });
    return;
  }
  if (action === 'close') { dialog.close(); return; }
  if (action === 'trend-point') {
    control.closest('.trend-plot').querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    control.setAttribute('aria-pressed', 'true');
    trendSelection = Number(control.dataset.index);
    document.querySelector('#trend-reading').textContent = control.getAttribute('aria-label');
    return;
  }
  if (action === 'view-photo') {
    const exercise = exercises.get(control.dataset.id);
    showDialog(safe(exercise.name), '<img class="full-photo" src="' + safe(exercise.image) + '" alt="' +
      safe(exercise.name) + '">', 'photo-dialog');
    return;
  }
  if (action === 'clear-recap') { recap = undefined; render(); return; }
  if (action === 'rep-plus' || action === 'rep-minus') {
    const timed = exercises.get(workout.next.id).timed;
    activeValues.reps = Math.min(timed ? 600 : 100, Math.max(1, activeValues.reps + (action === 'rep-plus' ? 1 : -1)));
    document.querySelector('#rep-val').textContent = activeValues.reps + (timed ? 's' : '');
    return;
  }
  if (action === 'discard-preview' || action === 'discard-active') {
    showDialog('Discard workout?', '<p>' + (workout.started ? 'The sets logged in this unfinished workout will be deleted.' : 'This workout preview will be deleted.') +
      '</p><div class="dialog-actions">' + button('Keep workout', 'close', null, 'secondary') +
      button('Discard workout', 'discard', null, 'danger') + '</div>');
    return;
  }
  if (action === 'confirm-reset-data') {
    showDialog('Reset training data?', '<p>This permanently deletes your workout history and current workout, and restores default training preferences.</p>' +
      '<p id="reset-data-error" role="alert" hidden></p>' +
      '<div class="dialog-actions">' + button('Cancel', 'close', null, 'secondary', 'autofocus') +
      button('Reset data', 'reset-data', null, 'danger') + '</div>');
    return;
  }
  busy = true;
  if (action === 'skip-rest' || action === 'discard') scheduleRestAlarm(null);
  control.disabled = true;
  control.setAttribute('aria-busy','true');
  try {
    if (action === 'generate') {
      control.querySelector('span').textContent = 'Generating…';
      await mutation('generate', { kind: selectedKind || data.recommendation });
      window.scrollTo(0, 0);
    }
    if (action === 'start') {
      await mutation('start', { id });
      window.scrollTo(0, 0);
    }
    if (action === 'discard') { await mutation('discard', { id }); dialog.close(); }
    if (action === 'reset-data') {
      dialog.querySelector('#reset-data-error').hidden = true;
      data = await api('reset-data', { confirm: true });
      recap = undefined;
      selectedKind = undefined;
      trendPoints = undefined;
      trendRequest++;
      dialog.close();
      render();
      document.querySelector('[data-action="confirm-reset-data"]')?.focus({ preventScroll: true });
      notify('Training data reset.');
    }
    if (action === 'skip-rest') await mutation('skip-rest', { id, until: workout.rest_until });
    if (action === 'complete') {
      await mutation('set', { id, ordinal: workout.sets.length, ...activeValues });
      if (recap) window.scrollTo(0, 0);
      else document.querySelector('#rest-banner:not([hidden])')?.scrollIntoView({ block: 'nearest' });
    }
    if (action === 'exercise-preference') {
      const exerciseId = control.dataset.exerciseId;
      const excluded = control.dataset.excluded === 'true';
      await mutation('exercise-preference', { id: exerciseId, excluded });
      const name = exercises.get(exerciseId).name;
      notify(excluded ? name + ' excluded from future workouts.' : name + ' restored to your routine.');
      if (view === 'library') {
        const target = document.querySelector('[data-exercise-id="' + CSS.escape(exerciseId) + '"]') || document.querySelector('#routine');
        target?.focus({ preventScroll: true });
      }
    }
    if (action === 'swaps') {
      const index = Number(control.dataset.index);
      const from = workout.plan[index].id;
      const choices = await api('swaps', { id, index, from });
      showDialog('Swap exercise', choices.length ? choices.map(exercise => '<button class="swap-choice" data-action="swap" data-index="' +
        index + '" data-from="' + safe(from) + '" data-exercise="' + safe(exercise.id) + '">' + photo(exercise, '', false) +
        '<span><strong>' + safe(exercise.name) + '</strong><small>' + safe(exercise.muscle) + ' · ' +
        safe(exercise.gear.join(' + ')) + '</small></span>' + icon('swap', 17) + '</button>').join('') :
        '<p>No compatible replacements are available. Restore exercises in the library or update your equipment in Settings.</p>');
    }
    if (action === 'swap') {
      await mutation('swap', { id, index: Number(control.dataset.index), from: control.dataset.from, exercise: control.dataset.exercise });
      dialog.close();
    }
    if (action === 'history') {
      const result = await api('workout/' + control.dataset.id);
      showDialog(labels[result.kind] + ' workout', recapPanel(result));
    }
  } catch (error) {
    if (action === 'reset-data' && dialog.open) {
      const message = dialog.querySelector('#reset-data-error');
      message.hidden = false;
      message.textContent = error.message;
    } else notify(error.message);
    if (action === 'generate') control.querySelector('span').textContent = 'Generate workout';
    if (error.status === 409 && action !== 'generate') {
      try { data = await api('overview'); dialog.close(); render(); } catch { /* Keep the latest available view. */ }
    }
  } finally {
    busy = false;
    scheduleRestAlarm(data?.pending?.rest_until ?? null);
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkRestAlarm();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  filters.search = event.target.value;
  document.querySelector('#library-results').innerHTML = libraryGrid();
});
document.addEventListener('change', event => {
  const { id, value } = event.target;
  if (id === 'equipment' || id === 'region' || id === 'routine') {
    filters[id] = value;
    document.querySelector('#library-results').innerHTML = libraryGrid();
  }
  if (id === 'trend') {
    trendId = value;
    trendPoints = trendMetric = trendReps = trendSelection = undefined;
    render();
    document.querySelector('#trend')?.focus({ preventScroll: true });
  }
  if (id === 'metric' || id === 'trend-reps') {
    if (id === 'metric') trendMetric = value;
    else trendReps = Number(value);
    trendSelection = undefined;
    document.querySelector('#trend-content').innerHTML = trends();
    document.getElementById(id)?.focus({ preventScroll: true });
  }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = new FormData(event.target);
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    await mutation('settings', {
      split: form.get('split'), gear: ['Bodyweight', ...form.getAll('gear')],
      goal: Number(form.get('goal')), rest: Number(form.get('rest')), duration: Number(form.get('duration')),
    });
    selectedKind = undefined;
    notify('Training preferences saved.');
  } catch (error) { notify(error.message); }
  finally { busy = false; if (submit) submit.disabled = false; }
});
window.addEventListener('hashchange', () => {
  view = metaView();
  render();
  window.scrollTo(0, 0);
});
nav();
try {
  [data, library] = await Promise.all([api('overview'), api('catalog')]);
  exercises = new Map(library.map(item => [item.id, item]));
  render();
} catch (error) {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = '<section class="panel empty"><p>' + safe(error.message) + '</p><a href="/">Reload SportBoss</a></section>';
}
