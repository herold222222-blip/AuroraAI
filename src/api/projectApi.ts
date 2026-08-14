export async function apiSaveProject(projectId: string, manifest: any, archiveBase64: string, token?: string) {
  const res = await fetch('/api/projects/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify({ projectId, manifest, archiveBase64 }),
  });
  return res.json();
}

export async function apiGetProject(projectId: string) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  return res.json();
}

export async function apiListMyProjects(token?: string) {
  const res = await fetch('/api/projects', { headers: { ...(token ? { Authorization: token } : {}) } });
  return res.json();
}
