export function resolveOrtDistDir(): string;

export function syncOrtWasm(destRoot?: string): {
  destRoot: string;
  copied: string[];
  srcDir: string;
};
