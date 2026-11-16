// Local files only. No network, browser history, localStorage or IndexedDB access.
export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const push = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') push();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push(); rows.push(row); row = [];
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Invalid CSV quoting. Export the file as comma-separated UTF-8 CSV.');
      cell += c;
    }
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.');
  if (cell || closed || row.length) { push(); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}
const key = value => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
export function importDataset(input) {
  const [header, ...data] = parseCsv(input);
  if (!header || !data.length) throw new Error('The CSV needs a header row and at least one headline.');
  if (data.length > 2000) throw new Error('Import at most 2,000 rows per file.');
  const names = header.map(key);
  if (new Set(names).size !== names.length) throw new Error('CSV column names must be unique.');
  const column = aliases => names.findIndex(n => aliases.includes(n));
  const columns = {
    id: column(['headline_id', 'id', 'test_id', 'case_id']),
    text: column(['headline', 'text', 'headline_text', 'original_headline']),
    draftLabel: column(['draft_label', 'expected_label', 'expected_category', 'draft_category', 'expected']),
    humanLabel: column(['human_reference_label', 'human_reviewed_label', 'human_label', 'reference_label', 'reviewed_label']),
    reviewStatus: column(['review_status', 'human_review_status', 'reference_status']),
  };
  if (columns.text < 0) throw new Error('No headline column found. Name that column headline (or headline_text).');
  const ids = new Set();
  const rows = data.map((fields, i) => {
    if (fields.length !== header.length) throw new Error(`Row ${i + 2} has a different number of columns. Check CSV quoting.`);
    const values = Object.fromEntries(Object.entries(columns).map(([k, index]) => [k, index < 0 ? '' : fields[index]]));
    values.id = values.id.trim() || `row_${i + 1}`;
    if (ids.has(values.id)) throw new Error(`Duplicate headline ID at row ${i + 2}. Give each row a unique ID.`);
    ids.add(values.id);
    if (!values.text.trim() || values.text.length > 320) throw new Error(`Row ${i + 2}: headlines must contain 1–320 characters.`);
    return values;
  });
  const seen = new Map();
  for (const row of rows) {
    row.duplicateOf = seen.get(row.text) || '';
    if (!seen.has(row.text)) seen.set(row.text, row.id);
  }
  return { rows, uniqueCount: seen.size,
    missingReviewColumns: columns.humanLabel < 0 || columns.reviewStatus < 0 };
}
export function exportCsv(headers, records) {
  const escape = value => {
    let text = String(value ?? '');
    // Quoting alone does not prevent spreadsheet formulas, including leading controls.
    if (/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [headers, ...records.map(row => headers.map(h => row[h]))].map(row => row.map(escape).join(',')).join('\r\n');
}
