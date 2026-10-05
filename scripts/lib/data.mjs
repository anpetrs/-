import { parseDate, resolveAnchor, allMonthDays, isLeap } from './dates.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = new Set(['poem', 'prose']);

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Проверяет данные и возвращает список ошибок (пустой — всё хорошо). */
export function validateWriters(writers) {
  const errors = [];
  const seen = new Set();
  if (!Array.isArray(writers)) return ['writers.json должен быть массивом'];
  writers.forEach((w, i) => {
    const where = `#${i + 1} ${w?.name ?? w?.id ?? ''}`.trim();
    const err = (msg) => errors.push(`${where}: ${msg}`);
    if (!w.id || !ID_RE.test(w.id)) err('id обязателен: латиница, цифры и дефис');
    else if (seen.has(w.id)) err(`повторяется id "${w.id}"`);
    else seen.add(w.id);
    if (!w.name?.trim()) err('нет имени (name)');
    for (const f of ['born', 'died', 'firstPublished']) {
      try {
        parseDate(w[f]);
      } catch (e) {
        err(`${f}: ${e.message}`);
      }
    }
    if (w.telegram && !isHttpUrl(w.telegram)) err('telegram: нужна ссылка http(s)');
    if (w.photo && (/^[a-z]+:/i.test(w.photo) || w.photo.startsWith('/') || w.photo.includes('..'))) {
      err('photo: путь должен быть относительным, например photos/akhmatova.jpg');
    }
    (w.texts ?? []).forEach((t, j) => {
      if (!t.title?.trim() || !t.text?.trim()) err(`texts[${j}]: нужны title и text`);
      if (!KINDS.has(t.kind)) err(`texts[${j}]: kind должен быть "poem" или "prose"`);
      if (t.url && !isHttpUrl(t.url)) err(`texts[${j}]: url должен быть ссылкой http(s)`);
    });
  });
  return errors;
}

/** Группировка по дням: { "06-23": [writerId, ...] } в порядке данных. */
export function groupByDay(writers) {
  const byDay = {};
  for (const w of writers) (byDay[w.anchor.md] ??= []).push(w.id);
  return byDay;
}

export function withAnchors(writers) {
  return writers.map((w) => ({ ...w, texts: w.texts ?? [], anchor: resolveAnchor(w) }));
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * «Автор дня» для RSS: на сайте текст выбирается случайно при каждом показе, но RSS статичен,
 * и записи за прошлые дни не должны меняться между сборками, поэтому для ленты — фиксированный выбор.
 * Для каждого дня года фиксированный текст. Тексты перемешаны
 * детерминированно и раздаются по кругу, поэтому повторяются как можно реже.
 * @returns {Record<string,{writerId:string,textIndex:number}>}
 */
export function pickAuthorsOfDay(writers) {
  const pool = [];
  for (const w of writers) w.texts.forEach((_, textIndex) => pool.push({ writerId: w.id, textIndex }));
  if (!pool.length) return {};
  const rnd = mulberry32(20240308);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = {};
  allMonthDays().forEach((md, i) => {
    out[md] = pool[i % pool.length];
  });
  return out;
}

/** Кто отмечен в этот день; 29 февраля в невисокосный год показывается 28-го. */
export function idsOnDate(byDay, { year, month, day }) {
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ids = [...(byDay[md] ?? [])];
  if (md === '02-28' && !isLeap(year)) ids.push(...(byDay['02-29'] ?? []));
  return ids;
}
