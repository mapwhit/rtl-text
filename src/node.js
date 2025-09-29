import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filename = resolve(import.meta.dirname, './icu.wasm');

export default async function instantiate(imports) {
  const buffer = await readFile(filename);
  return await WebAssembly.instantiate(buffer, imports);
}
