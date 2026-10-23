# Trackr Study

## Scope and platform
Existing SvelteKit web app, desktop and mobile. This brief covers Study only. Other Trackr areas remain independent.

## User and purpose
German doctor in Prague, English medical programme. Surgery and Paediatrics passed; retain both as frozen read-only archives. Active study includes clinical Medicine and Czech. Czech is starting from an A1/A2 refresher with no level ceiling for everyday and clinical communication.

## Clinical Medicine
Long-term case-based maintenance and development across all clinical specialties, not state-exam preparation. Include non-state-exam clinical subjects, individual clinical reasoning and practical care; exclude standalone Public Health, Hygiene and Epidemiology modules. Uploaded resources support foundations. Current official guidelines and exact source access are required for treatment and safety grading. Observed case performance is not whole-specialty competence. Czech stays independent. Offer a full patient simulation and a 5–8 minute short-vignette mode. Open gaps become due after three days; only independent correct retrieval at or after that point closes them. Failed retrieval resets the same gap to three days; semantic repeats reuse explicit IDs, normalized identical questions also deduplicate transactionally. Prompts carry at most three due gaps plus twelve short existing-gap references, never the entire history. Closed gaps leave the active list but remain recoverable in history. An opt-in, revocable private calendar subscription publishes only completed Medicine and Czech session start/end times with distinct subject titles, merging consecutive sessions of the same subject with gaps strictly below fifteen minutes; never publish clinical content or assessments.

## Workflow
Short practice, copy a tutor prompt, track active time and pauses, import structured evidence and specific gaps, revisit weak skills and export gaps for Anki. In Medicine, Enter imports a pasted patch (Shift+Enter adds a line); a valid file upload imports directly. Importing its matching patch closes the session and saves active time atomically; unrelated, duplicate or invalid patches never stop another session. Mixed practice is the default; listening, speaking, reading and writing are assessed separately; no exam countdown or claimed CEFR certification.

## Constraints
Keep existing dark Study identity, account-owned storage and phone usability. Archive data loads only on explicit archive visits. Preserve all previous records; no data migration or deletion.
