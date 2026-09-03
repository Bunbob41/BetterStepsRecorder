const $ = (id) => document.getElementById(id);

const el = {
  record: $('btn-record'), pause: $('btn-pause'), stop: $('btn-stop'), open: $('btn-open'),
  dot: $('dot'), status: $('status-text'), list: $('step-list'), count: $('count'),
  empty: $('empty'), detailEmpty: $('detail-empty'), detailBody: $('detail-body'),
  text: $('detail-text'), meta: $('detail-meta'), del: $('btn-delete'),
  shot: $('shot'), indicator: $('indicator'),
};

let steps = [];
let selectedId = null;
let state = 'idle';   // idle | recording | paused

// ---- rendering --------------------------------------------------------------

function setState(next) {
  state = next;
  el.dot.className = 'dot ' + (next === 'recording' ? 'rec' : next === 'paused' ? 'paused' : 'idle');
  el.status.textContent =
    next === 'recording' ? 'Recording' : next === 'paused' ? 'Paused' : 'Idle';

  el.record.disabled = next !== 'idle';
  el.pause.disabled = next === 'idle';
  el.stop.disabled = next === 'idle';
  el.pause.textContent = next === 'paused' ? 'Resume' : 'Pause';
  el.open.disabled = next !== 'idle';
}

function renderList() {
  el.count.textContent = String(steps.length);
  el.empty.hidden = steps.length > 0;
  el.list.replaceChildren();

  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step' + (s.id === selectedId ? ' selected' : '');
    li.dataset.id = s.id;

    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = String(i + 1);

    const label = document.createElement('div');
    label.className = 'label';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.text || s.action;

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = [s.window?.process, s.action].filter(Boolean).join(' · ');

    label.append(title, sub);
    li.append(n, label);
    li.addEventListener('click', () => select(s.id));
    el.list.append(li);
  });
}

async function select(id) {
  selectedId = id;
  renderList();

  const step = steps.find((s) => s.id === id);
  if (!step) return;

  el.detailEmpty.hidden = true;
  el.detailBody.hidden = false;
  el.text.value = step.text || '';
  el.meta.textContent = [
    `Step ${steps.indexOf(step) + 1}`,
    step.action,
    step.window?.title ? `"${step.window.title}"` : null,
    `${step.point.x}, ${step.point.y}`,
    step.monitor ? `${Math.round(step.monitor.scale * 100)}% scaling` : null,
  ].filter(Boolean).join('   ·   ');

  el.indicator.style.display = 'none';
  const url = await window.bsr.shotUrl(step.screenshot);
  el.shot.src = url || '';
  el.shot.onload = () => placeIndicator(step);
}

/**
 * The screenshot covers the window rect in physical pixels; the click point is
 * in physical virtual-desktop pixels. Subtract the window origin to get the
 * offset inside the image, then scale by however much the <img> is displayed at.
 * Doing this in CSS pixels instead is what makes indicators drift on scaled displays.
 */
function placeIndicator(step) {
  const rect = step.window?.rect;
  if (!rect || !el.shot.naturalWidth) return;

  const ratio = el.shot.clientWidth / el.shot.naturalWidth;
  const x = (step.point.x - rect.x) * ratio;
  const y = (step.point.y - rect.y) * ratio;

  if (x < 0 || y < 0 || x > el.shot.clientWidth || y > el.shot.clientHeight) return;

  el.indicator.style.left = `${x}px`;
  el.indicator.style.top = `${y}px`;
  el.indicator.style.display = 'block';
}

// ---- actions ----------------------------------------------------------------

el.record.addEventListener('click', async () => {
  const r = await window.bsr.startRecording();
  if (!r.ok) { alert(r.error); return; }
  steps = [];
  selectedId = null;
  renderList();
  setState('recording');
});

el.pause.addEventListener('click', async () => {
  if (state === 'paused') { await window.bsr.resumeRecording(); setState('recording'); }
  else { await window.bsr.pauseRecording(); setState('paused'); }
});

el.stop.addEventListener('click', async () => {
  await window.bsr.stopRecording();
  setState('idle');
});

el.open.addEventListener('click', async () => {
  const r = await window.bsr.openSession();
  if (!r.ok) return;
  steps = r.steps;
  selectedId = null;
  el.detailBody.hidden = true;
  el.detailEmpty.hidden = false;
  renderList();
});

el.del.addEventListener('click', async () => {
  if (!selectedId) return;
  await window.bsr.removeStep(selectedId);
  steps = steps.filter((s) => s.id !== selectedId);
  selectedId = null;
  el.detailBody.hidden = true;
  el.detailEmpty.hidden = false;
  renderList();
});

let saveTimer = null;
el.text.addEventListener('input', () => {
  const id = selectedId;
  clearTimeout(saveTimer);
  // Debounced: every keystroke would otherwise rewrite session.json.
  saveTimer = setTimeout(async () => {
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    step.text = el.text.value;
    await window.bsr.updateStep(id, { text: el.text.value });
    renderList();
  }, 300);
});

// ---- events from the capture engine ----------------------------------------

window.bsr.onStep(({ replaced, index, step }) => {
  if (replaced) steps[index] = step; else steps.push(step);
  renderList();

  // Follow the newest step unless the user is reading an older one.
  if (!selectedId || replaced) select(step.id);
  else el.list.lastElementChild?.scrollIntoView({ block: 'nearest' });
});

window.bsr.onError((m) => {
  console.error('[capture]', m);
  alert(`Capture engine error (${m.code}): ${m.message}`);
  setState('idle');
});

window.bsr.onExit(() => setState('idle'));
window.bsr.onLog((m) => console.log('[capture]', m.level, m.message));

setState('idle');
renderList();
