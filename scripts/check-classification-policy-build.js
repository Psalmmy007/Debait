// Inspect/execute the built pure contract/policy module, never Firebase or browser APIs.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classificationPolicy } from '../src/engine/classificationPolicy.js';
const variant=process.argv[2];
assert.ok(['baseline-v4','subtle-v5'].includes(variant),'Specify baseline-v4 or subtle-v5');
const expected=classificationPolicy(variant), probe=['build-policy-provenance-probe'];
const contracts=readdirSync('dist/assets').filter(f=>/^contract-.*\.js$/.test(f));
assert.equal(contracts.length,1,'Expected one built pure contract module');
const exports=Object.values(await import(pathToFileURL(resolve('dist/assets',contracts[0])).href));
assert.ok(exports.includes(expected.version),'Built cache/evaluation policy version does not match selection');
const prompts=exports.filter(v=>typeof v==='function').map(fn=>{try{return fn(probe);}catch{return null;}})
  .filter(v=>typeof v==='string' && v.includes('HEADLINES (JSON data):'));
assert.deepEqual(prompts,[expected.prompt(probe)],'Built inference prompt does not match selected policy');
console.log(`Classification policy build selection passed (${variant}): compiled version and exact prompt.`);
