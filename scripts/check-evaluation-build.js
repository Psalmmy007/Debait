// Run after a build: node scripts/check-evaluation-build.js development|production|demo
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const development = process.argv[2] === 'development';
assert.ok(['development', 'production', 'demo'].includes(process.argv[2]), 'Specify the build mode.');
assert.equal(existsSync('dist/dev/evaluation/index.html'), development, 'Evaluation page build boundary');
assert.equal(existsSync('dist/dev/evaluation/sample.csv'), development, 'Sample dataset build boundary');
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const javascript = files('dist').filter(path => path.endsWith('.js')).map(path => readFileSync(path, 'utf8')).join('\n');
assert.equal(javascript.includes('Reference agreement:'), development, 'Evaluation interface must not ship outside development');
if (!development) assert.ok(!javascript.includes('dev/evaluation/index.html'), 'Evaluation service must not ship outside development');
console.log(`Evaluation build isolation passed (${process.argv[2]}).`);
