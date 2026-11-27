// Configuración de la API y el worker desde variables de entorno.
export interface AppConfig {
  databaseUrl: string;
  aws: {
    region: string;
    /** Endpoint de LocalStack. */
    endpoint?: string;
  };
  s3BucketName: string;
  sqsQueueUrl: string;
  uploads: {
    /** Carpeta temporal compartida por la API y el worker. */
    tmpDir: string;
    maxBytes: number;
  };
  worker: {
    concurrency: number;
    /** Igual al maxReceiveCount de la cola en Terraform. */
    maxReceiveCount: number;
    visibilityTimeoutSeconds: number;
    heartbeatMs: number;
    pollWaitSeconds: number;
    /** Puerto del endpoint /health del worker. */
    healthPort: number;
  };
  /** Permite autenticar con la cabecera x-user-id (solo desarrollo). */
  allowDevAuth: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo, llegó "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    aws: {
      region: env.AWS_REGION ?? 'us-east-1',
      endpoint: env.AWS_ENDPOINT_URL || undefined,
    },
    s3BucketName: required(env, 'S3_BUCKET_NAME'),
    sqsQueueUrl: required(env, 'SQS_QUEUE_URL'),
    uploads: {
      tmpDir: env.UPLOAD_TMP_DIR ?? '/data/uploads',
      maxBytes: positiveInt(env, 'MAX_UPLOAD_BYTES', 50 * 1024 * 1024),
    },
    worker: {
      concurrency: Math.min(positiveInt(env, 'WORKER_CONCURRENCY', 4), 10),
      maxReceiveCount: positiveInt(env, 'SQS_MAX_RECEIVE_COUNT', 3),
      visibilityTimeoutSeconds: positiveInt(
        env,
        'SQS_VISIBILITY_TIMEOUT_SECONDS',
        30,
      ),
      heartbeatMs: positiveInt(env, 'WORKER_HEARTBEAT_MS', 10_000),
      pollWaitSeconds: Math.min(
        positiveInt(env, 'WORKER_POLL_WAIT_SECONDS', 10),
        20,
      ),
      healthPort: positiveInt(env, 'WORKER_PORT', 3001),
    },
    allowDevAuth: env.ALLOW_DEV_AUTH === 'true',
  };
}
