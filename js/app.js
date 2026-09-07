/**
 * POSMATE v1.0.5 — chunk loader (full app: shift + scan cart + Thai barcode)
 */
import { c1 } from './app-chunk-1.js';
import { c2 } from './app-chunk-2.js';
import { c3 } from './app-chunk-3.js';
import { c4 } from './app-chunk-4.js';
import { c5 } from './app-chunk-5.js';
import { c6 } from './app-chunk-6.js';
import { c7 } from './app-chunk-7.js';
import { c8 } from './app-chunk-8.js';
import { c9 } from './app-chunk-9.js';
const code = atob(c1+c2+c3+c4+c5+c6+c7+c8+c9);
const blob = new Blob([code], { type: 'text/javascript' });
await import(URL.createObjectURL(blob));
