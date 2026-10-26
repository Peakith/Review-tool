// Persoonlijke inbox: meldingen over taken, vermeldingen, antwoorden, klantfeedback, goedkeuringen en
// opleveringen. Gelezen/ongelezen geldt per persoon. Browsermeldingen zijn optioneel: alleen na
// “Meldingen inschakelen”, en alleen zolang Studio Review in een tabblad openstaat.
import { h, mount, icon, button, api, toast, emptyState, errorState, skeletonRows, relativeDate, formatDate, plural } from '/shared/util.js';

const TYPE_ICON = { task_assigned: 'tasks', mention: 'chat', reply: 'reply', feedback: 'send', approval: 'checkCircle', approval_revoked: 'alert', delivery: 'package' };
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* privémodus */ } },
};

export async function viewInbox(ctx) {
  const { pageEl, pageHeader, navigate } = ctx;
  document.title = 'Inbox — Studio Review';
  const params = new URLSearchParams(location.search);
  const state = { filter: params.get('filter') === 'ongelezen' ? 'unread' : 'all', type: params.get('soort') || '' };
  const list = h('div', { class: 'inbox-list', 'aria-live': 'polite' });
  const filterBar = h('div', { class: 'inbox-filters' });
  const readAll = button('Alles gelezen', { icon: 'check', size: 'sm', onClick: async () => {
    try { const r = await api('POST', '/api/inbox/read-all'); toast(r.marked ? `${plural(r.marked, 'melding', 'meldingen')} als gelezen gemarkeerd` : 'Alles was al gelezen', 'success'); load(); refreshInboxCount(); } catch (err) { toast(err.message, 'error'); }
  } });
  let data = null;

  const sync = () => {
    const q = new URLSearchParams();
    if (state.filter === 'unread') q.set('filter', 'ongelezen');
    if (state.type) q.set('soort', state.type);
    history.replaceState(null, '', `/inbox${q.toString() ? `?${q}` : ''}`);
  };
  function drawFilters() {
    const types = data?.types || {};
    const sel = h('select', { 'aria-label': 'Soort melding' }, h('option', { value: '' }, 'Alle soorten'), Object.entries(types).map(([k, l]) => h('option', { value: k }, l)));
    sel.value = state.type;
    sel.addEventListener('change', () => { state.type = sel.value; sync(); load(); });
    mount(filterBar,
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Toon' },
        [['all', 'Alles'], ['unread', 'Ongelezen']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(state.filter === k), onClick: () => { state.filter = k; sync(); load(); } },
          l, k === 'unread' && data?.unread ? h('span', { class: 'seg-count' }, data.unread) : null))),
      sel,
      h('span', { class: 'spacer' }),
      readAll);
    readAll.disabled = !data?.unread;
  }

  async function load() {
    if (!data) mount(list, skeletonRows(4));
    const q = new URLSearchParams();
    if (state.filter === 'unread') q.set('filter', 'unread');
    if (state.type) q.set('type', state.type);
    try { data = await api('GET', `/api/inbox?${q}`); } catch (err) { mount(list, errorState(err, load)); return; }
    drawFilters();
    if (!data.items.length) {
      mount(list, h('div', { class: 'card' }, emptyState({
        icon: 'inbox', compact: true,
        title: state.filter === 'unread' || state.type ? 'Niets gevonden met dit filter' : 'Je inbox is leeg',
        text: state.filter === 'unread' ? 'Je hebt alles gelezen.' : 'Hier komen taken die aan jou worden toegewezen, vermeldingen (@naam), antwoorden in gesprekken die je volgt, en klantfeedback, goedkeuringen en opleveringen in projecten die je volgt.',
      })));
      return;
    }
    mount(list, data.items.map(row));
  }

  function row(n) {
    const open = async (e) => {
      e.preventDefault();
      try { const r = await api('POST', `/api/inbox/${n.id}/open`); refreshInboxCount(); navigate(r.href); } catch (err) { toast(err.message, 'error'); load(); }
    };
    const toggle = button(n.read ? 'Markeer als ongelezen' : 'Markeer als gelezen', { size: 'sm', variant: 'ghost', icon: n.read ? 'dashed' : 'check', onClick: async () => {
      try { await api('POST', `/api/inbox/${n.id}/read`, { read: !n.read }); load(); refreshInboxCount(); } catch (err) { toast(err.message, 'error'); }
    } });
    const unfollow = n.threadId ? button('Gesprek niet meer volgen', { size: 'sm', variant: 'ghost', icon: 'x', onClick: async () => {
      try { await api('PUT', `/api/follows/comment/${n.threadId}`, { follow: false }); toast('Je krijgt geen meldingen meer over antwoorden in dit gesprek (vermeldingen wel).', 'success'); } catch (err) { toast(err.message, 'error'); }
    } }) : null;
    return h('article', { class: `inbox-item${n.read ? '' : ' is-unread'}` },
      h('span', { class: `inbox-icon is-${n.type}` }, icon(TYPE_ICON[n.type] || 'info')),
      h('div', { class: 'inbox-main' },
        h('a', { href: n.href, class: 'inbox-title', onClick: open }, n.read ? null : h('span', { class: 'visually-hidden' }, 'Ongelezen: '), n.title),
        n.body ? h('p', { class: 'inbox-body small' }, n.body) : null,
        h('div', { class: 'inbox-meta small muted' }, n.typeLabel, ' · ', n.project, ' · ', h('time', { datetime: n.createdAt, title: formatDate(n.createdAt) }, relativeDate(n.createdAt)))),
      h('div', { class: 'inbox-actions' }, toggle, unfollow));
  }

  mount(pageEl, h('div', { class: 'page page-narrow inbox-page' },
    pageHeader({ title: 'Inbox' }),
    filterBar, list,
    await settingsCard()));
  drawFilters();
  await load();
}

/** Voorkeuren per soort en browsermeldingen (per browser, alleen na expliciete keuze). */
async function settingsCard() {
  const prefsEl = h('div', { class: 'inbox-prefs' });
  try {
    const { preferences } = await api('GET', '/api/inbox/preferences');
    mount(prefsEl, preferences.map((p) => {
      const box = h('input', { type: 'checkbox', checked: p.on });
      box.addEventListener('change', async () => {
        try { await api('PUT', '/api/inbox/preferences', { [p.key]: box.checked }); toast('Voorkeur opgeslagen', 'success'); } catch (err) { box.checked = !box.checked; toast(err.message, 'error'); }
      });
      return h('label', { class: 'check' }, box, p.label);
    }));
  } catch (err) { mount(prefsEl, errorState(err)); }

  const browserEl = h('div', { class: 'inbox-browser' });
  const drawBrowser = () => {
    if (!('Notification' in window)) {
      mount(browserEl, h('p', { class: 'small muted' }, 'Deze browser ondersteunt geen browsermeldingen. De inbox werkt gewoon.'));
      return;
    }
    const on = store.get('rt-notify') === '1' && Notification.permission === 'granted';
    mount(browserEl,
      h('p', { class: 'small' }, on ? h('strong', {}, 'Browsermeldingen staan aan in deze browser. ') : null,
        'Een melding verschijnt alleen zolang Studio Review in een tabblad openstaat en de app op deze Mac draait. Er wordt niets gemaild. Is het tabblad dicht of de app gestopt, dan zie je de meldingen later gewoon in je inbox.'),
      Notification.permission === 'denied'
        ? h('p', { class: 'notice notice-warn small' }, icon('alert'), 'Meldingen zijn voor deze site geblokkeerd in je browserinstellingen. Sta ze daar toe als je ze wilt gebruiken.')
        : on
          ? button('Browsermeldingen uitzetten', { size: 'sm', onClick: () => { store.set('rt-notify', '0'); drawBrowser(); } })
          : button('Meldingen inschakelen', { size: 'sm', icon: 'bell', variant: 'primary', onClick: async () => {
            const result = await Notification.requestPermission();
            if (result === 'granted') { store.set('rt-notify', '1'); toast('Browsermeldingen staan aan', 'success'); }
            drawBrowser();
          } }));
  };
  drawBrowser();
  return h('section', { class: 'card inbox-settings' },
    h('h2', { class: 'card-title' }, 'Meldingen'),
    h('p', { class: 'small muted' }, 'Kies waarover je een melding in je inbox wilt. Projecten volg je met “Volgen” op de projectpagina; een project dat je maakt, waarin je uploadt of publiceert, volg je automatisch. Gesprekken volg je zodra je erin schrijft of de taak hebt.'),
    prefsEl,
    h('h3', { class: 'inbox-subhead' }, 'Browsermeldingen'),
    browserEl,
    h('p', { class: 'small muted' }, 'Let op: de app draait nu alleen op deze Mac (localhost). Teamleden op andere computers kunnen hun inbox pas gebruiken als de app op een bereikbaar adres staat.'));
}

// ---------- Teller in de zijbalk en browsermeldingen ----------
let lastSeen = store.get('rt-notify-last') === null ? null : Number(store.get('rt-notify-last'));

/** Ververst de teller; toont browsermeldingen voor nieuwe items als de gebruiker dat heeft ingeschakeld. */
export async function refreshInboxCount() {
  let r;
  try { r = await api('GET', '/api/inbox/count'); } catch { return; }
  const el = document.getElementById('inbox-count');
  if (el) { el.textContent = String(r.unread); el.hidden = !r.unread; }
  // Eerste keer in deze browser: bestaande meldingen niet alsnog als pop-up tonen.
  if (lastSeen === null || Number.isNaN(lastSeen)) { lastSeen = Math.max(0, ...r.latest.map((n) => n.id)); store.set('rt-notify-last', String(lastSeen)); }
  const fresh = r.latest.filter((n) => n.id > lastSeen);
  if (fresh.length) {
    lastSeen = Math.max(...fresh.map((n) => n.id));
    store.set('rt-notify-last', String(lastSeen));
    if (store.get('rt-notify') === '1' && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
      for (const n of fresh.slice(0, 3)) {
        try {
          const note = new Notification(n.title, { body: n.body || '', tag: `studio-review-${n.id}` });
          note.onclick = () => { window.focus(); location.href = '/inbox'; };
        } catch { /* sommige browsers staan dit alleen via een service worker toe */ }
      }
    }
  }
}

let timer = null;
/** Elke 30 seconden (alleen met een open tabblad). */
export function startInboxPolling() {
  if (timer) return;
  refreshInboxCount();
  timer = setInterval(refreshInboxCount, 30_000);
}
