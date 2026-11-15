// Writes dist/build.json so an unpacked Debait reloads itself after each build.
import { writeFileSync } from 'node:fs';
writeFileSync('dist/build.json', JSON.stringify({ built: new Date().toISOString() }));
console.log('stamped dist/build.json');
