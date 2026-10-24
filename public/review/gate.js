// Gedeeld voor de klantpagina's (review, portaal, oplevering): taalkeuze, foutmeldingen per soort
// (ingetrokken, verlopen, klanttoegang uit) en het wachtwoordscherm van een beveiligde link.
import { h, mount, icon, button, api, emptyState, formatDateZone } from '/shared/util.js';
import { tr, setLang, getLang } from '/shared/i18n.js';
import { THEMES, applyTheme, themePref } from '/shared/theme.js';

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* privémodus */ } },
};

/**
 * Taal van de pagina: een eerder gemaakte keuze van deze kijker (alleen in deze browser), anders de
 * standaardtaal van de klant. Inhoud (titels, reacties, briefing) wordt nooit vertaald.
 */
export function initLang(clientDefault) {
  const own = store.get('rt-lang');
  setLang(own === 'nl' || own === 'en' ? own : clientDefault || 'nl');
}

/** Kleine NL/EN-schakelaar. onChange wordt aangeroepen na het wisselen (pagina opnieuw opbouwen). */
export function langToggle(onChange) {
  const wrap = h('div', { class: 'segmented segmented-sm lang-toggle', role: 'group', 'aria-label': tr('Taal') });
  const draw = () => mount(wrap, [['nl', 'NL', 'Nederlands'], ['en', 'EN', 'English']].map(([key, label, full]) => h('button', {
    type: 'button', lang: key, 'aria-pressed': String(getLang() === key), 'aria-label': full, title: full,
    onClick: () => {
      if (getLang() === key) return;
      store.set('rt-lang', key);
      setLang(key);
      onChange();
    },
  }, label)));
  draw();
  return wrap;
}

/**
 * Kleine themakeuze voor bezoekers zonder account (Licht, Donker, Systeem), alleen in deze browser
 * onthouden. Zelfde keuze als het team in het profielmenu heeft.
 */
export function themeToggle() {
  const select = h('select', { class: 'theme-select', 'aria-label': tr('Thema'), title: tr('Thema') },
    THEMES.map(([key, label]) => h('option', { value: key }, tr(label))));
  select.value = themePref();
  select.addEventListener('change', () => applyTheme(select.value));
  return select;
}

/** Taal- en themakeuze naast elkaar (rechtsboven op klantpagina's). */
export function viewerControls(onLang) {
  return h('div', { class: 'viewer-controls' }, langToggle(onLang), themeToggle());
}

/** "Deze link is geldig tot …" (met tijdzone), alleen als er een vervaldatum is. */
export function expiryNote(iso) {
  if (!iso) return null;
  return h('p', { class: 'link-expiry small muted' }, icon('clock'), tr('Deze link is geldig tot {date}.', { date: formatDateZone(iso) }));
}

export function fatal(root, title, text, iconName = 'alert', retry) {
  document.title = title;
  mount(root, h('main', { class: 'fatal' }, emptyState({
    icon: iconName, title, text,
    action: retry ? button(tr('Opnieuw proberen'), { icon: 'refresh', onClick: retry }) : null,
  })));
}

/**
 * Toont de juiste melding bij een fout van een klantlink. Bij een wachtwoord: het invoerscherm.
 * kind/token bepalen welke link wordt ontgrendeld; daarna wordt onUnlocked aangeroepen.
 * Geeft false terug als de fout niet van de link komt (de pagina toont dan zelf iets).
 */
export function linkError(root, err, { kind, token, onUnlocked, retry }) {
  const data = err.data || {};
  if (data.language && !store.get('rt-lang')) setLang(data.language);
  switch (data.code) {
    case 'password_required':
      passwordScreen(root, { kind, token, onUnlocked });
      return true;
    case 'expired':
      fatal(root, tr('Deze link is verlopen'), data.expiresAt
        ? tr('Deze link was geldig tot {date}. Vraag het productieteam om een nieuwe link.', { date: formatDateZone(data.expiresAt) })
        : tr('Vraag het productieteam om een nieuwe link.'), 'clock');
      return true;
    case 'revoked':
      fatal(root, tr('Deze link werkt niet meer'), tr('De link is ingetrokken. Vraag het productieteam om een nieuwe link.'), 'lock');
      return true;
    case 'client_access_off':
      fatal(root, tr('Tijdelijk niet beschikbaar'), tr('Dit project is op dit moment niet beschikbaar. Neem contact op met het productieteam.'), 'lock');
      return true;
    case 'gone':
      fatal(root, tr('Niet meer beschikbaar'), tr('Deze video of dit project is niet meer beschikbaar. Neem contact op met het productieteam.'), 'lock');
      return true;
    default:
      break;
  }
  if (err.status === 410) { fatal(root, tr('Deze link werkt niet meer'), err.message, 'lock'); return true; }
  if (err.status === 404) { fatal(root, tr('Link niet gevonden'), tr('Controleer of je de volledige link hebt gekopieerd, of vraag het productieteam om een nieuwe link.'), 'link'); return true; }
  if (retry) { fatal(root, tr('Laden lukt niet'), err.message, 'alert', retry); return true; }
  return false;
}

/** Wachtwoordscherm. Het wachtwoord gaat alleen in de body van het verzoek, nooit in de URL. */
function passwordScreen(root, { kind, token, onUnlocked }) {
  document.title = tr('Beveiligde link');
  const input = h('input', { type: 'password', id: 'link-password', autocomplete: 'current-password', required: true, maxlength: '200' });
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, icon('lock'), h('span', { class: 'btn-label' }, tr('Openen')));
  const form = h('form', { class: 'gate-form', novalidate: true },
    h('label', { for: 'link-password', class: 'field-label' }, tr('Wachtwoord')),
    input, error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value) { input.focus(); return; }
    submit.disabled = true;
    error.hidden = true;
    try {
      await api('POST', `/api/unlock/${kind}/${encodeURIComponent(token)}`, { password: input.value });
      input.value = '';
      onUnlocked();
    } catch (err) {
      submit.disabled = false;
      error.hidden = false;
      error.textContent = err.data?.code === 'wrong_password' ? tr('Het wachtwoord klopt niet. Probeer het opnieuw.')
        : err.data?.code === 'too_many_attempts' ? tr('Te veel pogingen. Probeer het over een kwartier opnieuw.')
          : err.message;
      input.select();
    }
  });
  mount(root, h('main', { class: 'fatal gate' },
    h('div', { class: 'gate-card card' },
      h('div', { class: 'gate-head' }, icon('lock'), h('h1', {}, tr('Deze link is beveiligd'))),
      h('p', { class: 'muted' }, tr('Vul het wachtwoord in dat je van het productieteam hebt gekregen.')),
      form,
      h('div', { class: 'gate-lang' }, viewerControls(() => passwordScreen(root, { kind, token, onUnlocked }))))));
  input.focus();
}
