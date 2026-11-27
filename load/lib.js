import http from 'k6/http';
import { sleep } from 'k6';
import crypto from 'k6/crypto';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost/api';

export function headers() {
  if (__ENV.TOKEN) return { Authorization: `Bearer ${__ENV.TOKEN}` };
  if (__ENV.DEV_USER_ID) return { 'x-user-id': __ENV.DEV_USER_ID };
  throw new Error('Define TOKEN (JWT) o DEV_USER_ID para autenticar');
}

/** Genera bytes aleatorios para el archivo de prueba. */
export function makePayload(bytes) {
  return crypto.randomBytes(bytes);
}

/** Consulta el estado hasta que deje de estar en queued o uploading. */
export function waitUntilDone(id, serverErrors, timeoutSeconds = 30) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const r = http.get(`${BASE_URL}/files/${id}/status`, {
      headers: headers(),
      tags: { name: 'GET /files/:id/status' },
    });
    if (r.status >= 500) serverErrors.add(1);
    const status = r.status === 200 ? r.json('status') : `http_${r.status}`;
    if (status !== 'queued' && status !== 'uploading') return status;
    sleep(0.5);
  }
  return 'timeout';
}
