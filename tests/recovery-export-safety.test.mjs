import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Search Intelligence recovery export stays on its own KV boundary',async()=>{
  const source=await readFile(new URL('../src/entry-v1.2.js',import.meta.url),'utf8');
  assert.match(source,/\/api\/recovery-export/);
  assert.match(source,/RECOVERY_EXPORT_TOKEN/);
  assert.match(source,/x-curator-recovery-key/);
  assert.match(source,/SEARCH_INTELLIGENCE_RECORDS/);
  assert.match(source,/b469b6c1bfc04b48b00c5d887bd16594/);
  assert.doesNotMatch(source,/binding:'CURATOR_ERROR_RECORDS'/);
  assert.match(source,/list_complete/);
  assert.match(source,/dataSha256/);
});
