import { idsOnDate } from './data.mjs';
import { pad } from './dates.mjs';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = xml;

const HEADLINE = {
  birth: (w, age) => `Сегодня день рождения: ${w.name}${age ? ` (${age})` : ''}`,
  death: (w) => `День памяти: ${w.name}`,
  publication: (w) => `Годовщина первой публикации: ${w.name}`,
  march8: (w) => `8 Марта: ${w.name}`,
};

function excerptHtml(text, writer) {
  if (!text) return '';
  const body = html(text.text).replace(/\n/g, '<br>');
  const link = text.url ? `<p><a href="${html(text.url)}">Читать полностью</a></p>` : '';
  return `<blockquote><p><b>${html(text.title)}</b></p><p>${body}</p></blockquote>${link}`;
}

/**
 * RSS: записи за последние `days` дней, включая сегодняшний.
 * today = {year, month, day} в часовом поясе проекта.
 */
export function buildRss({ writers, byDay, authorOfDay, config, siteUrl, today, days = 14, now = new Date() }) {
  const byId = new Map(writers.map((w) => [w.id, w]));
  const items = [];
  for (let back = 0; back < days; back++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const date = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const iso = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    const md = `${pad(date.month)}-${pad(date.day)}`;
    const ids = idsOnDate(byDay, date);
    for (const id of ids) {
      const w = byId.get(id);
      const age = w.anchor.kind === 'birth' && w.anchor.year ? `${date.year - w.anchor.year} лет` : '';
      items.push({
        title: HEADLINE[w.anchor.kind](w, age),
        link: `${siteUrl}#/w/${w.id}`,
        guid: `${iso}-${w.id}`,
        date: d,
        body: `<p>${html(w.bio ?? '')}</p>${excerptHtml(w.texts[0], w)}`,
      });
    }
    const hasBirthday = ids.some((id) => byId.get(id).anchor.kind === 'birth');
    const pick = authorOfDay[md];
    if (!hasBirthday && pick) {
      const w = byId.get(pick.writerId);
      items.push({
        title: `Автор дня: ${w.name}`,
        link: `${siteUrl}#/w/${w.id}`,
        guid: `${iso}-author-of-day`,
        date: d,
        body: excerptHtml(w.texts[pick.textIndex], w) + `<p>${html(w.name)} — <a href="${html(siteUrl)}#/w/${html(w.id)}">карточка автора</a></p>`,
      });
    }
  }
  const itemXml = items
    .map(
      (i) => `    <item>
      <title>${xml(i.title)}</title>
      <link>${xml(i.link)}</link>
      <guid isPermaLink="false">${xml(i.guid)}</guid>
      <pubDate>${i.date.toUTCString()}</pubDate>
      <description>${xml(i.body)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(config.title)}</title>
    <link>${xml(siteUrl)}</link>
    <description>${xml(config.description)}</description>
    <language>ru</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    <atom:link href="${xml(siteUrl)}feed.xml" rel="self" type="application/rss+xml"/>
${itemXml}
  </channel>
</rss>
`;
}
