import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, localTime, transaction } from './lib/storage.mjs';

const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function configuration(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID;
  if (!token && !chat) return null;
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token || '') || !/^-?\d+$/.test(chat || '')) {
    throw new Error('Set a valid Telegram bot token and chat ID.');
  }
  let appUrl;
  try { appUrl = new URL(env.APP_URL); } catch { throw new Error('Set APP_URL to a complete URL.'); }
  if (!['https:', 'http:'].includes(appUrl.protocol) || appUrl.username || appUrl.password) {
    throw new Error('Set a valid APP_URL without credentials.');
  }
  const time = env.REMINDER_TIME || '18:00';
  const days = (env.REMINDER_DAYS || 'Mon,Wed,Fri').split(',').map(day => day.trim());
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || days.some(day => !weekdays.includes(day))) {
    throw new Error('Check REMINDER_TIME and REMINDER_DAYS.');
  }
  return { token, chat, appUrl, time, days };
}
function completedToday(db, day, clock) {
  return db.prepare('SELECT finished FROM workouts WHERE finished >= ?').all(clock() - 48 * 3600000)
    .some(workout => localTime(workout.finished).day === day);
}
export async function sendDueReminder(db, { token, chat, appUrl, time, days }, { request = fetch, clock = Date.now } = {}) {
  const now = localTime(clock());
  const weekday = new Date(now.day + 'T00:00:00Z').getUTCDay();
  if (now.time < time || !days.includes(weekdays[weekday])) return;
  const claimed = transaction(db, () => {
    if (completedToday(db, now.day, clock)) return false;
    const prior = db.prepare('SELECT state, attempted FROM reminders WHERE day=?').get(now.day);
    if (prior && (prior.state !== 'retry' || clock() - prior.attempted < 300000)) return false;
    db.prepare('INSERT OR REPLACE INTO reminders VALUES(?, ?, ?)').run(now.day, 'sending', clock());
    return true;
  });
  if (!claimed) return;
  const mark = state => db.prepare('UPDATE reminders SET state=?, attempted=? WHERE day=?').run(state, clock(), now.day);
  if (completedToday(db, now.day, clock)) { mark('skipped'); return; }
  try {
    const result = await request('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: 'Your workout is due today.\nOpen SportBoss: ' + appUrl.href, link_preview_options: { is_disabled: true } }),
    });
    const payload = await result.json();
    if (result.ok && payload.ok === true) mark('sent');
    else if (payload.ok === false) {
      mark(result.status === 429 || result.status >= 500 ? 'retry' : 'rejected');
      console.error('Telegram rejected a reminder with HTTP ' + result.status);
    } else mark('unknown');
  } catch {
    // Delivery may already have happened. Avoid duplicate reminders after an ambiguous result.
    mark('unknown');
    console.error('Telegram reminder delivery could not be confirmed.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = configuration(process.env);
  const location = process.env.DATA_DIR || 'data';
  const heartbeat = join(location, 'reminder-heartbeat');
  const db = openDatabase(location);
  console.log(settings ? 'Telegram reminders enabled in Asia/Jerusalem.' : 'Telegram reminders are idle until configured.');
  while (true) {
    writeFileSync(heartbeat, String(Date.now()));
    if (settings) await sendDueReminder(db, settings);
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
}
