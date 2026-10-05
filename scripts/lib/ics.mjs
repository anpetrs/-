import { pad } from './dates.mjs';

const BASE_YEAR = 2020; // високосный: 29 февраля существует

export function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Складывает строку по 75 октетов, не разрезая UTF-8 символы (RFC 5545 §3.1). */
export function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const ymd = (y, md) => `${y}${md.slice(0, 2)}${md.slice(3)}`;

function nextDay(y, md) {
  const d = new Date(Date.UTC(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3)) + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function summary(w) {
  const y = w.anchor.year;
  switch (w.anchor.kind) {
    case 'birth': return `🎂 ${w.name}${y ? ` (${y})` : ''}`;
    case 'death': return `🕯 День памяти: ${w.name}`;
    case 'publication': return `📖 Первая публикация: ${w.name}`;
    default: return `🌷 ${w.name}`;
  }
}

function description(w, siteUrl) {
  const lines = [];
  if (w.anchor.kind === 'death') lines.push('Дата рождения неизвестна — событие привязано к дню памяти.');
  if (w.anchor.kind === 'publication') lines.push('Даты рождения и смерти неизвестны — событие привязано к дате первой публикации.');
  if (w.anchor.kind === 'march8') lines.push('Точных дат нет — писательница отмечена 8 марта.');
  if (w.bio) lines.push(w.bio);
  lines.push(`${siteUrl}#/w/${w.id}`);
  return lines.join('\n\n');
}

/** Календарь с ежегодно повторяющимися событиями. */
export function buildIcs(writers, { title, description: calDesc, siteUrl, now = new Date() }) {
  const host = new URL(siteUrl).host;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Writers Calendar//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(title)}`,
    `X-WR-CALDESC:${escapeText(calDesc)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:PT24H',
  ];
  for (const w of writers) {
    const { md } = w.anchor;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${w.id}@${host}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(BASE_YEAR, md)}`,
      `DTEND;VALUE=DATE:${nextDay(BASE_YEAR, md)}`,
      // 29 февраля в невисокосные годы переносится на 28-е
      md === '02-29' ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY',
      `SUMMARY:${escapeText(summary(w))}`,
      `DESCRIPTION:${escapeText(description(w, siteUrl))}`,
      `URL:${siteUrl}#/w/${w.id}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
