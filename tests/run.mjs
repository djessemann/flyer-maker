// Runs every suite in sequence and exits non-zero if any of them fail.
// Run: npm test
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['inpaint.test.mjs', 'offline.test.mjs', 'mobile.test.mjs'];
const results = [];

for (const s of suites) {
  console.log(`\n${'='.repeat(64)}\n  ${s}\n${'='.repeat(64)}`);
  const r = spawnSync(process.execPath, [join(here, s)], { stdio: 'inherit' });
  results.push({ s, code: r.status ?? 1 });
}

console.log(`\n${'='.repeat(64)}`);
results.forEach(r => console.log(`  ${r.code === 0 ? 'ok  ' : 'FAIL'}  ${r.s}`));
const failed = results.filter(r => r.code !== 0);
console.log(failed.length ? `\n${failed.length} suite(s) failed` : '\nall suites passed');
process.exit(failed.length ? 1 : 0);
