---
name: security-review
description: Review web app authentication, object-level authorization, database access, expensive AI endpoints, secrets, dependencies and sensitive changes.
---
# Security review workflow
1. Map routes, data stores, the real authenticated principal and trust boundaries.
2. For each sensitive read/write, verify server-side identity and object ownership/role. Never trust a client-provided UID. Admin SDK bypasses Firestore rules.
3. Review Firestore policies/RLS for least privilege, cross-user access, and any intended public collections.
4. Prevent injection with parameterized SQL/safe query APIs, not by stripping special characters; validate and encode by context.
5. Check secret handling, sensitive logging, API authentication as appropriate, per-user/IP throttling, quotas, request size and AI billing limits.
6. Check dependency provenance and security advisories before installation.
7. Test with synthetic user A/B, unauthenticated requests and invalid payloads; do not probe production destructively.
8. Report finding, precise file/line evidence, impact, severity, confidence, remediation and whether tests ran.
References: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html and https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html