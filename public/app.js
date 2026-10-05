const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const pad = (n) => String(n).padStart(2, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (m, y) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const years = (n) => `${n} ${plural(n, ['год', 'года', 'лет'])}`;

const now = new Date();
const TODAY = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };

let data;
let byId;
let includeSubs = false;
let lastView = '';

/* ---------- DOM ---------- */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
}
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const ext = (href, text, cls) => el('a', { href: safeUrl(href), target: '_blank', rel: 'noopener noreferrer', class: cls }, text);

function initials(name) {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
const photoCache = new Map();
/** Миниатюра из Википедии (REST API отдаёт CORS-заголовки); нет статьи или фото — null. */
function wikiPhoto(w) {
  if (!photoCache.has(w.id)) {
    const title = encodeURIComponent(w.wikiTitle.replace(/ /g, '_'));
    photoCache.set(w.id, fetch(`https://ru.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.type === 'standard' ? j.thumbnail?.source ?? null : null))
      .catch(() => null));
  }
  return photoCache.get(w.id);
}

function avatar(w, cls, onPhoto) {
  const fallback = () => el('span', { class: cls, 'aria-hidden': 'true' }, initials(w.name));
  const show = (node, src, fromWiki) => {
    const img = el('img', { class: cls, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    img.addEventListener('load', () => fromWiki && onPhoto?.());
    node.replaceWith(img);
  };
  const node = fallback();
  if (w.photo) { show(node, w.photo, false); return node; }
  wikiPhoto(w).then((src) => src && show(node, src, true));
  return node;
}

/* ---------- Данные ---------- */
const yearOf = (s) => (/^\d{4}/.test(s || '') ? Number(s.slice(0, 4)) : null);

function lifespan(w) {
  const b = yearOf(w.born), d = yearOf(w.died);
  if (b && d) return `${b} – ${d}`;
  if (b) return `род. ${b}`;
  if (d) return `ум. ${d}`;
  return '';
}

/** Кто отмечен в этот день; 29 февраля в невисокосный год показывается 28-го. */
function idsOn(year, month, day) {
  const md = `${pad(month)}-${pad(day)}`;
  const ids = [...(data.byDay[md] ?? [])];
  if (md === '02-28' && !isLeap(year)) ids.push(...(data.byDay['02-29'] ?? []));
  return ids;
}

function kindInfo(w, year) {
  const { kind, year: y, newStyle } = w.anchor;
  const n = y ? year - y : null;
  const ns = newStyle ? `по новому стилю — ${Number(newStyle.md.slice(3))} ${MONTHS_GEN[Number(newStyle.md.slice(0, 2)) - 1]}` : '';
  const join = (...a) => a.filter(Boolean).join(' · ');
  switch (kind) {
    case 'birth': return { label: 'День рождения', sub: false, note: join(ns, n > 0 && `${years(n)} со дня рождения`) };
    case 'death': return { label: 'День памяти', sub: true, note: join('Дата рождения неизвестна', ns, n > 0 && `${years(n)} со дня смерти`) };
    case 'publication': return { label: 'Первая публикация', sub: true, note: join('Даты рождения и смерти неизвестны', ns, n > 0 && `${years(n)} назад`) };
    default: return { label: '8 Марта', sub: true, note: 'Точных дат нет — писательница отмечена в Международный женский день' };
  }
}

function dayTitle(month, day, year) {
  const wd = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${day} ${MONTHS_GEN[month - 1]}, ${wd}`;
}

/* ---------- Компоненты ---------- */
/** Начало прозы (до `max` знаков, по границе абзаца или предложения). */
function excerpt(text, max = 900) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (at > max * 0.5 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '')).trim() + ' …';
}

/** Стихи (не охраняемые) показываем целиком; у прозы и охраняемых стихов — начало и ссылка на текст или магазин. */
function quote(text) {
  if (!text) return null;
  const prose = text.kind === 'prose' || text.partial;
  const link = safeUrl(text.url)
    ? [' · ', ext(text.url, prose ? `читать полностью: ${new URL(text.url).hostname.replace(/^www\./, '')} →` : 'источник')]
    : null;
  return el('blockquote', { class: 'quote' },
    text.kind === 'prose' ? excerpt(text.text) : text.text,
    el('cite', {}, `${text.title}${text.year ? `, ${text.year}` : ''}`, link),
  );
}

function writerCard(w, year, text, extra) {
  const info = kindInfo(w, year);
  return el('article', { class: `card${extra?.aod ? ' aod-card' : ''}` },
    avatar(w, 'pic'),
    el('div', {},
      el('h3', {}, el('a', { href: `#/w/${w.id}` }, w.name)),
      el('div', { class: 'meta' },
        extra?.aod
          ? el('span', { class: 'badge aod' }, 'Автор дня')
          : el('span', { class: `badge${info.sub ? ' sub' : ''}` }, info.label),
        [lifespan(w), extra?.aod ? '' : info.note].filter(Boolean).join(' · '),
      ),
      extra?.aod || !w.bio ? null : el('p', {}, w.bio),
      quote(text),
      el('div', { class: 'links' },
        el('a', { href: `#/w/${w.id}` }, 'Карточка автора'),
        ext(w.wiki, 'Википедия'),
        extra?.aod ? el('button', { class: 'linkbtn', type: 'button', onclick: () => render() }, 'Другой текст ↻') : null,
      ),
    ),
  );
}

/** «Автор дня»: случайный текст случайной писательницы; при каждом показе — новый. */
function randomText() {
  const pool = data.writers.flatMap((writer) => writer.texts.map((text) => ({ writer, text })));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function dayPanel(month, day, year) {
  const ids = idsOn(year, month, day);
  const writers = ids.map((id) => byId.get(id));
  const cards = writers.map((w) => writerCard(w, year, w.texts[0]));
  const hasBirthday = writers.some((w) => w.anchor.kind === 'birth');
  const pick = hasBirthday ? null : randomText();
  if (pick) cards.push(writerCard(pick.writer, year, pick.text, { aod: true }));
  const isToday = year === TODAY.year && month === TODAY.month && day === TODAY.day;
  return el('section', { class: 'panel', 'aria-live': 'polite' },
    el('h2', {}, (isToday ? 'Сегодня · ' : '') + dayTitle(month, day, year)),
    cards.length ? cards : el('p', { class: 'muted' }, 'В этот день пока никого нет.'),
  );
}

/* ---------- Календарь ---------- */
const hasSub = (month) => Object.entries(data.byDay).some(([md, ids]) => Number(md.slice(0, 2)) === month && ids.some((id) => byId.get(id).anchor.kind !== 'birth'));

function calendarView(month, day) {
  const year = TODAY.year;
  const prev = month === 1 ? 12 : month - 1;
  const next = month === 12 ? 1 : month + 1;
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const grid = el('div', { class: 'grid', role: 'grid' },
    ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => el('div', { class: 'dow' }, d)),
    Array.from({ length: offset }, () => el('div', { class: 'day blank' })),
  );
  for (let d = 1; d <= daysIn(month, year); d++) {
    const ws = idsOn(year, month, d).map((id) => byId.get(id));
    const cls = ['day', ws.length && 'has', d === day && 'sel', year === TODAY.year && month === TODAY.month && d === TODAY.day && 'today'];
    grid.append(el('a', { class: cls.filter(Boolean).join(' '), href: `#/d/${pad(month)}-${pad(d)}`, 'aria-current': d === day ? 'date' : null,
        'aria-label': `${d} ${MONTHS_GEN[month - 1]}${ws.length ? ': ' + ws.map((w) => w.name).join(', ') : ''}` },
      el('span', { class: 'n' }, d),
      el('span', { class: 'faces' },
        ws.slice(0, 3).map((w) => avatar(w, `face${w.anchor.kind === 'birth' ? '' : ' sub'}`)),
        ws.length > 3 ? el('span', { class: 'more' }, `+${ws.length - 3}`) : null,
      ),
    ));
  }
  return el('div', {},
    el('div', { class: 'toolbar' },
      el('a', { class: 'btn', href: `#/m/${pad(prev)}`, 'aria-label': 'Предыдущий месяц' }, '←'),
      el('h1', { class: 'month' }, `${MONTHS[month - 1]} ${year}`),
      el('a', { class: 'btn', href: `#/m/${pad(next)}`, 'aria-label': 'Следующий месяц' }, '→'),
      el('a', { class: 'btn', href: '#/' }, 'Сегодня'),
    ),
    grid,
    day ? dayPanel(month, day, year) : el('section', { class: 'panel' }, el('h2', {}, `${MONTHS[month - 1]}: кто и когда`), monthList(month)),
    hasSub(month) && el('p', { class: 'muted meta' }, 'Пунктирная рамка — писательница без известной даты рождения: она отмечена в день памяти, первой публикации или 8 Марта.'),
  );
}

/* ---------- Год ---------- */
const counts = () => {
  const c = {};
  for (const [md, ids] of Object.entries(data.byDay)) {
    c[md] = ids.filter((id) => includeSubs || byId.get(id).anchor.kind === 'birth').length;
  }
  return c;
};

function monthList(month) {
  const items = [];
  for (const [md, ids] of Object.entries(data.byDay)) {
    if (Number(md.slice(0, 2)) !== month) continue;
    for (const id of ids) {
      const w = byId.get(id);
      if (includeSubs || w.anchor.kind === 'birth') items.push({ d: Number(md.slice(3)), w });
    }
  }
  items.sort((a, b) => a.d - b.d || a.w.name.localeCompare(b.w.name, 'ru'));
  if (!items.length) return el('p', { class: 'muted' }, 'В этом месяце дней рождения пока нет.');
  return el('ul', { class: 'list' }, items.map(({ d, w }) => {
    const info = kindInfo(w, TODAY.year);
    return el('li', {},
      el('a', { class: 'when', href: `#/d/${pad(month)}-${pad(d)}` }, `${d} ${MONTHS_SHORT[month - 1]}`),
      el('span', {}, el('a', { href: `#/w/${w.id}` }, w.name), el('span', { class: 'muted' }, ` ${lifespan(w) ? '· ' + lifespan(w) : ''}${info.sub ? ' · ' + info.label.toLowerCase() : ''}`)),
    );
  }));
}

function yearView(selMonth) {
  const c = counts();
  const max = Math.max(1, ...Object.values(c));
  const level = (n) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)));
  const rows = [el('div', { class: 'hrow hhead' }, el('span'), Array.from({ length: 31 }, (_, i) => el('span', { class: 'd' }, (i + 1) % 5 === 0 || i === 0 ? i + 1 : '')), el('span'))];
  const totals = [];
  for (let m = 1; m <= 12; m++) {
    let total = 0;
    const cells = [];
    for (let d = 1; d <= 31; d++) {
      if (d > daysIn(m, 2000)) { cells.push(el('span', { class: 'cell off' })); continue; }
      const n = c[`${pad(m)}-${pad(d)}`] ?? 0;
      total += n;
      cells.push(el('a', { class: `cell l${level(n)}`, href: `#/d/${pad(m)}-${pad(d)}`, title: `${d} ${MONTHS_GEN[m - 1]}: ${n}`, 'aria-label': `${d} ${MONTHS_GEN[m - 1]}: ${n}` }));
    }
    totals.push(total);
    rows.push(el('div', { class: 'hrow' },
      el('a', { class: `m${m === selMonth ? ' sel' : ''}`, href: `#/year/${pad(m)}` }, MONTHS[m - 1]),
      cells,
      el('span', { class: 'tot' }, total),
    ));
  }
  const peak = totals.indexOf(Math.max(...totals));
  const checkbox = el('input', { type: 'checkbox', id: 'subs', checked: includeSubs, onchange: (e) => { includeSubs = e.target.checked; render(); } });
  return el('div', {},
    el('div', { class: 'toolbar' }, el('h1', {}, 'Год в днях рождения')),
    el('p', { class: 'muted' }, `Всего ${data.writers.length} · больше всего в ${['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][peak]} (${totals[peak]}). Нажмите на месяц, чтобы увидеть список, или на день, чтобы открыть его.`),
    el('label', { class: 'opt', for: 'subs' }, checkbox, 'Учитывать писательниц без даты рождения (день памяти, первая публикация, 8 Марта)'),
    el('div', { class: 'heat', role: 'group', 'aria-label': 'Тепловая карта дней рождения' }, rows),
    el('div', { class: 'legend' }, 'меньше', [0, 1, 2, 3, 4].map((l) => el('span', { class: `cell l${l}` })), `больше (до ${max} в день)`),
    selMonth ? el('section', { class: 'panel' }, el('h2', {}, `${MONTHS[selMonth - 1][0].toUpperCase() + MONTHS[selMonth - 1].slice(1)}: ${totals[selMonth - 1]}`), monthList(selMonth)) : null,
  );
}

/* ---------- Писательница ---------- */
function writerView(id) {
  const w = byId.get(id);
  if (!w) return el('p', {}, 'Такой писательницы нет. ', el('a', { href: '#/' }, 'К календарю'));
  document.title = `${w.name} — ${data.config.title}`;
  const info = kindInfo(w, TODAY.year);
  const [m, d] = w.anchor.md.split('-').map(Number);
  const credit = el('p', { class: 'meta', hidden: true }, 'Фото: ', ext(w.wiki, 'Википедия'), ' (автор и лицензия — на странице файла)');
  return el('article', {},
    el('a', { href: `#/d/${w.anchor.md}` }, `← ${d} ${MONTHS_GEN[m - 1]}`),
    el('div', { class: 'writer' },
      el('div', {}, avatar(w, 'pic', () => credit.removeAttribute('hidden')), credit),
      el('div', {},
        el('h1', {}, w.name),
        el('div', { class: 'meta' }, [w.realName ? `наст. имя: ${w.realName}` : '', lifespan(w)].filter(Boolean).join(' · ')),
        el('p', {}, el('span', { class: `badge${info.sub ? ' sub' : ''}` }, info.label), `${d} ${MONTHS_GEN[m - 1]} · ${info.note}`),
        w.bio ? el('p', {}, w.bio) : null,
        el('p', {}, ext(w.wiki, 'Читать о ней в Википедии →')),
        w.texts.length ? el('h2', {}, w.texts.length > 1 ? 'Тексты' : 'Текст') : null,
        w.texts.map((t) => quote(t)),
      ),
    ),
  );
}

/* ---------- Подписка ---------- */
function copyRow(value) {
  const input = el('input', { type: 'text', readonly: true, value, 'aria-label': 'Ссылка', onfocus: (e) => e.target.select() });
  const btn = el('button', { class: 'btn', type: 'button' }, 'Копировать');
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); } catch { input.select(); document.execCommand?.('copy'); }
    btn.textContent = 'Скопировано ✓';
    setTimeout(() => (btn.textContent = 'Копировать'), 2000);
  });
  return el('div', { class: 'copyrow' }, input, btn);
}

function subscribeView() {
  const base = new URL('.', location.href).href;
  const ics = base + 'calendar.ics';
  const webcal = ics.replace(/^https?:/, 'webcal:');
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  return el('div', {},
    el('div', { class: 'toolbar' }, el('h1', {}, 'Подключить календарь')),
    local ? el('p', { class: 'muted' }, 'Вы смотрите локальную копию: подписка по этим ссылкам заработает после публикации сайта.') : null,
    el('section', { class: 'box' },
      el('h2', {}, 'Google, Apple, Outlook'),
      el('p', { class: 'muted' }, 'Все дни рождения появятся в календаре с ежегодным повторением и будут обновляться сами, когда в базу добавят новых писательниц.'),
      el('div', { class: 'btns' },
        el('a', { class: 'btn primary', href: `https://calendar.google.com/calendar/r?cid=${webcal}`, target: '_blank', rel: 'noopener noreferrer' }, 'Добавить в Google Календарь'),
        el('a', { class: 'btn', href: webcal }, 'Apple Календарь / другое (webcal)'),
        el('a', { class: 'btn', href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(ics)}&name=${encodeURIComponent(data.config.title)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Outlook'),
      ),
      el('p', { class: 'meta' }, 'Или вставьте ссылку вручную («Добавить календарь → По URL»):'),
      copyRow(ics),
      el('p', { class: 'meta' }, 'Google обновляет подписные календари примерно раз в сутки. Разовый файл — ', el('a', { href: 'calendar.ics', download: 'writers-calendar.ics' }, 'скачать .ics'), '.'),
    ),
    el('section', { class: 'box' },
      el('h2', {}, 'RSS'),
      el('p', { class: 'muted' }, 'Каждый день — запись: у кого день рождения (или «автор дня», если именинниц нет).'),
      copyRow(base + 'feed.xml'),
    ),
    data.config.telegram ? el('section', { class: 'box' },
      el('h2', {}, 'Telegram'),
      el('p', { class: 'muted' }, 'Напоминания и подробные посты — в канале.'),
      ext(data.config.telegram, 'Открыть канал', 'btn primary'),
    ) : null,
  );
}

/* ---------- Роутинг ---------- */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  let m;
  if ((m = /^d\/(\d{2})-(\d{2})$/.exec(h))) return { view: 'calendar', month: +m[1], day: +m[2] };
  if ((m = /^m\/(\d{1,2})$/.exec(h)) && +m[1] >= 1 && +m[1] <= 12) {
    const month = +m[1];
    return { view: 'calendar', month, day: month === TODAY.month ? TODAY.day : null };
  }
  if ((m = /^w\/([a-z0-9-]+)$/.exec(h))) return { view: 'writer', id: m[1] };
  if ((m = /^year(?:\/(\d{2}))?$/.exec(h))) return { view: 'year', month: m[1] ? +m[1] : null };
  if (h === 'subscribe') return { view: 'subscribe' };
  return { view: 'calendar', month: TODAY.month, day: TODAY.day };
}

function render() {
  const r = parseRoute();
  const app = document.getElementById('app');
  let node;
  let title = data.config.title;
  if (r.view === 'calendar') { node = calendarView(r.month, r.day); title = `${MONTHS[r.month - 1]} — ${title}`; }
  else if (r.view === 'writer') node = writerView(r.id);
  else if (r.view === 'year') { node = yearView(r.month); title = `Год — ${title}`; }
  else { node = subscribeView(); title = `Подписка — ${title}`; }
  app.replaceChildren(node);
  if (r.view !== 'writer') document.title = title;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === r.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (r.view !== lastView) window.scrollTo(0, 0);
  lastView = r.view;
}

async function init() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    document.getElementById('app').textContent = 'Не удалось загрузить данные. Попробуйте обновить страницу.';
    return;
  }
  byId = new Map(data.writers.map((w) => [w.id, w]));
  document.getElementById('brand').textContent = data.config.title;
  const tg = safeUrl(data.config.telegram);
  if (tg) document.getElementById('foot-tg').append(ext(tg, 'Telegram-канал'), ' · ');
  window.addEventListener('hashchange', render);
  render();
}

init();
