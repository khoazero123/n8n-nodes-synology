# Errors

---

## [ERR-20260804-001] n8n smoke test after restart used stale auth cookie

- **Logged**: 2026-08-04
- **Context**: Manual shelf smoke test after restarting the temporary n8n process.
- **What happened**: REST workflow creation returned 401 because the old cookie jar belonged to the previous n8n process/database session.
- **Fix**: The automated E2E script performs owner setup/login at runtime and captures the fresh cookie instead of relying on a stale external cookie.
