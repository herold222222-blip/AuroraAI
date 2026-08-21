/**
 * Browser-side transformers.js often cannot reach huggingface.co / hf-mirror
 * (ERR_CONNECTION_CLOSED). Proxy model files through our API so the client
 * only talks same-origin.
 *
 * Important: `applyHttpProxy()` may set undici's global dispatcher to Clash.
 * That often breaks HF TLS. We therefore fetch with an explicit non-proxy
 * Agent first, then fall back to EnvHttpProxyAgent.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const UPSTREAMS = [
  'https://hf-mirror.com',
  'https://huggingface.co',
] as const;

/** Only the two Xenova models used by src/ai/pipeline.ts */
const ALLOWED_MODELS = new Set([
  'Xenova/segformer-b0-finetuned-ade-512-512',
  'Xenova/depth-anything-small-hf',
]);

const CACHE_DIR = path.resolve(process.cwd(), '.data/hf-cache');

/** Upstream responded 404 — file is optional / missing; do not burn other hosts. */
export class HfNotFoundError extends Error {
  readonly status = 404;
  constructor(relPath: string) {
    super(`HF 文件不存在: ${relPath}`);
    this.name = 'HfNotFoundError';
  }
}

type FetchFn = (
  input: string,
  init?: Record<string, unknown>,
) => Promise<Response>;

function guessContentType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.onnx')) return 'application/octet-stream';
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function errMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${e.message}: ${cause.message}`;
  return e.message;
}

function isOnnx(relPath: string) {
  return relPath.endsWith('.onnx');
}

function buildFetchers(relPath: string): { name: string; fetch: FetchFn }[] {
  const require = createRequire(import.meta.url);
  const undici = require('undici') as {
    fetch: FetchFn;
    Agent: new (opts?: Record<string, unknown>) => unknown;
    EnvHttpProxyAgent: new (opts?: Record<string, unknown>) => unknown;
  };

  // Large ONNX needs more time; tiny JSON should fail fast (e.g. missing tokenizer).
  const connectTimeout = isOnnx(relPath) ? 60_000 : 12_000;
  const connect = { timeout: connectTimeout };
  const direct = new undici.Agent({ connect });
  const modes: { name: string; fetch: FetchFn }[] = [
    {
      name: 'direct',
      fetch: (input, init) =>
        undici.fetch(input, { ...init, dispatcher: direct }),
    },
  ];

  try {
    const viaProxy = new undici.EnvHttpProxyAgent({ connect });
    modes.push({
      name: 'proxy',
      fetch: (input, init) =>
        undici.fetch(input, { ...init, dispatcher: viaProxy }),
    });
  } catch {
    /* undici proxy optional */
  }

  return modes;
}

function cachePathFor(relPath: string): string {
  return path.join(CACHE_DIR, relPath.replace(/\//g, '__'));
}

function readCache(relPath: string): {
  buffer: Buffer;
  contentType: string;
} | null {
  try {
    const file = cachePathFor(relPath);
    if (!fs.existsSync(file)) return null;
    const buffer = fs.readFileSync(file);
    if (!buffer.length) return null;
    return { buffer, contentType: guessContentType(relPath) };
  } catch {
    return null;
  }
}

function writeCache(relPath: string, buffer: Buffer) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePathFor(relPath), buffer);
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Normalize `/api/hf/...` path segments into a Hub-relative path and validate.
 * Expected shape: `{org}/{name}/resolve/{revision}/{file...}`
 */
export function parseHfProxyPath(segments: string[]): string | null {
  const parts = segments.map((s) => decodeURIComponent(s)).filter(Boolean);
  if (parts.length < 5) return null;
  if (parts.some((p) => p === '..' || p.includes('\\'))) return null;

  const modelId = `${parts[0]}/${parts[1]}`;
  if (!ALLOWED_MODELS.has(modelId)) return null;
  if (parts[2] !== 'resolve') return null;

  const revision = parts[3];
  if (!/^[A-Za-z0-9._/-]+$/.test(revision)) return null;

  const filePath = parts.slice(4).join('/');
  if (!filePath || filePath.includes('..')) return null;

  return `${modelId}/resolve/${revision}/${filePath}`;
}

export async function fetchHfUpstream(relPath: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const cached = readCache(relPath);
  if (cached) return cached;

  const modes = buildFetchers(relPath);
  const errors: string[] = [];

  for (const host of UPSTREAMS) {
    const url = `${host}/${relPath}`;
    for (const mode of modes) {
      try {
        const res = await mode.fetch(url, {
          redirect: 'follow',
          headers: {
            Accept: '*/*',
            'User-Agent': 'AuroraAI-hf-proxy/1.0',
          },
        });
        if (res.status === 404) {
          // Hub confirmed missing — transformers treats many files as optional.
          throw new HfNotFoundError(relPath);
        }
        if (!res.ok) {
          errors.push(`${host} (${mode.name}) → HTTP ${res.status}`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType =
          res.headers.get('content-type') || guessContentType(relPath);
        writeCache(relPath, buffer);
        return { buffer, contentType };
      } catch (e) {
        if (e instanceof HfNotFoundError) throw e;
        errors.push(`${host} (${mode.name}): ${errMessage(e)}`);
      }
    }
  }

  throw new Error(
    errors.slice(0, 4).join(' | ') || 'Hugging Face 模型拉取失败',
  );
}
