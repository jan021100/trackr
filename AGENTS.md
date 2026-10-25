# Trackr — AI coding guidance
Stack: SvelteKit/Svelte 5, TypeScript, Firebase/Firestore, OpenAI. Inspect existing code, configuration, and product intent before edits.
- Prefer small, readable, focused changes. Reuse existing patterns; do not add packages without checking provenance, maintenance and necessity.
- For complex features, provide a brief plan and testable acceptance criteria first. Avoid unrequested rewrites and assumptions.
- Never trust client-provided UID or role as authentication. Enforce server-side identity and object-level authorization, including with Firebase Admin SDK (which bypasses Firestore rules).
- Use safe database APIs/parameterized SQL. Validate input, encode output and keep secrets server-side. Do not log private content.
- Protect billable AI routes against abuse with appropriate authentication, quotas, request limits and rate limiting.
- Check Firestore permissions and cross-user access with negative tests; do not change intentional public access without checking requirements.
- Design useful, responsive, accessible UI; do not blindly ban icons, fonts or layouts. See frontend-design skill.
- For security-sensitive tasks apply security-review skill; before launch review pre-launch-checklist.md.
- Run npm run check and npm run build when available, plus relevant tests (functions/ has separate build/lint). Never claim tests ran if they did not.
- Summarize changed files, verification performed, and unresolved risks.