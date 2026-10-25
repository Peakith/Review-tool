// Personen in een project: koppelen, rol en einddatum, verlengen, intrekken en ontkoppelen.
// Projectleiders kiezen een bestaand persoon; alleen beheerders kunnen een nieuw account maken.
import { h, mount, icon, button, busy, api, toast, confirmDialog, openDialog, field, emptyState } from '/shared/util.js';
import { ROLE_LABEL, ACCOUNT_LABEL, rolesFor, expiryLabel, toLocalInput, fromLocalInput, timeZone } from './roles.js';
import { menuButton } from './admin.js';

export async function peopleDialog(project) {
  const listEl = h('div', { class: 'people-list' });
  const addEl = h('div', { class: 'people-add' });
  let data = null;

  const load = async () => {
    data = await api('GET', `/api/projects/${project.id}/members`);
    drawList();
  };
  const act = async (fn, msg) => {
    try { const r = await fn(); if (r?.members) data.members = r.members; toast(msg, 'success'); drawList(); return true; } catch (err) { toast(err.message, 'error'); return false; }
  };

  function drawList() {
    mount(listEl,
      data.members.length
        ? h('ul', { class: 'member-list' }, data.members.map(memberRow))
        : emptyState({ icon: 'users', compact: true, title: 'Nog niemand gekoppeld', text: 'Voeg iemand toe met de knop hieronder.' }),
      data.admins.length ? h('p', { class: 'small muted people-admins' }, icon('shield'), `Beheerders hebben altijd toegang: ${data.admins.map((a) => a.name).join(', ')}.`) : null);
  }

  function memberRow(m) {
    const items = [
      ['Rol wijzigen…', () => roleDialog(m), { icon: 'edit' }],
      [m.expiresAt ? 'Einddatum wijzigen of verlengen…' : 'Einddatum instellen…', () => expiryDialog(m), { icon: 'clock' }],
      m.active ? ['Toegang nu intrekken…', async () => {
        if (await confirmDialog({ title: `Toegang van ${m.name} nu intrekken?`, body: 'De toegang stopt direct, ook op een pagina die al openstaat. Reacties en geschiedenis blijven bewaard. Je kunt de toegang later bewust verlengen.', confirmLabel: 'Nu intrekken', danger: true })) {
          act(() => api('PATCH', `/api/projects/${project.id}/members/${m.userId}`, { expiresAt: 'now' }), `Toegang van ${m.name} is ingetrokken`);
        }
      }, { icon: 'lock', danger: true }] : null,
      ['Ontkoppelen…', async () => {
        if (await confirmDialog({ title: `${m.name} ontkoppelen?`, body: 'Deze persoon verdwijnt uit het project en heeft er geen toegang meer toe. Reacties, feedback en geschiedenis blijven bewaard.', confirmLabel: 'Ontkoppelen', danger: true })) {
          act(() => api('DELETE', `/api/projects/${project.id}/members/${m.userId}`), `${m.name} is ontkoppeld`);
        }
      }, { icon: 'trash', danger: true }],
    ].filter(Boolean);
    return h('li', { class: `member-row${m.active ? '' : ' is-disabled'}` },
      h('div', { class: 'member-main' },
        h('div', { class: 'member-name' }, h('strong', { class: 'truncate' }, m.name),
          h('span', { class: 'badge badge-neutral' }, m.roleLabel),
          m.accountRole === 'freelancer' ? h('span', { class: 'small muted' }, 'freelanceraccount') : null,
          m.disabled ? h('span', { class: 'badge badge-guest' }, 'Account uitgeschakeld') : null),
        h('div', { class: 'small muted truncate' }, m.email),
        m.expiresAt ? h('div', { class: 'small' }, expiryLabel(m.expiresAt)) : null),
      h('div', { class: 'member-actions' }, menuButton(items, `Acties voor ${m.name}`)));
  }

  async function roleDialog(m) {
    const sel = h('select', {}, rolesFor(m.accountRole).map((r) => h('option', { value: r.key, selected: r.key === m.role }, `${r.label} — ${r.short}`)));
    await openDialog({
      title: `Rol van ${m.name}`,
      body: [field('Rol in dit project', sel, m.accountRole === 'freelancer' ? 'Een freelanceraccount kan alleen de rol Freelancer hebben.' : null)],
      actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
      onSubmit: async () => (await act(() => api('PATCH', `/api/projects/${project.id}/members/${m.userId}`, { role: sel.value }), `Rol van ${m.name} is nu ${ROLE_LABEL[sel.value]}`)) || false,
    });
  }

  async function expiryDialog(m) {
    const input = h('input', { type: 'datetime-local', value: toLocalInput(m.expiresAt && Date.parse(m.expiresAt) > Date.now() ? m.expiresAt : null), required: false });
    await openDialog({
      title: `Toegang van ${m.name}`,
      body: [
        m.expiresAt ? h('p', {}, expiryLabel(m.expiresAt)) : null,
        field('Toegang tot', input, `Tijdzone ${timeZone()}. Leeg laten = geen einddatum. Verlopen toegang verleng je hier bewust.`),
      ],
      actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
      onSubmit: async () => (await act(() => api('PATCH', `/api/projects/${project.id}/members/${m.userId}`, { expiresAt: fromLocalInput(input.value) }), input.value ? `Toegang van ${m.name} geldt tot de gekozen datum` : `Toegang van ${m.name} heeft geen einddatum meer`)) || false,
    });
  }

  /** Persoon toevoegen: bestaand persoon kiezen (of als beheerder een account maken) → rol en toegang → opslaan. */
  async function drawAdd() {
    const candidates = await api('GET', `/api/projects/${project.id}/member-candidates`);
    const mode = { value: 'existing' };
    const person = h('select', { id: 'pp-person' }, h('option', { value: '' }, 'Kies een persoon…'),
      candidates.map((u) => h('option', { value: u.id, dataset: { account: u.accountRole } }, `${u.name} (${ACCOUNT_LABEL[u.accountRole]}) · ${u.email}`)));
    const name = h('input', { autocomplete: 'off' });
    const email = h('input', { type: 'email', autocomplete: 'off' });
    const password = h('input', { type: 'password', minlength: '10', autocomplete: 'new-password' });
    const accountRole = h('select', {}, h('option', { value: 'freelancer' }, 'Freelancer (alleen klantfeedback bekijken)'), h('option', { value: 'member' }, 'Teamlid'));
    const role = h('select', { id: 'pp-role' });
    const temporary = h('input', { type: 'checkbox' });
    const until = h('input', { type: 'datetime-local', disabled: true, 'aria-label': 'Toegang tot' });
    temporary.addEventListener('change', () => { until.disabled = !temporary.checked; if (temporary.checked) until.focus(); });
    const account = () => (mode.value === 'new' ? accountRole.value : person.selectedOptions[0]?.dataset.account || 'member');
    const drawRoles = () => {
      const opts = rolesFor(account());
      mount(role, opts.map((r) => h('option', { value: r.key }, `${r.label} — ${r.short}`)));
      // Standaard de lichtste rol; meer rechten kies je bewust.
      role.value = account() === 'freelancer' ? 'freelancer' : 'meekijker';
      // Freelancers krijgen standaard een einddatum aangeboden.
      if (account() === 'freelancer' && !temporary.checked) { temporary.checked = true; until.disabled = false; }
    };
    person.addEventListener('change', drawRoles);
    accountRole.addEventListener('change', drawRoles);
    drawRoles();
    const existingBox = h('div', {}, field('Persoon', person, candidates.length ? null : 'Iedereen met een account is al gekoppeld (of is beheerder).'));
    const newBox = h('div', { class: 'form-grid', hidden: true }, field('Naam', name), field('E-mailadres', email), field('Tijdelijk wachtwoord', password, 'Minimaal 10 tekens; deel het via een veilig kanaal.'), field('Soort account', accountRole));
    const modeSwitch = data.canCreateAccounts ? h('div', { class: 'segmented segmented-sm', role: 'group', 'aria-label': 'Bestaand persoon of nieuw account' },
      ...[['existing', 'Bestaand persoon'], ['new', 'Nieuw account']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(mode.value === k), onClick: (e) => {
        mode.value = k; existingBox.hidden = k !== 'existing'; newBox.hidden = k !== 'new';
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        drawRoles();
      } }, l))) : h('p', { class: 'small muted' }, 'Staat de persoon er niet tussen? Een beheerder kan een account maken.');
    // Geen eigen <form>: dit staat binnen het formulier van het dialoogvenster.
    const submit = async () => {
      if (mode.value === 'existing' && !person.value) { person.focus(); return; }
      if (temporary.checked && !until.value) { until.focus(); return; }
      const restore = busy(save);
      const body = { role: role.value, expiresAt: temporary.checked ? fromLocalInput(until.value) : null };
      if (mode.value === 'new') body.newAccount = { name: name.value, email: email.value, password: password.value, accountRole: accountRole.value };
      else body.userId = Number(person.value);
      const ok = await act(() => api('POST', `/api/projects/${project.id}/members`, body), 'Persoon toegevoegd aan het project');
      restore();
      if (ok) drawAdd();
    };
    const save = h('button', { type: 'button', class: 'btn btn-primary', onClick: submit }, icon('plus'), h('span', { class: 'btn-label' }, 'Toevoegen'));
    const form = h('div', { class: 'people-form', role: 'group', 'aria-labelledby': 'pp-add-h' },
    h('h3', { id: 'pp-add-h' }, 'Persoon toevoegen'),
    modeSwitch, existingBox, newBox,
    field('Rol', role),
    h('label', { class: 'check' }, temporary, 'Tijdelijke toegang'),
    h('div', { class: 'people-until' }, until, h('span', { class: 'small muted' }, `Tijdzone ${timeZone()}. Daarna stopt de toegang tot dit project automatisch; andere projecten blijven ongemoeid.`)),
    h('div', {}, save));
    mount(addEl, form);
  }

  await load();
  await drawAdd();
  await openDialog({
    title: `Personen in ${project.name}`,
    wide: true,
    body: [listEl, addEl],
    actions: [h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Klaar'))],
  });
}

export const peopleButton = (project) => button('Personen', { icon: 'users', onClick: () => peopleDialog(project), title: 'Wie heeft toegang tot dit project, met welke rol' });
