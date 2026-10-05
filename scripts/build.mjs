import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByDay, pickAuthorsOfDay, validateWriters, withAnchors } from './lib/data.mjs';
import { todayIn } from './lib/dates.mjs';
import { buildIcs } from './lib/ics.mjs';
import { buildRss } from './lib/rss.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const config = readJson('data/config.json');
const raw = readJson('data/writers.json');

const errors = validateWriters(raw);
if (errors.length) {
  console.error('Ошибки в data/writers.json:\n - ' + errors.join('\n - '));
  process.exit(1);
}

let siteUrl = process.env.SITE_URL || config.siteUrl;
if (!siteUrl.endsWith('/')) siteUrl += '/';

const channel = (config.telegram || '').replace(/\/$/, '');
const writers = withAnchors(raw).map(({ dateReview, ...w }) => (!w.telegram && w.tgPost && channel ? { ...w, telegram: `${channel}/${w.tgPost}` } : w));
const toReview = raw.filter((w) => w.dateReview).length;
const byDay = groupByDay(writers);
const authorOfDay = pickAuthorsOfDay(writers);
const now = new Date();
const today = todayIn(config.timezone, now);

const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
writeFileSync(join(dist, '.nojekyll'), '');

writeFileSync(
  join(dist, 'data.json'),
  JSON.stringify({
    config: { title: config.title, description: config.description, telegram: config.telegram, timezone: config.timezone },
    writers,
    byDay,
    authorOfDay,
  }),
);
writeFileSync(join(dist, 'calendar.ics'), buildIcs(writers, { title: config.title, description: config.description, siteUrl, now }));
writeFileSync(join(dist, 'feed.xml'), buildRss({ writers, byDay, authorOfDay, config, siteUrl, today, now }));

console.log(`Готово: ${writers.length} писательниц → dist/ (${siteUrl})`);
if (toReview) console.log(`Дат на проверку: ${toReview} (см. dateReview в data/writers.json и data/import-report.md)`);
