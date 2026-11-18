// Offline only: never calls Gemini, Chrome APIs, Firebase or credential stores.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { comparePolicies } from '../dev/evaluation/subtle-framing/compare.js';
import { exportCsv } from '../dev/evaluation/csv.js';
const args = process.argv.slice(2), inputs = { baseline: [], candidate: [] };
try {
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, ''), value = args[i+1];
    if (!['worksheet','baseline','candidate','out'].includes(key) || !value) throw new Error('Usage: --worksheet reviewed.csv --baseline baseline.csv --candidate candidate.csv --out review-folder (repeat each run flag for repeated evaluations).');
    if (['baseline','candidate'].includes(key)) inputs[key].push(value); else inputs[key] = value;
  }
  if (!inputs.worksheet || !inputs.out) throw new Error('A worksheet and output folder are required.');
  const worksheet = readFileSync(inputs.worksheet, 'utf8');
  const report = comparePolicies(worksheet, inputs.baseline.map(f => readFileSync(f,'utf8')), inputs.candidate.map(f => readFileSync(f,'utf8')));
  report.worksheet_sha256 = createHash('sha256').update(worksheet).digest('hex');
  report.created_at = new Date().toISOString();
  const out = resolve(inputs.out); mkdirSync(out, {recursive:true});
  writeFileSync(resolve(out,'comparison.json'), JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(out,'paired-cases.csv'), exportCsv(Object.keys(report.cases[0]),report.cases));
  console.log(`Wrote comparison.json and paired-cases.csv. ${report.dataset_cases} worksheet cases; no live inference performed.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
