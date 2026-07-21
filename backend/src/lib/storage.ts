import catalyst from 'zcatalyst-sdk-node';
import type { Readable } from 'node:stream';
import { env } from '../config/env.ts';

/**
 * Catalyst Stratus (object storage) — the project-wide file helper.
 *
 * This is the storage analogue of `lib/mailer.ts`: a single place that wraps a
 * Zoho service so callers never touch the SDK directly. Import `uploadFile`
 * from a service layer wherever a file needs to be stored; do not re-initialize
 * the SDK anywhere else.
 *
 * The SDK is normally initialized from an inbound Catalyst request. We run on
 * AppSail and also need this from places that have no `req` (services, seed
 * scripts, cron), so we initialize a standalone app from OAuth credentials
 * (`initializeApp` + a refresh-token credential). One credential set, identical
 * behaviour locally and in production, no `req` threaded through every service.
 *
 * Credentials live in env (`CATALYST_*`) and are optional — a deployment that
 * never uploads still boots. Every entry point calls `getBucket`, which throws
 * a clear error if storage was never configured, rather than letting a cryptic
 * SDK failure surface at the call site.
 */

// A Stratus bucket handle, inferred from the SDK so we never hard-code its shape.
type StratusBucket = ReturnType<ReturnType<typeof getStratus>['bucket']>;

// Lazily built once and reused. `initializeApp` is cheap but the credential
// holds a refreshable token, so a module-level singleton avoids re-auth churn.
const cachedBucketByName = new Map<string, StratusBucket>();

function getStratus() {
  if (!env.catalyst.configured) {
    // Fail closed and loud: a silent no-op upload is worse than a 500.
    throw new Error(
      'Catalyst Stratus is not configured. Set CATALYST_PROJECT_ID, ' +
        'CATALYST_PROJECT_KEY, CATALYST_CLIENT_ID, CATALYST_CLIENT_SECRET, ' +
        'CATALYST_REFRESH_TOKEN and CATALYST_STRATUS_BUCKET.',
    );
  }

  const credential = catalyst.credential.refreshToken({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    refresh_token: env.catalyst.refreshToken!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    client_id: env.catalyst.clientId!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    client_secret: env.catalyst.clientSecret!,
  });

  const app = catalyst.initializeApp({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    project_id: env.catalyst.projectId!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    project_key: env.catalyst.projectKey!,
    environment: env.catalyst.environment,
    credential,
  });

  return app.stratus();
}

/** Resolve a bucket instance, defaulting to the configured bucket. */
function getBucket(bucketName?: string) {
  const name = bucketName ?? env.catalyst.stratusBucket!;
  const cached = cachedBucketByName.get(name);
  if (cached) return cached;
  const bucket = getStratus().bucket(name);
  cachedBucketByName.set(name, bucket);
  return bucket;
}

export interface UploadFileParams {
  /** Object key — the full path within the bucket, e.g. `vendors/<id>/logo.png`. */
  key: string;
  /** File contents. A Buffer for in-memory data, a Readable for large streams. */
  body: Buffer | Readable | string;
  /** MIME type stored with the object; set it so downloads serve correctly. */
  contentType?: string;
  /** Replace an existing object at this key. Defaults to false (Stratus errors on clash). */
  overwrite?: boolean;
  /** Seconds after which Stratus auto-expires the object. Omit for permanent. */
  ttlSeconds?: number;
  /** Arbitrary string metadata to attach to the object. */
  metadata?: Record<string, string>;
  /** Override the default bucket for this one call. */
  bucket?: string;
}

export interface UploadedFile {
  /** The stored object key — persist THIS in Postgres, never a signed URL (they expire). */
  key: string;
  /** The bucket the object landed in. */
  bucket: string;
}

/**
 * Upload a file to Stratus. Returns the key and bucket to store on the owning
 * row; generate a fresh signed URL with `getFileUrl` each time you serve it.
 */
export async function uploadFile(params: UploadFileParams): Promise<UploadedFile> {
  const bucketName = params.bucket ?? env.catalyst.stratusBucket!;
  const bucket = getBucket(bucketName);

  // Build options without `extractUpload` so the SDK picks the boolean-returning
  // overload (the zip-extraction overload returns `{ task_id }` instead).
  await bucket.putObject(params.key, params.body, {
    overwrite: params.overwrite ?? false,
    ...(params.ttlSeconds !== undefined ? { ttl: String(params.ttlSeconds) } : {}),
    ...(params.metadata ? { metaData: params.metadata } : {}),
    ...(params.contentType ? { contentType: params.contentType } : {}),
  });

  return { key: params.key, bucket: bucketName };
}

/**
 * Generate a short-lived signed URL to download/serve an object. Hand this to
 * the client instead of proxying bytes through the API. Regenerate per request;
 * never store it.
 */
export async function getFileUrl(
  key: string,
  opts: { expiresInSeconds?: number; versionId?: string; bucket?: string } = {},
): Promise<string> {
  const bucket = getBucket(opts.bucket);
  const res = await bucket.generatePreSignedUrl(key, 'GET', {
    expiryIn: String(opts.expiresInSeconds ?? 3600),
    ...(opts.versionId ? { versionId: opts.versionId } : {}),
  });
  if (!res.signature) throw new Error(`Failed to sign download URL for "${key}".`);
  return res.signature;
}

/**
 * Generate a signed URL the client can PUT to directly, so large uploads skip
 * the API entirely. Store the key you signed; the client uploads to that key.
 */
export async function createUploadUrl(
  key: string,
  opts: { expiresInSeconds?: number; bucket?: string } = {},
): Promise<string> {
  const bucket = getBucket(opts.bucket);
  const res = await bucket.generatePreSignedUrl(key, 'PUT', {
    expiryIn: String(opts.expiresInSeconds ?? 3600),
  });
  if (!res.signature) throw new Error(`Failed to sign upload URL for "${key}".`);
  return res.signature;
}

/** Download an object as a readable stream (e.g. to pipe into a response). */
export async function downloadFile(
  key: string,
  opts: { range?: string; versionId?: string; bucket?: string } = {},
): Promise<Readable> {
  const bucket = getBucket(opts.bucket);
  return bucket.getObject(key, {
    ...(opts.range ? { range: opts.range } : {}),
    ...(opts.versionId ? { versionId: opts.versionId } : {}),
  });
}

/**
 * Delete an object. Note: this is a HARD delete of the stored bytes — it is
 * unrelated to the app's soft-delete (`isDeleted`) on the owning DB row. Delete
 * the object only when the referencing row is truly gone.
 */
export async function deleteFile(
  key: string,
  opts: { versionId?: string; bucket?: string } = {},
): Promise<void> {
  const bucket = getBucket(opts.bucket);
  await bucket.deleteObject(key, opts.versionId ? { versionId: opts.versionId } : {});
}
