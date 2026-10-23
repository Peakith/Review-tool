// Upload in blokken met voortgang, automatische herhaalpogingen en hervatten.
const HEADERS = { 'x-requested-with': 'review-tool' };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function json(res) {
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Upload mislukt (${res.status})`), { status: res.status, data });
  return data;
}

async function request(url, opts = {}) {
  try {
    return await json(await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } }));
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('Geen verbinding met de server.'), { status: 0 });
  }
}

function putChunk(url, blob, onProgress, signal) {
  // XHR i.p.v. fetch zodat we voortgang binnen een blok kunnen tonen.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-requested-with', 'review-tool');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* geen json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data?.error || `Upload mislukt (${xhr.status})`), { status: xhr.status, data }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Verbinding onderbroken'), { status: 0 }));
    xhr.ontimeout = () => reject(Object.assign(new Error('Verbinding te traag'), { status: 0 }));
    const abort = () => { xhr.abort(); reject(Object.assign(new Error('Upload geannuleerd'), { aborted: true })); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(blob);
  });
}

/** Meldt een nieuwe upload aan bij de server. */
export function createUpload(file, target = {}) {
  return request('/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size: file.size, ...target }),
  });
}

export function cancelUpload(id) {
  return fetch(`/api/uploads/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
}

/**
 * Stuurt de (resterende) blokken. Begint bij wat de server al heeft, dus ook geschikt
 * om een onderbroken upload te hervatten. onProgress(fraction, sentBytes).
 */
export async function sendChunks(file, id, chunkSize, { onProgress = () => {}, onRetry = () => {}, signal } = {}) {
  let offset = (await request(`/api/uploads/${id}`)).receivedBytes;
  onProgress(offset / file.size, offset);
  let failures = 0;

  while (offset < file.size) {
    if (signal?.aborted) throw Object.assign(new Error('Upload geannuleerd'), { aborted: true });
    const chunk = file.slice(offset, offset + chunkSize);
    try {
      const res = await putChunk(`/api/uploads/${id}?offset=${offset}`, chunk, (loaded) => onProgress((offset + loaded) / file.size, offset + loaded), signal);
      offset = res.receivedBytes;
      failures = 0;
      onProgress(offset / file.size, offset);
    } catch (err) {
      if (err.aborted) throw err;
      if (err.status === 409 && Number.isFinite(err.data?.receivedBytes)) {
        offset = err.data.receivedBytes; // server weet tot waar het bestand binnen is
        continue;
      }
      if (err.status && err.status < 500 && err.status !== 408 && err.status !== 429) throw err;
      failures += 1;
      if (failures > 6) throw Object.assign(new Error('De verbinding viel herhaaldelijk weg. Controleer je netwerk en klik op "Opnieuw proberen"; de upload gaat verder waar hij was.'), { status: 0 });
      const wait = Math.min(30, 2 ** failures) * 1000;
      onRetry(failures, wait);
      await sleep(wait);
      try { offset = (await request(`/api/uploads/${id}`)).receivedBytes; } catch { /* volgende poging */ }
    }
  }
}
