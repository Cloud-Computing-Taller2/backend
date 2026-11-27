// Prueba de carga sobre POST /files, hasta RATE subidas por segundo.
// Uso: k6 run -e BASE_URL=... -e TOKEN=... -e RATE=20 load/uploads-load.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  headers,
  BASE_URL,
  FOLDER_ID,
  makePayload,
  waitUntilDone,
} from './lib.js';

const RATE = Number(__ENV.RATE || 20);
const SIZE_KB = Number(__ENV.SIZE_KB || 512);
const payload = makePayload(SIZE_KB * 1024);

export const serverErrors = new Counter('server_errors');
export const timeToReady = new Trend('time_to_ready', true);

export const options = {
  scenarios: {
    rafaga: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: '15s', target: RATE },
        { duration: '30s', target: RATE },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    'checks{check:subida aceptada (202)}': ['rate>0.99'],
    'checks{check:el worker la deja lista}': ['rate>0.99'],
    'http_req_duration{name:POST /files}': ['p(95)<3000'],
  },
};

export default function () {
  const name = `load-${__VU}-${__ITER}-${Date.now()}.pdf`;
  const started = Date.now();
  const res = http.post(
    `${BASE_URL}/files?folderId=${FOLDER_ID}`,
    { file: http.file(payload, name, 'application/pdf') },
    { headers: headers(), tags: { name: 'POST /files' } },
  );
  if (res.status >= 500) serverErrors.add(1);
  if (!check(res, { 'subida aceptada (202)': (r) => r.status === 202 })) {
    return;
  }
  const final = waitUntilDone(res.json('id'), serverErrors, 60);
  check(final, { 'el worker la deja lista': (s) => s === 'ready' });
  if (final === 'ready') timeToReady.add(Date.now() - started);
}
