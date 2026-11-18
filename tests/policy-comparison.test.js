// Controlled arithmetic fixtures ONLY. These supplied labels are NOT real Gemini results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCsv } from '../dev/evaluation/csv.js';
import { comparePolicies } from '../dev/evaluation/subtle-framing/compare.js';
const items=[['R','Loaded rage framing','Rage','subtle'],['F','A danger headline','Fear','subtle'],['C','A health report','Clean','legitimate_reporting']];
const worksheet=(status='agreed')=>exportCsv(['dataset_id','headline_id','headline','draft_label','human_reference_label','review_status','case_type'],items.map(([id,text,label,type])=>({dataset_id:'fixture',headline_id:id,headline:text,draft_label:label,human_reference_label:status==='pending'?'':label,review_status:status,case_type:type})));
function run(policy,predictions,patch={}) {
 const records=items.map(([id,text],i)=>({dataset_id:'fixture',headline_id:id,headline:text,policy_version:policy==='baseline'?'quality-classification-evidence-v4':'quality-subtle-framing-v5',
   run_id:policy,run_timestamp:'fixture',git_sha:'fixture',git_dirty:'false',configured_cloud_model:'fixture-model',sdk_version:'fixture-sdk',resolved_model_version:'unknown',local_only:'false',
   model_classification:predictions[i],score:'50',trigger_evidence_json:JSON.stringify(predictions[i]==='clean'?[]:[text]),explanations_json:JSON.stringify(predictions[i]==='clean'?[]:['Supplied fixture explanation, not a quality claim']),
   inference_source:'cloud',status:'success',evaluation_origin:'fresh',error_code:'',batch_id:'fixture-batch',batch_round_trip_ms:'250',...patch}));
 return exportCsv(Object.keys(records[0]),records);
}
const baseline=()=>run('baseline',['rage','clean','clean']);
const candidate=()=>run('candidate',['rage','fear','fear']);
test('paired comparison computes recall, flagged precision, legitimate false positives and confusion matrix',()=>{
 const r=comparePolicies(worksheet(),[baseline()],[candidate()]).comparisons[0];
 assert.equal(r.baseline.metrics.recall.fear,0);assert.equal(r.candidate.metrics.recall.fear,1);
 assert.equal(r.candidate.metrics.flagged_precision,2/3);assert.equal(r.candidate.metrics.false_positive_rate_legitimate_reporting,1);
 assert.equal(r.candidate.metrics.confusion_matrix.clean.fear,1);assert.equal(r.source_matched.cloud.paired_cases,3);
 assert.equal(r.baseline.timing.mean_batch_round_trip_ms,250);
});
test('unreviewed drafts produce exploratory differences, never accuracy metrics',()=>{
 const r=comparePolicies(worksheet('pending'),[baseline()],[candidate()]);
 assert.equal(r.comparisons[0].candidate.metrics.cases,0);assert.equal(r.comparisons[0].candidate.metrics.recall.fear,null);
 assert.ok(r.comparisons[0].limitations.some(s=>s.includes('No paired reviewed')));
 assert.equal(r.cases.filter(r=>r.changed).length,2);
 assert.equal(r.comparisons[0].exploratory.changed_predictions,2);
 assert.equal(r.comparisons[0].exploratory.candidate_prediction_counts.fear,2);
});
test('invalid evidence never counts as Clean or a successful metric prediction',()=>{
 const bad=run('candidate',['rage','fear','fear'],{trigger_evidence_json:'["not in headline"]'});
 const r=comparePolicies(worksheet(),[baseline()],[bad]);
 assert.equal(r.comparisons[0].candidate.coverage.invalid_exported_evidence,3);
 assert.equal(r.comparisons[0].candidate.metrics.cases,0);
});
test('failure rates and coverage remain separate from paired classification metrics',()=>{
 const r=comparePolicies(worksheet(),[baseline()],[run('candidate',['rage','fear','clean'],{status:'failed',error_code:'debait/invalid-classification'})]).comparisons[0];
 assert.equal(r.candidate.coverage.observed_row_failure_rate,1);assert.equal(r.candidate.coverage.invalid_classification_errors,3);assert.equal(r.candidate.metrics.cases,0);
});
test('source/config changes are disclosed and source-mismatched cases are excluded from strata',()=>{
 const r=comparePolicies(worksheet(),[baseline()],[run('candidate',['rage','fear','clean'],{inference_source:'on-device',sdk_version:'different-sdk'})]).comparisons[0];
 assert.equal(r.config_comparable,false);assert.equal(r.source_matched.cloud.paired_cases,0);assert.equal(r.source_matched['on-device'].paired_cases,0);
 assert.ok(r.limitations.some(s=>s.includes('different inference sources')));
});
test('repeated predictions report consistency by source, independently of accuracy',()=>{
 const r=comparePolicies(worksheet('pending'),[baseline(),baseline()],[candidate(),run('candidate',['rage','clean','fear'])]);
 assert.equal(r.consistency.baseline.cloud.consistency_rate,1);assert.equal(r.consistency.candidate.cloud.consistency_rate,2/3);
});
test('comparison rejects wrong policy, mismatched dataset, mock sources and unsupported labels',()=>{
 assert.throws(()=>comparePolicies(worksheet(),[candidate()],[baseline()]),/Expected policy/);
 assert.throws(()=>comparePolicies(worksheet(),[baseline()],[run('candidate',['rage','fear','clean'],{dataset_id:'wrong'})]),/Dataset identity/);
 for(const patch of [{inference_source:'mock'},{model_classification:'curiosity_gap'}]) {
  const r=comparePolicies(worksheet(),[baseline()],[run('candidate',['rage','fear','clean'],patch)]);
  assert.equal(r.comparisons[0].candidate.metrics.cases,0);
 }
});
test('missing exports, unsupported human references and nonfresh results never invent agreement',()=>{
 assert.throws(()=>comparePolicies(worksheet(),[],[]),/equal, nonzero/);
 assert.throws(()=>comparePolicies(worksheet(),[baseline()],[run('candidate',['rage','fear','clean'],{evaluation_origin:'cached'})]),/fresh/);
 const r=comparePolicies(worksheet().replaceAll('"Fear"','"Uncertain"'),[baseline()],[candidate()]);
 assert.ok(r.cases.some(c=>c.exclusion_reason==='unsupported_reference'));
});

test('exact duplicate headlines with conflicting references cannot enter metrics',()=>{
 const refs=exportCsv(['dataset_id','headline_id','headline','human_reference_label','review_status'],[
  {dataset_id:'fixture',headline_id:'1',headline:'Same headline',human_reference_label:'Clean',review_status:'agreed'},
  {dataset_id:'fixture',headline_id:'2',headline:'Same headline',human_reference_label:'Fear',review_status:'agreed'},
 ]);
 const records=policy=>exportCsv(['dataset_id','headline_id','headline','policy_version','status','evaluation_origin','model_classification','score','inference_source','trigger_evidence_json','explanations_json'],['1','2'].map(id=>({dataset_id:'fixture',headline_id:id,headline:'Same headline',policy_version:policy,status:'success',evaluation_origin:id==='1'?'fresh':'same_run_duplicate',model_classification:'clean',score:0,inference_source:'cloud',trigger_evidence_json:'[]',explanations_json:'[]'})));
 const r=comparePolicies(refs,[records('quality-classification-evidence-v4')],[records('quality-subtle-framing-v5')]);
 assert.equal(r.comparisons[0].candidate.metrics.cases,0);assert.ok(r.cases.every(c=>c.exclusion_reason==='conflicting_references'));
});
