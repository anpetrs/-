import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, resolveAnchor, allMonthDays } from '../scripts/lib/dates.mjs';
import { validateWriters, withAnchors, groupByDay, pickAuthorsOfDay, idsOnDate } from '../scripts/lib/data.mjs';
import { buildIcs, fold, escapeText } from '../scripts/lib/ics.mjs';
import { buildRss } from '../scripts/lib/rss.mjs';

test('parseDate: форматы и ошибки', () => {
  assert.deepEqual(parseDate('1892-10-08'), { year: 1892, md: '10-08' });
  assert.deepEqual(parseDate('1892'), { year: 1892, md: null });
  assert.deepEqual(parseDate('--10-08'), { year: null, md: '10-08' });
  assert.equal(parseDate(null), null);
  assert.throws(() => parseDate('1892-02-30'));
  assert.throws(() => parseDate('1900-02-29'));
  assert.deepEqual(parseDate('1904-02-29'), { year: 1904, md: '02-29' });
  assert.throws(() => parseDate('08.10.1892'));
});

test('resolveAnchor: рождение → смерть → публикация → 8 марта', () => {
  assert.deepEqual(resolveAnchor({ born: '1889-06-23', died: '1966-03-05' }), { md: '06-23', kind: 'birth', year: 1889 });
  assert.deepEqual(resolveAnchor({ born: '1889', died: '1966-03-05' }), { md: '03-05', kind: 'death', year: 1966 });
  assert.deepEqual(resolveAnchor({ died: '1966', firstPublished: '1912-04-01' }), { md: '04-01', kind: 'publication', year: 1912 });
  assert.deepEqual(resolveAnchor({ firstPublished: '1912' }), { md: '03-08', kind: 'march8', year: null });
  assert.deepEqual(resolveAnchor({}), { md: '03-08', kind: 'march8', year: null });
});

test('validateWriters ловит типичные ошибки', () => {
  const ok = { id: 'a', name: 'А', texts: [{ title: 't', kind: 'poem', text: 'x', url: 'https://example.com' }] };
  assert.deepEqual(validateWriters([ok]), []);
  assert.equal(validateWriters([ok, ok]).length, 1);
  assert.ok(validateWriters([{ ...ok, id: 'Bad Id' }]).length);
  assert.ok(validateWriters([{ ...ok, born: '31.12.1900' }]).length);
  assert.ok(validateWriters([{ ...ok, texts: [{ ...ok.texts[0], url: 'javascript:alert(1)' }] }]).length);
  assert.ok(validateWriters([{ ...ok, photo: '//evil.example/x.jpg' }]).length);
});

test('автор дня: детерминирован, покрывает 366 дней, пусто без текстов', () => {
  const ws = withAnchors([
    { id: 'a', name: 'A', texts: [{ title: '1', kind: 'poem', text: 'x' }, { title: '2', kind: 'poem', text: 'y' }] },
    { id: 'b', name: 'B', texts: [{ title: '3', kind: 'prose', text: 'z' }] },
  ]);
  const one = pickAuthorsOfDay(ws);
  assert.deepEqual(one, pickAuthorsOfDay(ws));
  assert.equal(Object.keys(one).length, 366);
  assert.equal(allMonthDays().length, 366);
  assert.deepEqual(pickAuthorsOfDay(withAnchors([{ id: 'c', name: 'C' }])), {});
});

test('29 февраля показывается 28-го в невисокосный год', () => {
  const ws = withAnchors([{ id: 'leap', name: 'L', born: '1904-02-29' }]);
  const byDay = groupByDay(ws);
  assert.deepEqual(idsOnDate(byDay, { year: 2026, month: 2, day: 28 }), ['leap']);
  assert.deepEqual(idsOnDate(byDay, { year: 2028, month: 2, day: 28 }), []);
  assert.deepEqual(idsOnDate(byDay, { year: 2028, month: 2, day: 29 }), ['leap']);
});

const cfg = { title: 'Т', description: 'Д, с запятой; и точкой', siteUrl: 'https://example.com/cal/' };

test('ICS: CRLF, строки ≤75 октетов, не режет кириллицу, RRULE', () => {
  const ws = withAnchors([
    { id: 'tsv', name: 'Марина Цветаева', born: '1892-10-08', bio: 'Очень длинная справка, ' + 'слово '.repeat(60) },
    { id: 'leap', name: 'Високосная', born: '1904-02-29' },
    { id: 'none', name: 'Без дат' },
  ]);
  const ics = buildIcs(ws, { ...cfg, now: new Date('2026-01-01T00:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(!ics.includes('�'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:🎂 Марина Цветаева (1892)'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20201008'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20200229'));
  assert.ok(unfolded.includes('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20200308'));
  assert.ok(unfolded.includes('X-WR-CALDESC:Д\\, с запятой\; и точкой'));
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length, 3);
});

test('ICS: fold и escapeText', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\;c\\\\d\\ne');
  const folded = fold('X:' + 'я'.repeat(100));
  assert.equal(folded.replace(/\r\n /g, ''), 'X:' + 'я'.repeat(100));
});

test('RSS: именинницы, автор дня на пустых днях, экранирование', () => {
  const ws = withAnchors([
    { id: 'a', name: 'Анна <&>', born: '1889-06-23', bio: 'Био', texts: [{ title: 'Т', kind: 'poem', text: 'строка\nдве', url: 'https://example.com/t' }] },
  ]);
  const xml = buildRss({
    writers: ws, byDay: groupByDay(ws), authorOfDay: pickAuthorsOfDay(ws), config: cfg, siteUrl: cfg.siteUrl,
    today: { year: 2026, month: 6, day: 23 }, days: 3, now: new Date('2026-06-23T10:00:00Z'),
  });
  assert.ok(xml.includes('Сегодня день рождения: Анна &lt;&amp;&gt; (137 лет)'));
  assert.equal((xml.match(/<item>/g) || []).length, 3); // 1 именинница + 2 «автора дня» за предыдущие дни
  assert.ok(xml.includes('Автор дня: Анна'));
  assert.ok(xml.includes('<guid isPermaLink="false">2026-06-23-a</guid>'));
});
