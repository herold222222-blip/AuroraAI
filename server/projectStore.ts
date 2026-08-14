import { getPool } from './db';
import oss from './ossStore';

export async function saveProjectArchive(
  ownerId: string,
  projectId: string,
  archiveBuffer: Buffer,
  manifest: Record<string, unknown> | null,
) {
  // upload archive to OSS
  const key = `projects/${projectId}/snapshot.zip`;
  await oss.uploadBuffer(archiveBuffer, key);
  // write metadata to Postgres if available
  if (process.env.DATABASE_URL) {
    const pool = getPool();
    const now = Date.now();
    await pool.query(
      `INSERT INTO projects (id, owner_id, name, storage_path, manifest, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET storage_path=EXCLUDED.storage_path, manifest=EXCLUDED.manifest, version=projects.version+1, updated_at=EXCLUDED.updated_at`,
      [projectId, ownerId, manifest?.name || null, key, JSON.stringify(manifest || {}), 1, now, now],
    );
  }
  return { key };
}

export async function getProjectManifest(projectId: string) {
  if (!process.env.DATABASE_URL) return null;
  const pool = getPool();
  const res = await pool.query('SELECT manifest, storage_path, version, owner_id FROM projects WHERE id=$1', [projectId]);
  if (!res.rows || res.rows.length === 0) return null;
  return res.rows[0];
}

export async function listProjectsByOwner(ownerId: string) {
  if (!process.env.DATABASE_URL) return [];
  const pool = getPool();
  const res = await pool.query('SELECT id, name, storage_path, manifest, version, created_at, updated_at FROM projects WHERE owner_id=$1 ORDER BY updated_at DESC', [ownerId]);
  return res.rows || [];
}

export default { saveProjectArchive, getProjectManifest, listProjectsByOwner };
