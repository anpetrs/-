// Импорт писательниц из выгрузки Telegram-канала (messages.html).
//
//   node scripts/import-telegram.mjs путь/к/messages.html [--photos] [--dry]
//
// Читает посты вида «11 июня по старому стилю родилась Анна Ахматова (1889–1966)» и стихи,
// которые идут следом, и ДОБАВЛЯЕТ в data/writers.json тех, кого там ещё нет (существующие записи не трогает).
// --photos  копирует фото поста из <папка выгрузки>/photos в public/photos и прописывает путь.
// --dry     ничего не пишет, только печатает отчёт.
// Всё, что скрипт не смог разобрать однозначно, попадает в data/import-report.md.
// Исправления вручную — в data/import-overrides.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gregorianToJulian, pad } from './lib/dates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Использование: node scripts/import-telegram.mjs messages.html [--photos] [--dry]');
  process.exit(1);
}
const DRY = args.includes('--dry');
const PHOTOS = args.includes('--photos');

const overridesPath = join(root, 'data/import-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
// С этого поста канал пишет даты по старому стилю (если в посте нет явной пометки).
const OLD_STYLE_FROM_POST = overrides.oldStyleFromPost ?? 2075;
const SKIP_POSTS = new Set(overrides.skipPosts ?? []);
const POST_NAMES = overrides.postNames ?? {}; // { "436": "Юлия Друнина" }
const ALIASES = overrides.aliases ?? {}; // { "Надежда Тэффи": { name, realName } }
const MANUAL = overrides.writers ?? {}; // { "Имя": { born, died, ... } } — перекрывает найденное

const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
const EN_MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
const MONTH_RE = Object.keys(MONTHS).join('|');

/* ---------- разбор HTML ---------- */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

function parseExport(html) {
  const out = [];
  for (const chunk of html.split(/(?=<div class="message (?:default|service))/)) {
    if (!chunk.startsWith('<div class="message default')) continue;
    const id = Number(/id="message(\d+)"/.exec(chunk)?.[1]);
    const dt = /class="pull_right date details" title="(\d+) (\w+) (\d{4}), (\d+):(\d+)/.exec(chunk);
    if (!id || !dt) continue;
    const raw = /<div class="text">\n?([\s\S]*?)\n?<\/div>/.exec(chunk)?.[1] ?? '';
    const text = decode(raw.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[️⃣]/g, '') // «1️⃣5️⃣ января» → «15 января»
      .replace(/⠀/g, '')
      .split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/(\S)[ \t]{2,}/g, '$1 ')).join('\n').trim();
    out.push({
      id,
      text,
      posted: { year: Number(dt[3]), month: EN_MONTHS[dt[2]], day: Number(dt[1]) },
      photos: [...chunk.matchAll(/class="photo_wrap[^"]*" href="([^"]+)"/g)].map((m) => m[1]),
    });
  }
  return out;
}

const sameDay = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;

/* ---------- имена, даты ---------- */
const NAME_WORD = /^(?:[А-ЯЁ][А-Яа-яЁё\-.]*|\([А-ЯЁ][^)]*\))[,.]?$/;
const NOT_NAME = new Set(['Сегодня', 'Вчера', 'Родилась', 'День', 'Также', 'Еще', 'Ещё', 'Москва', 'Петербург', 'Россия']);

function nameBefore(text, index) {
  const tokens = text.slice(0, index).trim().split(/\s+/);
  const picked = [];
  for (let i = tokens.length - 1; i >= 0 && picked.length < 6; i--) {
    if (!NAME_WORD.test(tokens[i]) || NOT_NAME.has(tokens[i]) || /[А-ЯЁ]{2,}/.test(tokens[i])) break;
    picked.unshift(tokens[i]);
  }
  const words = picked.filter((t) => !t.startsWith('('));
  // имя не может начинаться со слов в скобках
  while (picked.length && picked[0].startsWith('(')) picked.shift();
  return words.length >= 1 ? picked.join(' ').replace(/[,.]$/, '') : null;
}

const YEARS_RE = /\((\d{4})\s*[-–—]\s*(\d{4})?(\?)?\)/;

function findDate(head, posted) {
  const m = new RegExp(`(\\d{1,2})(?:-го)?\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`, 'i').exec(head);
  if (m) return { day: Number(m[1]), month: MONTHS[m[2].toLowerCase()], year: m[3] ? Number(m[3]) : null };
  const n = /(\d{1,2})\.(\d{2})\.(\d{4})/.exec(head);
  if (n) return { day: Number(n[1]), month: Number(n[2]), year: Number(n[3]) };
  if (/в этот день|сегодня/i.test(head)) return { day: posted.day, month: posted.month, year: null };
  return null;
}

function explicitStyle(head) {
  if (/по\s+нов[а-яё]+\s+стил|н\.\s*ст/i.test(head)) return 'new';
  if (/по\s+стар[а-яё]+\s+стил|ст\.\s*ст/i.test(head)) return 'old';
  return null;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Находит в посте «родилась …» и возвращает разобранные данные или null. */
function parseBirthPost(msg) {
  if (SKIP_POSTS.has(msg.id)) return null;
  const head = msg.text.replace(/^(?:#\S+\s*)+/, '').slice(0, 700);
  const verb = /родил(?:ась|ся|ись)/i.exec(head);
  if (!verb) return null;
  const forced = POST_NAMES[msg.id];
  const ym = YEARS_RE.exec(head);
  let name = forced ?? (ym ? nameBefore(head, ym.index) : null);
  if (!name) return null;
  const date = findDate(head, msg.posted) ?? (forced ? { ...msg.posted, year: null } : null);
  if (!date) return null;
  let born = ym ? Number(ym[1]) : date.year;
  const died = ym?.[2] ? Number(ym[2]) : null;
  if (!born) {
    const age = /(?:исполня[а-яё]+|исполнилось)\s+(\d+)/i.exec(head);
    if (age) born = msg.posted.year - Number(age[1]);
    const inYear = /(?:^|\s)в\s+(\d{4})\s*(?:г\.|году)/.exec(head);
    if (!born && inYear) born = Number(inYear[1]);
  }
  return {
    id: msg.id, name, md: { month: date.month, day: date.day }, born, died, uncertainDeath: !!ym?.[3],
    style: explicitStyle(head), posted: msg.posted, header: headerParagraph(msg.text, name),
  };
}

/* ---------- стиль даты ---------- */
// Даты рождения до 1918 года храним по старому стилю. Канал писал то по новому, то по старому,
// поэтому стиль каждого поста определяем так:
//   1) явная пометка «по старому/новому стилю»;
//   2) сдвиг на 11–13 дней между постами об одной писательнице (больший — новый стиль, меньший — старый);
//   3) иначе по дате поста: до OLD_STYLE_FROM_POST — новый, позже — старый (это предположение).
const mdKey = (p) => `${pad(p.md.month)}-${pad(p.md.day)}`;

function julianOfNew(p, year) {
  const j = gregorianToJulian({ year, month: p.md.month, day: p.md.day });
  return `${pad(j.month)}-${pad(j.day)}`;
}

/** @returns {Map<number,{style:'old'|'new', how:'explicit'|'shift'|'assumed'}>} по id постов */
function resolveStyles(posts, bornYear) {
  const out = new Map();
  const groups = new Map();
  for (const p of posts) (groups.get(mdKey(p)) ?? groups.set(mdKey(p), []).get(mdKey(p))).push(p);
  const style = new Map(); // mdKey -> {style, how}
  for (const [k, ps] of groups) {
    const ex = ps.find((p) => p.style);
    if (ex) style.set(k, { style: ex.style, how: 'explicit' });
  }
  for (const [a, pa] of groups) {
    for (const [b, pb] of groups) {
      if (a === b) continue;
      // a — это b, пересчитанное в старый стиль
      if (julianOfNew(pb[0], bornYear) === a) {
        if (!style.has(a)) style.set(a, { style: 'old', how: 'shift' });
        if (!style.has(b)) style.set(b, { style: 'new', how: 'shift' });
      }
    }
  }
  for (const [k, ps] of groups) {
    if (!style.has(k)) style.set(k, { style: ps.some((p) => p.id < OLD_STYLE_FROM_POST) ? 'new' : 'old', how: 'assumed' });
  }
  for (const p of posts) out.set(p.id, style.get(mdKey(p)));
  return out;
}

function gregorianToJulianNote(p, y) { const j = gregorianToJulian({ year: y, month: p.md.month, day: p.md.day }); return `${pad(j.day)}.${pad(j.month)}`; }

function celebrated(p, st, bornYear) {
  const { month, day } = p.md;
  if (!bornYear || bornYear >= 1918 || st.style === 'old') return { month, day, year: bornYear };
  return gregorianToJulian({ year: bornYear, month, day });
}

/* ---------- тексты ---------- */
/** Описание из первой фразы поста: то, что стоит до имени («поэтесса, переводчица»), и то, что после («– хозяйка салона»). */
function headerParagraph(text, name) {
  const clean = text.replace(/^(?:#\S+\s*)+/, '');
  const idx = clean.search(/родил(?:ась|ся|ись)/i);
  const para = clean.slice(idx).split('\n\n')[0].replace(/^родил(?:ась|ся|ись)\s*/i, '');
  const at = para.indexOf(name);
  const noise = /[\p{Extended_Pictographic}\uFE0F]/gu;
  const before = (at >= 0 ? para.slice(0, at) : para).replace(noise, '').replace(/\s*[-–—,]\s*$/, '').replace(/\s*\n\s*/g, ' ').trim();
  let after = at >= 0
    ? para.slice(at + name.length).replace(noise, '').replace(/^\s*\([^)]*\d{4}[^)]*\)/, '').replace(/^[\s,–—-]+/, '').replace(/\s*\n\s*/g, ' ').trim()
    : '';
  if (!/^[а-яё]/.test(after) || after.length < 12 || /сегодня|исполня|\(\d{4}/i.test(after)) after = '';
  return [before, after].filter(Boolean).join(', ');
}

// обращения к читателям и «кухня» канала — в справку не берём
const CHATTER = /(?:^|[\s,.(])(?:вы|вам|вас|мы|нам|мне|лично|обратите|приглядитесь|посмотрите)(?=[\s,.!?)]|$)/i;
const SKIP_PARAGRAPH = /^(?:[🖼📷🎨📸🎥🎬▶️]|#|\*обратите|https?:|Фото)/u;

function extraParagraph(text) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim());
  const at = paras.findIndex((p) => /родил(?:ась|ся|ись)/i.test(p));
  for (const p of paras.slice(at + 1)) {
    if (p.length < 60 || SKIP_PARAGRAPH.test(p) || /^[а-яё]/.test(p) || CHATTER.test(p)) continue;
    const lines = p.split('\n');
    if (looksLikePoem(p) || (lines.length >= 3 && p.length / lines.length < 60) || /https?:\/\//.test(p)) continue;
    return cutAtSentence(p.replace(/\s*\n\s*/g, ' '), 420);
  }
  return '';
}

function cutAtSentence(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

function looksLikePoem(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  if (/https?:\/\/|#\S/.test(text)) return false;
  const long = lines.filter((l) => l.length > 75).length;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return long <= 1 && avg < 48;
}

function parsePoem(text) {
  let lines = text.split('\n');
  let year = null;
  const label = /^\s*(?:\d{1,2}\s+[а-я]+\s+)?(\d{4})(?:\s*(?:г\.|года))?\s*$/.exec(lines[0]);
  if (label) { year = Number(label[1]); lines = lines.slice(1); }
  const trim = (ls) => { while (ls.length && !ls[0].trim()) ls = ls.slice(1); return ls; };
  lines = trim(lines);
  // «* * *», «***» — стихи без названия
  const bare = /^[\s*]+$/.test(lines[0] ?? '');
  if (bare) lines = trim(lines.slice(1));
  if (/^(?:\d{1,2}|[IVX]+)\.?\s*$/.test((lines[0] ?? '').trim())) lines = trim(lines.slice(1));
  const first = (lines[0] ?? '').trim();
  const isTitle = !bare && lines.length > 1 && lines[1].trim() === '' && first.length <= 60 && !/[,;]$/.test(first);
  const title = isTitle ? first.replace(/[.\s]+$/, '') : `${first.replace(/[,;:.\s]+$/, '')}…`;
  const stanzas = trim(isTitle ? lines.slice(1) : lines).join('\n').trim().split(/\n\s*\n/);
  const kept = [];
  let n = 0;
  for (const st of stanzas) {
    n += st.split('\n').length;
    if (kept.length && n > 20) { kept.push('…'); break; }
    kept.push(st);
  }
  return { title, kind: 'poem', year, text: kept.join('\n\n'), url: '' };
}

/* ---------- транслитерация id ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slug = (name) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[а-яё]/g, (c) => TR[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const keyOf = (name) => name.toLowerCase().replace(/ё/g, 'е').replace(/\s*\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

/* ---------- основной проход ---------- */
const messages = parseExport(readFileSync(resolve(file), 'utf8'));
const exportDir = dirname(resolve(file));

const byWriter = new Map();
const unparsed = [];
messages.forEach((msg, i) => {
  const post = parseBirthPost(msg);
  if (!post) {
    if (/родил(?:ась|ся|ись)/i.test(msg.text.slice(0, 400)) && /\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(msg.text.slice(0, 400)) && !SKIP_POSTS.has(msg.id)) {
      unparsed.push(msg);
    }
    return;
  }
  const alias = ALIASES[post.name];
  const name = alias?.name ?? post.name;
  const k = keyOf(name);
  if (!byWriter.has(k)) byWriter.set(k, { name, realName: alias?.realName ?? '', posts: [] });
  byWriter.get(k).posts.push({ ...post, index: i, msg });
});

const writers = [];
const report = { styleAssumed: [], conflicts: [], noTexts: [], noYear: [] };

for (const w of byWriter.values()) {
  const posts = w.posts.sort((a, b) => a.id - b.id);
  const manual = MANUAL[w.name] ?? {};
  const bornYear = manual.bornYear ?? posts.map((p) => p.born).find(Boolean) ?? null;
  const diedYear = posts.map((p) => p.died).find(Boolean) ?? null;

  const pre = bornYear && bornYear < 1918;
  const styles = pre ? resolveStyles(posts, bornYear) : null;
  const latest = posts[posts.length - 1];
  const c = pre ? celebrated(latest, styles.get(latest.id), bornYear) : { month: latest.md.month, day: latest.md.day, year: bornYear };
  const md = `${pad(c.month)}-${pad(c.day)}`;

  const notes = [];
  if (pre) {
    const dist = new Set(posts.map((p) => `${pad(celebrated(p, styles.get(p.id), bornYear).month)}-${pad(celebrated(p, styles.get(p.id), bornYear).day)}`));
    const st = styles.get(latest.id);
    if (dist.size > 1) {
      notes.push(`посты расходятся: ${posts.map((p) => { const x = celebrated(p, styles.get(p.id), bornYear); return `#${p.id} «${pad(p.md.day)}.${pad(p.md.month)}» → ${pad(x.day)}.${pad(x.month)}`; }).join('; ')}; взят последний`);
    } else if (st.how === 'assumed') {
      const alt = st.style === 'old' ? gregorianToJulianNote(latest, bornYear) : `${pad(latest.md.day)}.${pad(latest.md.month)}`;
      notes.push(`пост #${latest.id} «${pad(latest.md.day)}.${pad(latest.md.month)}»: стиль не указан, принят ${st.style === 'old' ? 'старый' : 'новый'} → в календаре ${pad(c.day)}.${pad(c.month)}; если был ${st.style === 'old' ? 'новый' : 'старый'} — ${alt}`);
    }
  }
  if (!bornYear) notes.push('год рождения неизвестен');
  // дата сверена по личному календарю или задана вручную — проверять не нужно
  if (manual.born || (overrides.confirmedByCalendar ?? []).includes(w.name)) notes.length = 0;

  const born = manual.born ?? (c.year ? `${c.year}-${md}` : `--${md}`);
  const died = manual.died ?? (diedYear ? String(diedYear) : null);

  // лучший пост для справки: самый содержательный, при равенстве — самый свежий
  const best = [...posts].sort((a, b) => (extraParagraph(b.msg.text).length - extraParagraph(a.msg.text).length) || b.id - a.id)[0];
  const header = cap(best.header || posts.map((p) => p.header).find(Boolean) || '');
  const extra = extraParagraph(best.msg.text);
  const bio = manual.bio ?? [header && (/[.!?…]$/.test(header) ? header : header + '.'), extra].filter(Boolean).join(' ');

  // стихи: сообщения сразу после поста в тот же день
  const texts = [];
  const seen = new Set();
  for (const p of [...posts].reverse()) {
    for (let j = p.index + 1; j < Math.min(messages.length, p.index + 5); j++) {
      const m = messages[j];
      if (!sameDay(m.posted, p.msg.posted) || parseBirthPost(m)) break;
      if (m.text && looksLikePoem(m.text) && !/видео|запис[ьи]|читает|ссылк|подборк|нашли|посмотр|слушайте|^Памяти/i.test(m.text.slice(0, 250))) {
        const poem = parsePoem(m.text);
        if (!seen.has(poem.title) && poem.text.length > 30) { seen.add(poem.title); texts.push({ ...poem, tgPost: m.id }); }
      }
    }
  }
  if (!texts.length) report.noTexts.push(w.name);

  const entry = {
    id: manual.id ?? slug(w.name),
    name: w.name,
    ...(w.realName ? { realName: w.realName } : {}),
    born,
    died,
    photo: '',
    bio,
    tgPost: latest.id,
    texts: texts.slice(0, 4),
    ...(notes.length ? { dateReview: notes.join(' | ') } : {}),
  };
  if (PHOTOS) {
    const src = best.msg.photos[0] ?? posts.flatMap((p) => p.msg.photos)[0];
    if (src && existsSync(join(exportDir, src))) {
      mkdirSync(join(root, 'public/photos'), { recursive: true });
      const ext = src.split('.').pop();
      copyFileSync(join(exportDir, src), join(root, `public/photos/${entry.id}.${ext}`));
      entry.photo = `photos/${entry.id}.${ext}`;
    }
  }
  writers.push(entry);
  if (entry.dateReview) report.styleAssumed.push(`${entry.name}: ${entry.dateReview}`);
}

// авторки, найденные только по дню памяти / вручную
for (const [name, m] of Object.entries(overrides.extraWriters ?? {})) {
  writers.push({ id: m.id ?? slug(name), name, ...m.realName ? { realName: m.realName } : {}, born: m.born ?? null, died: m.died ?? null, ...(m.firstPublished ? { firstPublished: m.firstPublished } : {}), photo: '', bio: m.bio ?? '', ...(m.tgPost ? { tgPost: m.tgPost } : {}), texts: [], ...(m.dateReview ? { dateReview: m.dateReview } : {}) });
}

writers.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/* ---------- запись ---------- */
const target = join(root, 'data/writers.json');
const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : [];
const have = new Set(existing.map((w) => w.id));
const fresh = writers.filter((w) => !have.has(w.id));
const merged = [...existing, ...fresh].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const lines = [
  '# Отчёт импорта из Telegram',
  '',
  `Постов разобрано: ${messages.length}. Писательниц найдено: ${writers.length}, добавлено новых: ${fresh.length}.`,
  '',
  `Стиль дат: посты начиная с #${OLD_STYLE_FROM_POST} считаются написанными по старому стилю, более ранние — по новому (если в посте нет пометки «по старому/новому стилю»). Даты рождения до 1918 года в данных хранятся по **старому стилю**.`,
  '',
  `## Проверить даты (${report.styleAssumed.length})`,
  '',
  ...report.styleAssumed.map((s) => `- ${s}`),
  '',
  `## Посты с «родилась» и датой, которые не удалось разобрать (${unparsed.length})`,
  '',
  ...unparsed.map((m) => `- #${m.id} (${m.posted.day}.${pad(m.posted.month)}.${m.posted.year}): ${m.text.slice(0, 140).replace(/\n/g, ' ')}`),
  '',
  `## Без найденных стихов (${report.noTexts.length})`,
  '',
  report.noTexts.join(', '),
  '',
];
console.log(lines.slice(0, 5).join('\n'));
if (!DRY) {
  writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
  writeFileSync(join(root, 'data/import-report.md'), lines.join('\n'));
  console.log('Записано: data/writers.json, data/import-report.md');
}
