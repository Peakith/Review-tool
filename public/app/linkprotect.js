// Linkbeveiliging voor het team: wachtwoord en vervaldatum op review-, akkoord-, project-, oplever- en
// klantportaallinks. Het wachtwoord wordt nooit getoond of teruggegeven: het team geeft het zelf door,
// bij voorkeur apart van de link.
import { h, icon, button, api, toast, openDialog, field, formatDateZone, isoToLocal } from '/shared/util.js';

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

/** Kleine labels bij een link: beveiligd met wachtwoord, geldig tot (met tijdzone) of verlopen. */
export function protectionBadges(p) {
  if (!p) return null;
  return [
    p.hasPassword ? h('span', { class: 'badge badge-neutral', title: 'Wie de link opent, moet eerst het wachtwoord invullen' }, icon('lock'), 'wachtwoord') : null,
    p.expiresAt ? h('span', { class: `badge ${p.expired ? 'badge-danger' : 'badge-neutral'}`, title: p.expired ? 'Deze link geeft geen toegang meer' : 'Daarna geeft de link geen toegang meer' },
      icon('clock'), p.expired ? `verlopen ${formatDateZone(p.expiresAt)}` : `geldig tot ${formatDateZone(p.expiresAt)}`) : null,
  ];
}

/** Knop “Beveiliging” met dialoog. kind: share | project | delivery | client. */
export function protectionButton(kind, link, onDone, { label = 'Beveiliging' } = {}) {
  return button(label, { icon: 'lock', size: 'sm', variant: 'ghost', title: 'Wachtwoord en vervaldatum', onClick: () => protectionDialog(kind, link, onDone) });
}

export async function protectionDialog(kind, link, onDone) {
  const p = link.protection || {};
  const password = h('input', { type: 'password', autocomplete: 'new-password', minlength: '6', maxlength: '200', placeholder: p.hasPassword ? 'Leeg laten om het huidige te houden' : 'Minimaal 6 tekens' });
  const removePw = p.hasPassword ? h('input', { type: 'checkbox' }) : null;
  const current = isoToLocal(p.expiresAt);
  const date = h('input', { type: 'date', value: p.expiresAt ? current.date : '', 'aria-label': 'Vervaldatum' });
  const time = h('input', { type: 'time', value: p.expiresAt ? current.time : '23:59', 'aria-label': 'Tijd' });
  const noExpiry = h('input', { type: 'checkbox', checked: !p.expiresAt });
  const syncExpiry = () => { date.disabled = noExpiry.checked; time.disabled = noExpiry.checked; };
  noExpiry.addEventListener('change', syncExpiry);
  syncExpiry();
  let saved = false;
  await openDialog({
    title: 'Beveiliging van deze link',
    body: [
      h('p', { class: 'small muted' }, 'Geldt voor deze link en alles wat je ermee opent: video’s, afspelen, thumbnails, exports en downloads.'),
      field('Wachtwoord', password, p.hasPassword
        ? 'Er is een wachtwoord ingesteld. Een nieuw wachtwoord maakt eerder ontgrendelde browsers ongeldig.'
        : 'Optioneel. Geef het wachtwoord apart van de link door (bijvoorbeeld telefonisch). Het wordt niet leesbaar bewaard en is later niet op te vragen.'),
      removePw ? h('label', { class: 'check' }, removePw, 'Wachtwoord verwijderen (link weer zonder wachtwoord te openen)') : null,
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Geldig tot'),
        h('div', { class: 'share-form-row' }, date, time),
        h('label', { class: 'check' }, noExpiry, 'Geen vervaldatum'),
        h('div', { class: 'field-hint' }, `Tijd in jouw tijdzone${zone() ? ` (${zone()})` : ''}. Na deze datum werkt de link niet meer; goedkeuringen en feedback blijven gewoon geldig.`)),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async () => {
      const body = {};
      if (removePw?.checked) body.password = null;
      else if (password.value) {
        if (password.value.length < 6) { password.classList.add('input-error'); password.focus(); toast('Kies een wachtwoord van minimaal 6 tekens.', 'error'); return false; }
        body.password = password.value;
      }
      if (noExpiry.checked) { if (p.expiresAt) body.expiresAt = null; }
      else {
        if (!date.value) { date.classList.add('input-error'); date.focus(); toast('Kies een datum, of vink “Geen vervaldatum” aan.', 'error'); return false; }
        const iso = new Date(`${date.value}T${time.value || '23:59'}`).toISOString();
        if (iso !== p.expiresAt) body.expiresAt = iso;
      }
      if (!Object.keys(body).length) return true;
      try {
        await api('PUT', `/api/link-protection/${kind}/${link.id}`, body);
        saved = true;
        toast('Beveiliging opgeslagen', 'success');
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
  password.value = '';
  if (saved) onDone?.();
}
