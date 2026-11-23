// Run after either extension build. No credentials or network access needed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const files = dir => readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const javascript=files('dist').filter(p=>p.endsWith('.js')).map(p=>readFileSync(p,'utf8')).join('\n');
assert.equal(existsSync('dist/src/voice/index.html'),false,'No release voice entry');
assert.ok(!javascript.includes('ws/google.firebase.vertexai'),'No bundled Live connection transport');
assert.ok(!javascript.includes('axi-chat-2026'),'No secondary project');
assert.ok(!javascript.includes('Talk to Debait'),'No voice enable control');
assert.ok(javascript.includes('Voice is unavailable in this release candidate.'),'Worker must fail closed');
assert.ok(!readFileSync('dist/src/popup/index.html','utf8').includes('data-setting="voice"'));
console.log('Release packaging passed: voice transport/page/controls excluded; no secondary project.');
