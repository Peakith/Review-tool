// "Vraag aan klant" (teamkant): een vraag bewust delen met de klant en de antwoorden volgen.
// Los van interne feedbacktaken. Een antwoord verandert niets aan status of goedkeuring.
import { h, mount, icon, button, api, toast, confirmDialog, openDialog, field, formatDateZone, relativeDate, newRequestId, emptyState } from '/shared/util.js';

/**
 * Dialoog om een vraag te stellen. Met video (en versie) gaat de vraag over precies die versie;
 * zonder video over het hele project. Alleen gedeelde video's kunnen gekozen worden.
 */
export async function askDialog({ project, videos = [], video = null, version = null, onDone = () => {} }) {
  const text = h('textarea', { rows: '4', maxlength: '2000', required: true, autofocus: true, placeholder: 'Bijvoorbeeld: Klopt de spelling van de naam in de eindtitel?' });
  const shared = videos.filter((v) => v.sharedVersion);
  const pick = video ? null : h('select', {}, h('option', { value: '' }, 'Het hele project'), shared.map((v) => h('option', { value: v.id }, `${v.title} · klant ziet v${v.sharedVersion.number}`)));
  // Eén request-id per dialoog: dubbelklikken of opnieuw proberen maakt geen tweede vraag.
  const requestId = newRequestId();
  return openDialog({
    title: 'Vraag aan klant',
    body: [
      video ? h('p', { class: 'muted' }, `Over “${video.title}”${version ? `, versie ${version.number}` : ''}.`) : field('Waarover?', pick, 'Alleen video’s die de klant al ziet.'),
      field('Vraag', text),
      h('p', { class: 'small muted' }, icon('eye'), ' De klant ziet deze vraag onder “Jouw acties” in het klantportaal en de projectlink. Het antwoord verandert niets aan status of goedkeuring.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, icon('send'), h('span', { class: 'btn-label' }, 'Vraag delen met klant'))],
    onSubmit: async () => {
      if (!text.value.trim()) { text.focus(); return false; }
      const sel = video ? { videoId: video.id, versionId: version?.id || null } : (pick.value ? { videoId: Number(pick.value), versionId: shared.find((v) => v.id === Number(pick.value))?.sharedVersion?.id || null } : {});
      try {
        await api('POST', `/api/projects/${project.id}/questions`, { body: text.value, requestId, ...sel });
        toast('Vraag gedeeld met de klant', 'success');
        onDone();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

const STATUS = { open: ['Open', 'clock', 'is-open'], answered: ['Beantwoord', 'checkCircle', 'is-answered'], withdrawn: ['Ingetrokken', 'x', 'is-withdrawn'] };

/** Lijst met vragen voor een project (of één video). */
export async function questionsBlock({ project, videoId = null, canAsk = false, onAsk = null, compact = false }) {
  const host = h('div', { class: 'questions-block' });
  const load = async () => {
    const { questions } = await api('GET', `/api/projects/${project.id}/questions${videoId ? `?video=${videoId}` : ''}`);
    mount(host,
      questions.length
        ? h('ul', { class: 'question-list' }, questions.map((q) => {
          const [label, ic, cls] = STATUS[q.status] || STATUS.open;
          return h('li', { class: `question-item ${cls}` },
            h('div', { class: 'question-head' },
              h('span', { class: `question-status ${cls}` }, icon(ic), label),
              !videoId && q.videoTitle ? h('span', { class: 'small muted truncate' }, `${q.videoTitle}${q.versionNumber ? ` · v${q.versionNumber}` : ''}`) : null,
              h('span', { class: 'small muted', title: formatDateZone(q.createdAt) }, `${q.createdBy || 'Team'} · ${relativeDate(q.createdAt)}`)),
            h('p', { class: 'question-body' }, q.body),
            q.answer ? h('div', { class: 'question-answer' }, h('p', {}, q.answer.text),
              h('p', { class: 'small muted' }, `${q.answer.name}${q.answer.verified ? ' (persoonlijke link)' : ' (naam zelf ingevuld)'} · ${formatDateZone(q.answer.at)}`)) : null,
            q.status === 'open' && canAsk ? button('Intrekken', { size: 'sm', variant: 'ghost', onClick: async () => {
              if (!(await confirmDialog({ title: 'Vraag intrekken?', body: 'De klant ziet de vraag dan niet meer. Een gegeven antwoord blijft bewaard; intrekken kan alleen zolang de vraag open is.', confirmLabel: 'Intrekken', danger: true }))) return;
              try { await api('POST', `/api/questions/${q.id}/withdraw`); load(); } catch (err) { toast(err.message, 'error'); }
            } }) : null);
        }))
        : (compact ? h('p', { class: 'small muted' }, 'Nog geen vragen aan de klant.') : emptyState({ icon: 'help', compact: true, title: 'Nog geen vragen aan de klant', text: 'Stel een vraag als je iets van de klant moet weten. Het antwoord komt in je inbox.' })),
      canAsk && onAsk ? button('Vraag aan klant…', { icon: 'help', size: 'sm', onClick: () => onAsk(load) }) : null);
  };
  await load();
  return host;
}
