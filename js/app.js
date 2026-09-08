/** POSMATE — assemble monolith from chunks and run */
const parts = await Promise.all([
  import('./chunk0.js'),
  import('./chunk1.js'),
  import('./chunk2.js'),
  import('./chunk3.js'),
  import('./chunk4.js')
]);
const src = parts.map(p => p.default).join('');
const blob = new Blob([src], { type: 'text/javascript' });
const url = URL.createObjectURL(blob);
await import(url);
