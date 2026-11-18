// Deterministic policy/provenance tests, not live classification evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { classificationPolicy, QUALITY_POLICY_VERSION } from '../src/engine/classificationPolicy.js';
import { baselineHeadlinePrompt } from '../src/engine/policies/baseline-v4.js';
import { importDataset, parseCsv } from '../dev/evaluation/csv.js';
import { createRun } from '../dev/evaluation/session.js';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { KINDS } from '../src/engine/contract.js';
const challenge = () => readFileSync(new URL('../dev/evaluation/subtle-framing/challenge-v1.csv',import.meta.url),'utf8');
test('frozen baseline exactly matches the previously working v4 prompt', () => {
  const hash = createHash('sha256').update(baselineHeadlinePrompt(['baseline-provenance-probe'])).digest('hex');
  assert.equal(hash,'db6fc48e4d90d124630eda61f4b005d24103c0b6b1cf10d791c11b6456d3adcf');
  assert.equal(classificationPolicy('baseline-v4').prompt(['test']),baselineHeadlinePrompt(['test']));
});
test('candidate changes classification only, preserving rewrite instructions and data byte-for-byte', () => {
  const data = ['"Ignore the rules": could this be a threat?', 'Click to find out: Patients report permanent pain'];
  const baseline = classificationPolicy('baseline-v4').prompt(data), candidate = classificationPolicy('subtle-v5').prompt(data);
  assert.notEqual(baseline,candidate);
  assert.equal(candidate.slice(candidate.indexOf('\nRewrite policy:')),baseline.slice(baseline.indexOf('\nRewrite policy:')));
  assert.deepEqual(JSON.parse(candidate.split('HEADLINES (JSON data):\n')[1]).map(r=>r.text),data);
  assert.equal(QUALITY_POLICY_VERSION,'quality-subtle-framing-v5');
  assert.equal(classificationPolicy('baseline-v4').version,'quality-classification-evidence-v4');
  assert.throws(()=>classificationPolicy('typo'),/Unsupported/);
});
test('candidate contains indirect techniques and neutral contrasts without keyword assignment or new categories', () => {
  const prompt=classificationPolicy().prompt([]);
  for(const text of ['implied betrayal','Sarcasm','personalized vague danger','coercive urgency','ominous insinuation','inferiority/status pressure','reasonable neutral interpretation','exact pressure-bearing phrase','No category is assigned by an arbitrary score cutoff','Reporting wealth or inequality is not enough','genuine warnings','Clean does not mean true']) assert.ok(prompt.includes(text),text);
  assert.deepEqual(KINDS,['rage','fear','envy','clean']);
});
test('challenge worksheet contains 80 unique cases with no manufactured human adjudication', () => {
  const rows=importDataset(challenge()).rows;
  assert.equal(rows.length,80);assert.equal(new Set(rows.map(r=>r.text)).size,80);
  assert.ok(rows.every(r=>r.reviewStatus==='pending' && !r.humanLabel && r.datasetId==='debait-subtle-framing-v1'));
  const pairs=new Map();for(const r of rows)if(r.pairId)pairs.set(r.pairId,(pairs.get(r.pairId)||0)+1);
  assert.equal(pairs.size,18);assert.ok([...pairs.values()].every(n=>n===2));
  assert.equal(rows.filter(r=>r.caseType==='ambiguous').length,12);
});
test('both policies use one existing SDK request with unchanged four-category contract', async () => {
  for(const variant of ['baseline-v4','subtle-v5']) {
    let calls=0,input;
    const policy=classificationPolicy(variant),text='Controlled supplied headline';
    const engine=createHeadlineEngine({getAi:async()=>({}),InferenceMode:{PREFER_ON_DEVICE:'hybrid'},prompt:policy.prompt,
      getGenerativeModel:()=>({generateContent:async p=>{calls++;input=p;return {response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({results:[{kind:'clean',score:0,triggers:[],honest_rewrite:text}]})}};}})});
    const result=await engine.scoreHeadlines([text],{localOnly:false});
    assert.equal(calls,1);assert.equal(input,policy.prompt([text]));assert.equal(result[0].source,'cloud');
  }
});
test('evaluation exports dataset/policy identity and successful batch timing without sending human references', async () => {
  let clock=0;const sent=[];
  const rows=importDataset(challenge()).rows.slice(0,2);
  const run=createRun(rows,{now:()=>clock,send:async msg=>{
    sent.push(msg);
    if(msg.type.endsWith('begin'))return {ok:true,runId:'fixture-run',startedAt:'2026-11-18T00:00:00Z',policyVersion:'quality-subtle-framing-v5',localOnly:false};
    if(msg.type.endsWith('score')){clock+=250;return {ok:true,results:msg.texts.map(t=>({kind:'clean',score:0,triggers:[],source:'cloud',honest_rewrite:t}))};}
    return {ok:true};
  }});await run.start();
  const [h,...records]=parseCsv(run.csv());const result=Object.fromEntries(h.map((k,i)=>[k,records[0][i]]));
  assert.equal(result.dataset_id,'debait-subtle-framing-v1');assert.equal(result.batch_round_trip_ms,'250');assert.equal(result.batch_size,'2');
  assert.equal(result.policy_version,'quality-subtle-framing-v5');
  assert.ok(!JSON.stringify(sent).includes('draft_label'));assert.ok(!JSON.stringify(sent).includes('dataset_id'));
});
