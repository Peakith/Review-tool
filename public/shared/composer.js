import { h, timecode } from './util.js';

/**
 * Invoerveld voor een nieuwe reactie. Bij focus pauzeert de video en wordt het
 * huidige tijdstip vastgezet; de reviewer kan het tijdstip ook uitzetten.
 */
export function createComposer({ player, onSubmit, placeholder = 'Schrijf een opmerking bij dit moment…', extraFields = null }) {
  let pinnedTime = 0;
  const ta = h('textarea', { rows: '3', placeholder, 'aria-label': 'Nieuwe reactie', maxlength: '5000' });
  const useTime = h('input', { type: 'checkbox', checked: true, id: 'composer-time' });
  const timeLabel = h('span', { class: 'composer-time-value' }, timecode(0));
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Reactie plaatsen');

  const pin = () => {
    pinnedTime = player.currentTime();
    timeLabel.textContent = timecode(pinnedTime);
  };
  ta.addEventListener('focus', () => { player.pause(); pin(); });
  player.video.addEventListener('seeked', () => { if (document.activeElement !== ta || !ta.value) pin(); });
  player.video.addEventListener('pause', pin);

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  const form = h('form', { class: 'composer', onSubmit: async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    submit.disabled = true;
    try {
      const ok = await onSubmit(body, useTime.checked ? pinnedTime : null);
      if (ok !== false) ta.value = '';
    } finally {
      submit.disabled = false;
    }
  } },
  extraFields,
  ta,
  h('div', { class: 'composer-bar' },
    h('label', { class: 'composer-time', for: 'composer-time' }, useTime, ' Koppel aan ', timeLabel),
    submit));

  return { el: form, focus: () => ta.focus(), setDisabled(disabled, reason) {
    ta.disabled = disabled; submit.disabled = disabled; useTime.disabled = disabled;
    ta.placeholder = disabled ? reason : placeholder;
  } };
}
