import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync('dist/manifest.json','utf8'));
assert.equal(readFileSync('dist/voice-worklets.js','utf8'),readFileSync('public/voice-worklets.js','utf8'),'Packaged worklets must be copied without remote/blob dependencies');
assert.deepEqual(manifest.permissions,['storage','offscreen','sidePanel','scripting','alarms'],'No additional voice permissions');
assert.ok(!JSON.stringify(manifest.content_security_policy || {}).includes('blob:'),'Do not loosen CSP for audio');
console.log('Voice worklet packaging, permissions and CSP checks passed.');
