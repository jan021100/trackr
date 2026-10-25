# Codex toolkit v1 pilot
This intentionally lean setup contains AGENTS.md, two targeted skills and pre-launch-checklist.md. No third-party skill packages installed.
## Pilot audit, 2026-10-25
- Repository: SvelteKit 2 / Svelte 5 / Firebase. package.json defines npm run check and npm run build. No prior AGENTS.md or .agents/skills found.
- src/routes/chatapi/+server.ts uses `uid` supplied in JSON and reads `users/{uid}` with Firebase Admin SDK, without visible verification of the requester's authenticated identity. Potential serious broken object authorization if route publicly reachable; deploy/runtime context remains unverified.
- The same route invokes AI without visible throttling and logs user data/messages: investigate privacy and cost.
- firestore.rules permits public read of /items/{itemId} (comment says temporary for tests): confirm intention; do not silently change.
## Test prompt
Ask Codex: "Apply the security-review skill to src/routes/chatapi/+server.ts; provide a minimal remediation plan for cross-user access, synthetic two-user negative tests and abuse prevention. Do not deploy."
## Follow-up
Test this against a real feature, capture missed issues, then revise only rules proven useful. Static audits do not prove live exploitability. No application code altered or production checks run.