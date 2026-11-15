import {useStudio} from './store.js';

export async function api(path, data) {
  const token = useStudio.getState().data?.token;
  const options = data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Workbench-Token': token}, body: JSON.stringify(data)};
  let response;
  try { response = await fetch(path, {...options, cache: 'no-store'}); }
  catch { throw new Error('Lost connection to the local server. Make sure Content Tool is still running.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request failed. Try again.');
  return result;
}

export function upload(file, onProgress) {
  if (file.size > 512 * 1024 * 1024) return Promise.reject(new Error('Choose a file smaller than 512 MB.'));
  const store = useStudio.getState();
  store.uploading(1);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Workbench-Token', store.data.token);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      useStudio.getState().uploading(-1);
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) throw new Error(result.error || 'Upload failed.');
        useStudio.getState().addAsset(result);
        resolve(result);
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => { useStudio.getState().uploading(-1); reject(new Error('Upload interrupted. Check the local server and try again.')); };
    xhr.send(file);
  });
}

export function saveDownload(url) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url + (url.includes('?') ? '&' : '?') + 'download=1'; a.download = ''; a.click();
}
