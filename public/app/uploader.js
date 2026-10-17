// Upload in blokken met voortgang, automatische herhaalpogingen en hervatten.
const HEADERS = { 'x-requested-with': 'review-tool' };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function json(res) {
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Upload mislukt (${res.status})`), { status: res.status, data });
  return data;
}

function putChunk(url, blob, onProgress, signal) {
  // XHR i.p.v. fetch zodat we voortgang binnen een blok kunnen tonen.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-requested-with', 'review-tool');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* geen json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data?.error || `Upload mislukt (${xhr.status})`), { status: xhr.status, data }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Verbinding onderbroken'), { status: 0 }));
    signal?.addEventListener('abort', () => { xhr.abort(); reject(Object.assign(new Error('Upload geannuleerd'), { aborted: true })); });
    xhr.send(blob);
  });
}

/**
 * Uploadt een bestand en geeft het upload-id terug.
 * onProgress(fraction, sentBytes) wordt tijdens het uploaden aangeroepen.
 */
export async function uploadFile(file, { onProgress = () => {}, onRetry = () => {}, signal } = {}) {
  const init = await json(await fetch('/api/uploads', {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size: file.size }),
  }));
  const { id, chunkSize } = init;
  let offset = 0;
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
      if (err.aborted) {
        fetch(`/api/uploads/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
        throw err;
      }
      if (err.status === 409 && Number.isFinite(err.data?.receivedBytes)) {
        offset = err.data.receivedBytes; // server weet tot waar het bestand binnen is
        continue;
      }
      if (err.status && err.status < 500 && err.status !== 408 && err.status !== 429) throw err;
      failures += 1;
      if (failures > 6) throw new Error('De upload is na meerdere pogingen mislukt. Controleer je verbinding en probeer het opnieuw.');
      const wait = Math.min(30, 2 ** failures) * 1000;
      onRetry(failures, wait);
      await sleep(wait);
      try {
        const status = await json(await fetch(`/api/uploads/${id}`, { headers: HEADERS }));
        offset = status.receivedBytes;
      } catch { /* volgende poging */ }
    }
  }
  return id;
}
