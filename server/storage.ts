/**
 * Storage mode helpers.
 * - If FORCE_USE_REMOTE_STORAGE=true, modules should fail early when remote
 *   storage (Postgres or Netlify blobs/OSS) is not configured, to avoid
 *   silently falling back to local files.
 */

export function isForceRemote(): boolean {
  return String(process.env.FORCE_USE_REMOTE_STORAGE || '').toLowerCase() === 'true';
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function hasBlobs(): boolean {
  return Boolean(process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS);
}

export function ensureDatabaseAvailable(): void {
  if (isForceRemote() && !hasDatabase()) {
    throw new Error('FORCE_USE_REMOTE_STORAGE=true but DATABASE_URL not configured');
  }
}

export function ensureBlobsAvailable(): void {
  if (isForceRemote() && !hasBlobs()) {
    throw new Error('FORCE_USE_REMOTE_STORAGE=true but NETLIFY blobs not enabled');
  }
}

export default { isForceRemote, hasDatabase, hasBlobs, ensureDatabaseAvailable, ensureBlobsAvailable };
