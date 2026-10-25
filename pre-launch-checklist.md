# Pre-launch review (technical + Germany/EU applicability)
Mark each point applicable, not applicable or needs review. This is not legal advice.
- [ ] Authentication and server-side object-level authorization verified; test user A cannot access user B data.
- [ ] Firestore/Supabase policies and Admin SDK accesses reviewed; intended public access documented.
- [ ] Safe queries, validation, output encoding, secrets, personal-data logging, deletion and retention checked.
- [ ] Expensive API/AI endpoints have appropriate abuse controls, request size limits and cost monitoring.
- [ ] Packages verified; tests/build, accessibility, responsive layouts and core user journeys checked.
- [ ] For commercial websites, determine applicable imprint and accurate privacy disclosures.
- [ ] Assess third-party fonts, trackers/embeds, required consent and fair consent choices.
- [ ] Assets and logos have appropriate rights; assess consumer checkout obligations if selling.
- [ ] EU ODR platform closed July 20, 2025: avoid outdated link requirement; assess other dispute-resolution obligations.
- [ ] Check if German BFSG accessibility obligations apply. Its microenterprise exception refers to fewer than 10 employees and <= EUR 2m annual turnover/balance sheet for covered services, NOT 10 customers.
- [ ] Request qualified legal review when needed.
Sources: OWASP SQL Injection Prevention, OWASP IDOR Prevention, European Commission ODR closure, German BFSG.