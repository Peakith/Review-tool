// Feedback exporteren (PDF of CSV) voor één of meer video's. Interne notities en taken staan
// standaard uit; aanzetten markeert de export als INTERN.
import { h, icon, toast, openDialog, field, plural } from '/shared/util.js';

/** Download via fetch, zodat een fout een duidelijke melding geeft i.p.v. een kale foutpagina. */
export async function download(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Exporteren lukte niet (${res.status}).`);
  }
  const blob = await res.blob();
  const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'feedback');
  const a = h('a', { href: URL.createObjectURL(blob), download: name, class: 'visually-hidden' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return name;
}

export async function exportDialog({ projectId, videos, selected = null }) {
  let format = 'pdf';
  const checks = videos.map((v) => {
    const box = h('input', { type: 'checkbox', checked: !selected || selected.includes(v.id), value: v.id });
    return { v, box, el: h('label', { class: 'check export-video' }, box, h('span', { class: 'truncate' }, v.title)) };
  });
  const formatBox = h('div', { class: 'round-choice', role: 'radiogroup', 'aria-label': 'Formaat' });
  const drawFormat = () => formatBox.replaceChildren(...[['pdf', 'PDF', 'Overzichtelijk document met projectbranding en het videobeeld bij tekeningen. Om te delen of te printen.'],
    ['csv', 'CSV (Excel, Numbers)', 'Tabel met één regel per reactie en antwoord. Bijzondere tekens, komma’s en meerdere regels blijven goed.']].map(([k, label, hint]) =>
    h('label', { class: `round-option${format === k ? ' is-selected' : ''}` },
      h('input', { type: 'radio', name: 'format', value: k, checked: format === k, onChange: () => { format = k; drawFormat(); } }),
      h('span', {}, h('strong', {}, label), h('span', { class: 'small muted' }, hint)))));
  drawFormat();
  const internal = h('input', { type: 'checkbox' });
  const internalNote = h('div', { class: 'notice notice-warn', hidden: true }, icon('lock'), h('span', {}, h('strong', {}, 'Interne export. '), 'Bevat interne notities, taken (verantwoordelijke, toelichting) en niet-gepubliceerde versies. De export wordt op elke pagina en in de bestandsnaam als INTERN gemarkeerd. Niet met de klant delen.'));
  internal.addEventListener('change', () => { internalNote.hidden = !internal.checked; });
  await openDialog({
    title: 'Feedback exporteren',
    wide: true,
    body: [
      videos.length > 1 ? field(`Video’s (${videos.length})`, h('div', { class: 'export-videos' }, checks.map((c) => c.el))) : h('p', {}, h('strong', {}, videos[0].title)),
      h('h3', { class: 'dialog-sub' }, 'Formaat'),
      formatBox,
      h('label', { class: 'check' }, internal, 'Interne notities en taakgegevens opnemen'),
      internalNote,
      h('p', { class: 'small muted' }, 'Zonder deze optie bevat de export precies wat de klant mag zien: alleen gepubliceerde versies en zichtbare reacties.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, icon('fileDown'), h('span', { class: 'btn-label' }, 'Downloaden'))],
    onSubmit: async () => {
      const ids = checks.filter((c) => c.box.checked).map((c) => c.v.id);
      if (!ids.length) { toast('Kies minstens één video.', 'error'); return false; }
      const q = new URLSearchParams({ videos: ids.join(',') });
      if (internal.checked) q.set('intern', '1');
      try {
        const name = await download(`/api/projects/${projectId}/export.${format}?${q}`);
        toast(`${name} is gedownload (${plural(ids.length, 'video', 'video’s')}).`, 'success');
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}
