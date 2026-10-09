import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testSuites = [
  { name: 'Tier 1: Feature Coverage (17 Features)', file: 'tier1-feature-coverage.test.mjs' },
  { name: 'Tier 2: Boundary & Corner Cases (8 Boundaries)', file: 'tier2-boundary-corner.test.mjs' },
  { name: 'Tier 3: Cross-Feature Interactions', file: 'tier3-cross-feature.test.mjs' },
  { name: 'Tier 4: Real-World Workload Scenarios', file: 'tier4-application-scenarios.test.mjs' },
  { name: 'Tier 5: Adversarial & Stress Hardening', file: 'tier5-adversarial.test.mjs' }
];

console.log('================================================================');
console.log(' NEXORA Cloud: VS Code Explorer & CodeMirror 6 E2E Test Suite');
console.log('================================================================\n');

let totalSuites = 0;
let passedSuites = 0;
let failedSuites = 0;
let totalTestsPassed = 0;
const startTime = Date.now();

async function runSuite(suite) {
  return new Promise((resolve) => {
    const fullPath = path.join(__dirname, suite.file);
    const child = spawn(process.execPath, ['--test', fullPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      totalSuites++;
      if (code === 0) {
        passedSuites++;
        const matchPass = stdout.match(/pass\s+(\d+)/);
        const passCount = matchPass ? parseInt(matchPass[1], 10) : 0;
        totalTestsPassed += passCount;
        console.log(`[PASS] ${suite.name.padEnd(52)} (${passCount} tests)`);
        resolve(true);
      } else {
        failedSuites++;
        console.error(`[FAIL] ${suite.name.padEnd(52)} (Exit code ${code})`);
        if (stderr) console.error(stderr);
        if (stdout) console.error(stdout);
        resolve(false);
      }
    });
  });
}

async function runAll() {
  for (const suite of testSuites) {
    await runSuite(suite);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n----------------------------------------------------------------');
  console.log(`Execution Summary: ${passedSuites}/${totalSuites} suites passed, ${totalTestsPassed} total tests passed in ${duration}s`);
  console.log('================================================================');

  if (failedSuites > 0) {
    process.exit(1);
  } else {
    console.log('ALL 5 TIERS OF E2E TESTS PASSED SUCCESSFULLY! (100% PASS RATE)\n');
    process.exit(0);
  }
}

runAll();