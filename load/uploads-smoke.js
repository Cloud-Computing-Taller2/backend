// Prueba de humo: 5 usuarios durante 30 s suben archivos y esperan a que queden listos.
// Uso: k6 run -e BASE_URL=... -e TOKEN=... load/uploads-smoke.js
// Variables: BASE_URL, TOKEN o DEV_USER_ID, LIST=1 para listar la raíz.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { headers, BASE_URL, makePayload, waitUntilDone } from './lib.js';

const payload = makePayload(256 * 1024);

export const serverErrors = new Counter('server_errors');
export const timeToReady = new Trend('time_to_ready', true);

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    server_errors: ['count==0'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST /files}': ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  if (__ENV.LIST === '1') {
    const list = http.get(`${BASE_URL}/folders/root/contents`, {
      headers: headers(),
      tags: { name: 'GET /folders/root/contents' },
    });
    check(list, { 'listar responde 200': (r) => r.status === 200 });
  }

  const name = `k6-${__VU}-${__ITER}-${Date.now()}.png`;
  const started = Date.now();
  const res = http.post(
    `${BASE_URL}/files?folderId=root`,
    { file: http.file(payload, name, 'image/png') },
    { headers: headers(), tags: { name: 'POST /files' } },
  );
  if (res.status >= 500) serverErrors.add(1);
  const accepted = check(res, {
    'subida aceptada (202)': (r) => r.status === 202,
  });
  if (!accepted) return;

  const final = waitUntilDone(res.json('id'), serverErrors);
  check(final, { 'el worker la deja lista': (s) => s === 'ready' });
  if (final === 'ready') timeToReady.add(Date.now() - started);
  sleep(1);
}
