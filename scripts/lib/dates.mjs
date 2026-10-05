// Работа с датами писательниц. Даты в данных — строки:
//   "1892-10-08" — полная дата, "1892" — только год, "--10-08" — день и месяц без года, null — неизвестно.

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const FALLBACK_MD = '03-08';

const DATE_RE = /^(?:(\d{4})(?:-(\d{2})-(\d{2}))?|--(\d{2})-(\d{2}))$/;

/** @returns {{year:number|null, md:string|null} | null} */
export function parseDate(value) {
  if (value == null || value === '') return null;
  const m = DATE_RE.exec(String(value));
  if (!m) throw new Error(`Неверный формат даты: "${value}" (ожидается ГГГГ-ММ-ДД, ГГГГ или --ММ-ДД)`);
  const year = m[1] ? Number(m[1]) : null;
  const month = m[2] ?? m[4];
  const day = m[3] ?? m[5];
  if (!month) return { year, md: null };
  if (!isValidMonthDay(Number(month), Number(day))) throw new Error(`Несуществующая дата: "${value}"`);
  if (year !== null && !isValidFullDate(year, Number(month), Number(day))) throw new Error(`Несуществующая дата: "${value}"`);
  return { year, md: `${month}-${day}` };
}

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(month, year = 2000) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isValidMonthDay(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, 2000);
}

function isValidFullDate(year, month, day) {
  return day <= daysInMonth(month, year);
}

/**
 * Дата для календаря: рождение → смерть → первая публикация → 8 марта.
 * @returns {{md:string, kind:'birth'|'death'|'publication'|'march8', year:number|null}}
 */
export function resolveAnchor(writer) {
  const candidates = [
    ['birth', parseDate(writer.born)],
    ['death', parseDate(writer.died)],
    ['publication', parseDate(writer.firstPublished)],
  ];
  for (const [kind, d] of candidates) {
    if (d?.md) return { md: d.md, kind, year: d.year };
  }
  return { md: FALLBACK_MD, kind: 'march8', year: null };
}

/** Все "MM-DD" високосного года по порядку. */
export function allMonthDays() {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth(m, 2000); d++) out.push(`${pad(m)}-${pad(d)}`);
  }
  return out;
}

export const pad = (n) => String(n).padStart(2, '0');

/** Текущая дата в часовом поясе → {year, month, day}. */
export function todayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}
