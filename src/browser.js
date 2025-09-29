function locateFile(file) {
  return new URL(urlFromDataset(file) ?? file, document.baseURI);
}

function urlFromDataset(file) {
  const el = document.getElementById('rtl-text');
  return el?.getAttribute(`data-${file.replace('.', '-')}`);
}

export default async function instantiateAsync(imports) {
  const url = locateFile('icu.wasm');
  const response = fetch(url, { mode: 'cors', credentials: 'omit' });
  return await WebAssembly.instantiateStreaming(response, imports);
}
