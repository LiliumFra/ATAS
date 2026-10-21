const $ = (id) => document.getElementById(id);
const token = $('token');
const matchId = $('matchId');
const period = $('period');
const diagnostic = $('diagnostic');
const diagnosticClock = $('clock');
matchId.value = sessionStorage.getItem('atas.matchId') ?? '';
let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let manualDisconnect = false;
let lastChangeId = 0;
let catchUpPromise;

function secondsToUs(value) {
  const [minutes, seconds] = value.split(':').map(Number);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds < 0 || seconds >= 60) {
    throw new Error('Formato de tiempo inválido; usa mm:ss');
  }
  return Math.round((minutes * 60 + seconds) * 1_000_000);
}

function formatUs(value) {
  const milliseconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function sessionHeaders() {
  sessionStorage.setItem('atas.matchId', matchId.value.trim());
  const result = { 'content-type': 'application/json' };
  if (token.value.trim() !== '') result.authorization = `Bearer ${token.value.trim()}`;
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { ...sessionHeaders(), ...(options.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined;
  return response.json();
}

function notify(message, error = false) {
  const node = $('message');
  node.hidden = false;
  node.textContent = message;
  node.classList.toggle('error', error);
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    node.hidden = true;
  }, 4500);
}

function requireMatchId() {
  const value = matchId.value.trim();
  if (value === '') throw new Error('Ingresa el ID del partido');
  return value;
}

async function calculate() {
  const id = requireMatchId();
  const selectedPeriod = period.value;
  const path = diagnostic.checked
    ? `/v1/matches/${id}/estimate?period=${selectedPeriod}&nowUs=${secondsToUs(diagnosticClock.value)}`
    : `/v1/matches/${id}/estimate/live?period=${selectedPeriod}`;
  const result = await api(path);
  $('confirmed').textContent = formatUs(result.initialAllowanceUs);
  $('duringAdded').textContent = formatUs(result.lossDuringAddedTimeUs);
  $('rawCompensable').textContent = formatUs(result.rawCompensableUs);
  $('overlapDeducted').textContent = formatUs(result.overlapDeductedUs);
  $('board').textContent = `+${result.boardFloorMinutes} / +${result.boardCeilMinutes}`;
  $('target').textContent = formatUs(result.exactTargetEndUs);
  $('remaining').textContent = formatUs(result.remainingUs);
  $('integrity').textContent = `${result.integrity} · ${result.operationalRecommendation}`;
  $('integrity').className =
    result.operationalRecommendation === 'VALID' ? 'integrity-ok' : 'integrity-bad';
  $('clockStatus').textContent = result.clock
    ? `${result.clock.sourceId} · secuencia ${result.clock.sourceSequence} · ${result.clock.sampleAgeMs} ms · quórum ${result.clock.consensus.consistentFreshSources}/${result.clock.consensus.minimumFreshSources} · deriva ${result.clock.consensus.sourceDriftUs} µs`
    : 'Cálculo diagnóstico: reloj introducido manualmente';
  renderExplanation(result);
}

function shortId(value) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function renderExplanation(result) {
  const body = $('explanation');
  body.replaceChildren();
  for (const contribution of result.eventContributions ?? []) {
    const row = document.createElement('tr');
    cell(row, shortId(contribution.eventId));
    cell(row, contribution.kind);
    cell(row, formatUs(contribution.totalRawUs));
    cell(row, formatUs(contribution.exclusiveUs));
    cell(row, formatUs(contribution.sharedUs));
    cell(row, 'Incluido');
    body.append(row);
  }
  for (const excluded of result.excludedEvents ?? []) {
    const row = document.createElement('tr');
    cell(row, shortId(excluded.eventId));
    cell(row, excluded.kind);
    cell(row, '—');
    cell(row, '—');
    cell(row, '—');
    cell(row, `Excluido: ${excluded.reason}`);
    body.append(row);
  }
}

function cell(row, value) {
  const node = document.createElement('td');
  node.textContent = value;
  row.append(node);
}

async function refreshEvents() {
  const events = await api(`/v1/matches/${requireMatchId()}/events`);
  const body = $('events');
  body.replaceChildren();
  for (const event of events.filter((item) => item.period === period.value)) {
    const row = document.createElement('tr');
    cell(row, formatUs(event.startUs));
    cell(row, event.endUs === undefined ? 'Activo' : formatUs(event.endUs));
    cell(row, event.kind);
    cell(row, event.status);
    cell(row, String(event.revision));
    cell(row, event.source);
    body.append(row);
  }
}

async function resynchronise() {
  await Promise.all([calculate(), refreshEvents()]);
}

function cursorStorageKey() {
  return `atas.cursor.${matchId.value.trim()}`;
}

async function catchUpChanges() {
  if (catchUpPromise) return catchUpPromise;
  catchUpPromise = (async () => {
    const stored = Number.parseInt(sessionStorage.getItem(cursorStorageKey()) ?? '0', 10);
    lastChangeId = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
    let hasMore = true;
    let changed = false;
    while (hasMore) {
      const page = await api(
        `/v1/matches/${requireMatchId()}/changes?afterId=${lastChangeId}&limit=200`,
      );
      if (page.cursorExpired) {
        changed = true;
        notify('El cursor local expiró; se realizó una resincronización completa');
      }
      if (page.changes.length > 0) changed = true;
      lastChangeId = page.cursor;
      sessionStorage.setItem(cursorStorageKey(), String(lastChangeId));
      hasMore = page.hasMore;
    }
    if (changed) await resynchronise();
  })().finally(() => {
    catchUpPromise = undefined;
  });
  return catchUpPromise;
}

function setConnection(text, className) {
  $('connection').textContent = text;
  $('connection').className = `status ${className}`;
}

function scheduleReconnect() {
  if (manualDisconnect || matchId.value.trim() === '') return;
  clearTimeout(reconnectTimer);
  const delay = Math.min(30_000, 500 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 250);
  reconnectAttempt += 1;
  setConnection(`Reconectando en ${Math.ceil(delay / 1000)} s`, 'neutral');
  reconnectTimer = setTimeout(connect, delay);
}

function connect() {
  manualDisconnect = false;
  clearTimeout(reconnectTimer);
  socket?.close();
  const id = requireMatchId();
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const protocols = ['atas-v1'];
  if (token.value.trim() !== '') protocols.push(`jwt.${token.value.trim()}`);
  socket = new WebSocket(`${protocol}://${location.host}/v1/matches/${id}/stream`, protocols);
  setConnection('Conectando', 'neutral');
  socket.onopen = () => {
    reconnectAttempt = 0;
    setConnection('Conectado', 'ok');
    void catchUpChanges()
      .then(resynchronise)
      .catch((error) => notify(error.message, true));
  };
  socket.onclose = () => {
    setConnection('Desconectado', 'bad');
    scheduleReconnect();
  };
  socket.onerror = () => socket?.close();
  socket.onmessage = () => void catchUpChanges().catch((error) => notify(error.message, true));
}

diagnostic.addEventListener('change', () => {
  diagnosticClock.disabled = !diagnostic.checked;
  void calculate().catch((error) => notify(error.message, true));
});
period.addEventListener(
  'change',
  () => void resynchronise().catch((error) => notify(error.message, true)),
);
$('calculate').addEventListener(
  'click',
  () => void calculate().catch((error) => notify(error.message, true)),
);
$('refreshEvents').addEventListener(
  'click',
  () => void refreshEvents().catch((error) => notify(error.message, true)),
);
$('connect').addEventListener('click', () => {
  try {
    connect();
  } catch (error) {
    notify(error.message, true);
  }
});
$('addEvent').addEventListener('click', () => {
  const end = $('eventEnd').value.trim();
  const payload = {
    eventId: crypto.randomUUID(),
    period: period.value,
    kind: $('eventKind').value,
    source: 'OPERATOR',
    status: $('eventStatus').value,
    startUs: secondsToUs($('eventStart').value),
    ...(end === '' ? {} : { endUs: secondsToUs(end) }),
    confidence: 1,
    evidence: { enteredFrom: 'web-console' },
  };
  void api(`/v1/matches/${requireMatchId()}/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
    .then(resynchronise)
    .then(() => notify('Evento registrado'))
    .catch((error) => notify(error.message, true));
});
window.addEventListener('beforeunload', () => {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  socket?.close();
});
