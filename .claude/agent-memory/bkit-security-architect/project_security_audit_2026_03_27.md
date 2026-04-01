---
name: Security Audit 2026-03-27
description: Initial security audit found 7 critical issues - API key hardcoding, no rate limiting, token management flaws, SQL injection, WebSocket broadcast, missing role checks
type: project
---

7 vulnerabilities confirmed via code review on 2026-03-27.
**Why:** code-analyzer flagged them; user requested remediation plan.
**How to apply:** Track fixes by priority. Helmet and throttler packages are installed but unused -- low-hanging fruit.
