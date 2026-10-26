import { h, mount, icon, api, toast } from '/shared/util.js';

/** Persoonlijk vastzetten (alleen voor jezelf; verandert niets voor anderen). */
export function pinButton(project, { compact = false, onChange = null } = {}) {
  const btn = h('button', { type: 'button', class: `pin-btn${compact ? ' is-compact' : ''}` });
  const draw = () => {
    btn.setAttribute('aria-pressed', String(!!project.pinned));
    btn.title = project.pinned ? 'Vastgezet: staat bovenaan je dashboard en projectenoverzicht. Klik om los te maken.' : 'Vastzetten op je dashboard en bovenaan het projectenoverzicht';
    btn.setAttribute('aria-label', project.pinned ? `${project.name} losmaken` : `${project.name} vastzetten`);
    mount(btn, icon('star'), compact ? null : h('span', { class: 'pin-label' }, project.pinned ? 'Vastgezet' : 'Vastzetten'));
  };
  draw();
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      project.pinned = (await api('PUT', `/api/pins/${project.id}`, { pinned: !project.pinned })).pinned;
      draw();
      onChange?.(project.pinned);
    } catch (err) { toast(err.message, 'error'); }
  });
  return btn;
}
