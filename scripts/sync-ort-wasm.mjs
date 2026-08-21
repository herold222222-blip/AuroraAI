/**
 * Copy onnxruntime-web WASM assets into public/ort so the browser never
 * needs cdn.jsdelivr.net (often blocked in CN networks).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

export function resolveOrtDistDir() {
  const require = createRequire(import.meta.url);
  const candidates = [];

  // Direct dependency (if present) or nested under @huggingface/transformers.
  try {
    candidates.push(
      path.join(path.dirname(require.resolve('onnxruntime-web/package.json')), 'dist'),
    );
  } catch {
    /* optional */
  }

  try {
    const tf = path.dirname(require.resolve('@huggingface/transformers/package.json'));
    candidates.push(
      path.join(
        path.dirname(
          require.resolve('onnxruntime-web/package.json', { paths: [tf] }),
        ),
        'dist',
      ),
    );
  } catch {
    /* optional */
  }

  // pnpm nested layout fallback
  const pnpmRoot = path.resolve(process.cwd(), 'node_modules/.pnpm');
  if (fs.existsSync(pnpmRoot)) {
    for (const name of fs.readdirSync(pnpmRoot)) {
      if (!name.startsWith('onnxruntime-web@')) continue;
      const dist = path.join(
        pnpmRoot,
        name,
        'node_modules/onnxruntime-web/dist',
      );
      if (fs.existsSync(dist)) candidates.push(dist);
    }
  }

  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'ort-wasm-simd-threaded.asyncify.wasm'))
    ) {
      return dir;
    }
  }
  throw new Error(
    '找不到 onnxruntime-web/dist（请确认已安装 @huggingface/transformers）',
  );
}

export function syncOrtWasm(destRoot = path.resolve(process.cwd(), 'public/ort')) {
  const srcDir = resolveOrtDistDir();
  fs.mkdirSync(destRoot, { recursive: true });
  const copied = [];
  for (const name of FILES) {
    const src = path.join(srcDir, name);
    const dest = path.join(destRoot, name);
    if (!fs.existsSync(src)) {
      console.warn(`[ort-wasm] missing ${src}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    copied.push(name);
  }
  return { destRoot, copied, srcDir };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { destRoot, copied, srcDir } = syncOrtWasm();
  console.log(`[ort-wasm] from ${srcDir}`);
  console.log(`[ort-wasm] synced ${copied.length} files → ${destRoot}`);
}
