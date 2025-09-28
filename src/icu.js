const UTF8Decoder = new TextDecoder();
const UTF16Decoder = new TextDecoder('utf-16le');

// generate by passing: `--emit-minification-map  $@.map`
const IMPORT_MAP = {
  memory: 'a',
  emscripten_resize_heap: 'b',
  _abort_js: 'c',
  __wasm_call_ctors: 'd'
};

const EXPORT_MAP = {
  bidi_processText: 'e',
  bidi_getParagraphEndIndex: 'f',
  bidi_getVisualRun: 'g',
  bidi_setLine: 'h',
  bidi_writeReverse: 'i',
  malloc: 'j',
  bidi_getLine: 'k',
  ushape_arabic: 'l',
  free: 'm'
};

const INTERNAL_MAP = {
  _emscripten_stack_restore: 'n',
  _emscripten_stack_alloc: 'o',
  emscripten_stack_get_current: 'p'
};

export default async function Module(moduleArg = {}, { instantiateAsync }) {
  const Module = moduleArg;

  let ABORT = false;
  let readyPromiseResolve;
  let readyPromiseReject;
  let HEAP8;
  let HEAPU8;
  let HEAP16;
  let HEAPU16;
  let runtimeInitialized = false;

  Module['ccall'] = ccall;
  Module['UTF16ToString'] = UTF16ToString;
  Module['stringToUTF16'] = stringToUTF16;

  let stackRestore;
  let stackAlloc;
  let stackGetCurrent;

  const wasmMemory = initMemory();
  const wasmImports = {
    [IMPORT_MAP['_abort_js']]: abort,
    [IMPORT_MAP['emscripten_resize_heap']]: resizeHeap,
    [IMPORT_MAP['memory']]: wasmMemory
  };
  const wasmExports = await createWasm();

  run();

  if (runtimeInitialized) {
    return Module;
  }
  return new Promise((resolve, reject) => {
    readyPromiseResolve = resolve;
    readyPromiseReject = reject;
  });

  function assignWasmExports(exports) {
    for (const [name, min] of Object.entries(EXPORT_MAP)) {
      Module[`_${name}`] = exports[min];
    }
    stackRestore = exports[INTERNAL_MAP['_emscripten_stack_restore']];
    stackAlloc = exports[INTERNAL_MAP['_emscripten_stack_alloc']];
    stackGetCurrent = exports[INTERNAL_MAP['emscripten_stack_get_current']];
  }

  function abort(what = '') {
    ABORT = true;
    const e = new WebAssembly.RuntimeError(`Aborted(${what})`);
    readyPromiseReject?.(e);
    throw e;
  }

  async function createWasm() {
    const { instance } = await instantiateAsync({ a: wasmImports });
    const { exports } = instance;
    assignWasmExports(exports);
    return exports;
  }

  function initMemory() {
    const INITIAL_MEMORY = Module['INITIAL_MEMORY'] ?? 16777216;
    const wasmMemory = new WebAssembly.Memory({ initial: INITIAL_MEMORY / 65536, maximum: 32768 });
    updateMemoryViews(wasmMemory);
    return wasmMemory;
  }

  function initRuntime() {
    runtimeInitialized = true;
    wasmExports['d']();
  }

  function updateMemoryViews(wasmMemory) {
    const b = wasmMemory.buffer;
    HEAP8 = new Int8Array(b);
    HEAP16 = new Int16Array(b);
    HEAPU8 = new Uint8Array(b);
    HEAPU16 = new Uint16Array(b);
    Module['HEAPU8'] = HEAPU8;
  }

  function run() {
    if (ABORT) return;
    initRuntime();
    readyPromiseResolve?.(Module);
  }

  function ccall(ident, returnType, argTypes, args) {
    const toC = {
      string: str => {
        let ret = 0;
        if (str !== null && str !== undefined && str !== 0) {
          ret = stringToUTF8OnStack(str);
        }
        return ret;
      },
      array: arr => {
        const ret = stackAlloc(arr.length);
        HEAP8.set(arr, ret);

        return ret;
      }
    };

    const cArgs = [];

    let stack = 0;
    if (args) {
      for (let i = 0; i < args.length; i++) {
        const converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) stack = stackGetCurrent();
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }

    const func = Module[`_${ident}`];
    const ret = func(...cArgs);
    return onDone(ret);

    function onDone(ret) {
      if (stack !== 0) stackRestore(stack);
      return convertReturnValue(ret);
    }

    function convertReturnValue(ret) {
      if (returnType === 'string') {
        return UTF8ToString(ret);
      }
      if (returnType === 'boolean') return Boolean(ret);
      return ret;
    }
  }

  function resizeHeap(requestedSize) {
    const oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    const maxHeapSize = 2147483648;
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
      let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      const newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      if (growMemory(wasmMemory, newSize)) {
        updateMemoryViews(wasmMemory);
        return true;
      }
    }
    return false;
  }

  function stringToUTF8OnStack(str) {
    const size = lengthBytesUTF8(str) + 1;
    const ret = stackAlloc(size);
    stringToUTF8Array(str, HEAPU8, ret, size);
    return ret;
  }

  function UTF8ToString(ptr, maxBytesToRead, ignoreNul) {
    if (!ptr) return '';
    const end = findStringEnd(HEAPU8, ptr, maxBytesToRead, ignoreNul);
    return UTF8Decoder.decode(HEAPU8.subarray(ptr, end));
  }

  function UTF16ToString(ptr, maxBytesToRead, ignoreNul) {
    const idx = ptr >> 1;
    const endIdx = findStringEnd(HEAPU16, idx, maxBytesToRead / 2, ignoreNul);
    return UTF16Decoder.decode(HEAPU16.subarray(idx, endIdx));
  }

  function stringToUTF16(str, outPtr, maxBytesToWrite = 2147483647) {
    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    const startPtr = outPtr;
    const numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
    for (let i = 0; i < numCharsToWrite; ++i) {
      const codeUnit = str.charCodeAt(i);
      HEAP16[outPtr >> 1] = codeUnit;
      outPtr += 2;
    }
    HEAP16[outPtr >> 1] = 0;
    return outPtr - startPtr;
  }
}

function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) return 0;
  const startIdx = outIdx;
  const endIdx = outIdx + maxBytesToWrite - 1;
  for (let i = 0; i < str.length; ++i) {
    const u = str.codePointAt(i);
    if (u <= 127) {
      if (outIdx >= endIdx) break;
      heap[outIdx++] = u;
    } else if (u <= 2047) {
      if (outIdx + 1 >= endIdx) break;
      heap[outIdx++] = 192 | (u >> 6);
      heap[outIdx++] = 128 | (u & 63);
    } else if (u <= 65535) {
      if (outIdx + 2 >= endIdx) break;
      heap[outIdx++] = 224 | (u >> 12);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      heap[outIdx++] = 240 | (u >> 18);
      heap[outIdx++] = 128 | ((u >> 12) & 63);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
      i++;
    }
  }
  heap[outIdx] = 0;
  return outIdx - startIdx;
}

function lengthBytesUTF8(str) {
  let len = 0;
  for (let i = 0; i < str.length; ++i) {
    const c = str.charCodeAt(i);
    if (c <= 127) {
      len++;
    } else if (c <= 2047) {
      len += 2;
    } else if (c >= 55296 && c <= 57343) {
      len += 4;
      ++i;
    } else {
      len += 3;
    }
  }
  return len;
}

function findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul) {
  const maxIdx = idx + maxBytesToRead;
  if (ignoreNul) return maxIdx;
  while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
  return idx;
}

function alignMemory(size, alignment) {
  return Math.ceil(size / alignment) * alignment;
}

function growMemory(wasmMemory, size) {
  const oldHeapSize = wasmMemory.buffer.byteLength;
  const pages = ((size - oldHeapSize + 65535) / 65536) | 0;
  try {
    wasmMemory.grow(pages);
    return true;
  } catch {}
}
