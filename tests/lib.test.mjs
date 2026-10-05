import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, resolveAnchor, allMonthDays, julianToGregorian, gregorianToJulian, isOldStyle } from '../scripts/lib/dates.mjs';
import { validateWriters, withAnchors, groupByDay, pickAuthorsOfDay, idsOnDate, isProtected, excerptPoem } from '../scripts/lib/data.mjs';
import { buildIcs, fold, escapeText } from '../scripts/lib/ics.mjs';
import { buildRss } from '../scripts/lib/rss.mjs';

test('parseDate: форматы и ошибки', () => {
  assert.deepEqual(parseDate('1892-10-08'), { year: 1892, md: '10-08' });
  assert.deepEqual(parseDate('1892'), { year: 1892, md: null });
  assert.deepEqual(parseDate('--10-08'), { year: null, md: '10-08' });
  assert.equal(parseDate(null), null);
  assert.throws(() => parseDate('1892-02-30'));
  assert.throws(() => parseDate('1937-02-29'));
  assert.throws(() => parseDate('1920-02-30'));
  assert.deepEqual(parseDate('1904-02-29'), { year: 1904, md: '02-29' });
  // 1900 — високосный год по юлианскому календарю, 1920 — по григорианскому
  assert.deepEqual(parseDate('1900-02-29'), { year: 1900, md: '02-29' });
  assert.throws(() => parseDate('1921-02-29'));
  assert.throws(() => parseDate('08.10.1892'));
});

test('resolveAnchor: рождение → смерть → публикация → 8 марта', () => {
  assert.deepEqual(resolveAnchor({ born: '1937-04-10', died: '2010-11-29' }), { md: '04-10', kind: 'birth', year: 1937 });
  assert.deepEqual(resolveAnchor({ born: '1937', died: '2010-11-29' }), { md: '11-29', kind: 'death', year: 2010 });
  assert.deepEqual(resolveAnchor({ died: '1966', firstPublished: '1912-04-01' }), { md: '04-01', kind: 'publication', year: 1912, newStyle: { year: 1912, md: '04-14' } });
  assert.deepEqual(resolveAnchor({ firstPublished: '1912' }), { md: '03-08', kind: 'march8', year: null });
  assert.deepEqual(resolveAnchor({}), { md: '03-08', kind: 'march8', year: null });
});

test('старый стиль: даты до 1918 года стоят в календаре по ст. ст., новый — в подписи', () => {
  const a = resolveAnchor({ born: '1892-09-26' });
  assert.equal(a.md, '09-26');
  assert.deepEqual(a.newStyle, { year: 1892, md: '10-08' });
  // разница 11 дней в XVIII веке, 12 — в XIX, 13 — в XX
  assert.deepEqual(julianToGregorian({ year: 1783, month: 9, day: 6 }), { year: 1783, month: 9, day: 17 });
  assert.deepEqual(julianToGregorian({ year: 1875, month: 1, day: 19 }), { year: 1875, month: 1, day: 31 });
  assert.deepEqual(julianToGregorian({ year: 1910, month: 5, day: 3 }), { year: 1910, month: 5, day: 16 });
  // пересчёт через границу года: 4 января 1812 (н. ст.) — это 23 декабря 1811 (ст. ст.)
  assert.deepEqual(gregorianToJulian({ year: 1812, month: 1, day: 4 }), { year: 1811, month: 12, day: 23 });
  // после реформы пересчёта нет
  assert.equal(resolveAnchor({ born: '1937-04-10' }).newStyle, undefined);
  assert.equal(isOldStyle(1918, '01-31'), true);
  assert.equal(isOldStyle(1918, '02-14'), false);
  assert.equal(isOldStyle(null, '02-14'), false);
});

test('validateWriters ловит типичные ошибки', () => {
  const ok = { id: 'a', name: 'А', texts: [{ title: 't', kind: 'poem', text: 'x', url: 'https://example.com' }] };
  assert.deepEqual(validateWriters([ok]), []);
  assert.equal(validateWriters([ok, ok]).length, 1);
  assert.ok(validateWriters([{ ...ok, id: 'Bad Id' }]).length);
  assert.ok(validateWriters([{ ...ok, born: '31.12.1900' }]).length);
  assert.ok(validateWriters([{ ...ok, texts: [{ ...ok.texts[0], url: 'javascript:alert(1)' }] }]).length);
  assert.ok(validateWriters([{ ...ok, photo: '//evil.example/x.jpg' }]).length);
  // проза — только со ссылкой на текст/магазин, но не на поисковик
  const prose = { title: 'p', kind: 'prose', text: 'x' };
  assert.ok(validateWriters([{ ...ok, texts: [prose] }]).length);
  assert.ok(validateWriters([{ ...ok, texts: [{ ...prose, url: 'https://www.google.com/search?q=x' }] }]).length);
  assert.deepEqual(validateWriters([{ ...ok, texts: [{ ...prose, url: 'https://example.com/book' }] }]), []);
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

test('охрана авторских прав: жизнь + 70 лет', () => {
  assert.equal(isProtected({ born: '1892-09-26', died: '1941' }), false); // Цветаева
  assert.equal(isProtected({ born: '1889', died: '1966' }), true); // Ахматова
  assert.equal(isProtected({ born: '1773', died: null }), false); // дата смерти неизвестна, давно
  assert.equal(isProtected({ born: '1987-06-30', died: null }), true); // жива
  assert.equal(isProtected({ born: '--05-02', died: null }), true);
});

test('excerptPoem: первая строфа, у коротких стихов не больше половины', () => {
  const long = 'а1\nа2\nа3\nа4\n\nб1\nб2\nб3\nб4\n\nв1\nв2';
  assert.equal(excerptPoem(long), 'а1\nа2\nа3\nа4\n…');
  assert.equal(excerptPoem('1\n2\n3\n4'), '1\n2\n…');
  assert.equal(excerptPoem('одна строка'), 'одна строка');
});
