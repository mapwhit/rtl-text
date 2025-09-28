const UTF8Decoder = new TextDecoder();
const UTF16Decoder = new TextDecoder('utf-16le');

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

  let __emscripten_stack_restore;
  let __emscripten_stack_alloc;
  let _emscripten_stack_get_current;

  const wasmMemory = initMemory();
  const wasmImports = { c: abort, b: _emscripten_resize_heap, a: wasmMemory };
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
    Module['_bidi_processText'] = exports['e'];
    Module['_bidi_getParagraphEndIndex'] = exports['f'];
    Module['_bidi_getVisualRun'] = exports['g'];
    Module['_bidi_setLine'] = exports['h'];
    Module['_bidi_writeReverse'] = exports['i'];
    Module['_malloc'] = exports['j'];
    Module['_bidi_getLine'] = exports['k'];
    Module['_ushape_arabic'] = exports['l'];
    Module['_free'] = exports['m'];
    __emscripten_stack_restore = exports['n'];
    __emscripten_stack_alloc = exports['o'];
    _emscripten_stack_get_current = exports['p'];
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
        const ret = __emscripten_stack_alloc(arr.length);
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
          if (stack === 0) stack = _emscripten_stack_get_current();
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
      if (stack !== 0) __emscripten_stack_restore(stack);
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

  function _emscripten_resize_heap(requestedSize) {
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
    const ret = __emscripten_stack_alloc(size);
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
