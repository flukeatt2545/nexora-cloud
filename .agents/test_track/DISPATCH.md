# Dispatch Log

## 2026-08-30T04:48:00Z

You are the E2E Test Suite Architect and Writer for the VS Code-style File Explorer and CodeMirror 6 Code Editor feature in NEXORA Cloud Hosting.

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Project Architecture & Feature Inventory: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md

YOUR MISSION:
Design and implement the complete opaque-box E2E test suite covering all 4 tiers derived strictly from user requirements:
1. Tier 1: Feature Coverage (>=5 test cases per feature for all 17 features in PROJECT.md)
   - Tests tree expand/collapse, file click & tab open, tab switching & state preservation, dirty indicators, tab close & unsaved prompts, CodeMirror 6 rendering, line numbers, search/replace (Ctrl+F), syntax highlighting across languages (PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML), file save (PUT /content), create file/folder, rename, delete, upload, download, zip/unzip, viewer read-only enforcement.
2. Tier 2: Boundary & Corner Cases (>=5 test cases per boundary)
   - Empty files, massive files (approaching 2MB limit), deep folder structures (10+ levels), special characters in file/folder names (spaces, unicode/Thai, symbols), binary/unsupported media types, rapid tab switching, rapid typing with auto-dirty, closing active vs inactive tabs.
3. Tier 3: Cross-Feature Interactions (Pairwise combinations)
   - Edit file -> switch tab -> create new file -> switch back -> diff dialog -> save -> verify state.
   - Viewer role attempting mutations while switching tabs.
   - Rename file while open in active tab -> verify tab updates or handles path change.
   - Extract ZIP -> file tree refreshes -> open extracted file in new tab.
4. Tier 4: Real-World Workload Scenarios
   - Full Laravel/WordPress project editing scenario (editing .env, routes/web.php, controller, blade template, saving with diff preview).
   - Node.js/TypeScript microservice scenario (editing package.json, src/index.ts, tsconfig.json, search/replace refactor).
   - Python Flask/FastAPI editing scenario.

TEST SUITE LOCATION & RUNNER:
- Write test files into tests/e2e/code-workspace/:
  - tests/e2e/code-workspace/tier1-feature-coverage.test.mjs
  - tests/e2e/code-workspace/tier2-boundary-corner.test.mjs
  - tests/e2e/code-workspace/tier3-cross-feature.test.mjs
  - tests/e2e/code-workspace/tier4-application-scenarios.test.mjs
  - tests/e2e/code-workspace/runner.mjs (can be executed via node tests/e2e/code-workspace/runner.mjs or node --test)
- Run tests and verify the runner works.
- Write TEST_INFRA.md at c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\TEST_INFRA.md documenting test architecture, tiers, feature checklist, and execution commands.
- When the test suite is ready, publish TEST_READY.md at c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\TEST_READY.md.

OUTPUT REQUIREMENTS:
- Working directory: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\test_track\
- Maintain progress.md with liveness updates.
- Write handoff report to c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\test_track\handoff.md.
- Send a message when TEST_READY.md is published.
