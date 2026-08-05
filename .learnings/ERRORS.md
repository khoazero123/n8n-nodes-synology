# Errors

---

## [ERR-20260804-001] n8n smoke test after restart used stale auth cookie

- **Logged**: 2026-08-04
- **Context**: Manual shelf smoke test after restarting the temporary n8n process.
- **What happened**: REST workflow creation returned 401 because the old cookie jar belonged to the previous n8n process/database session.
- **Fix**: The automated E2E script performs owner setup/login at runtime and captures the fresh cookie instead of relying on a stale external cookie.

## [ERR-20260805-001] heredoc command was escaped literally

- **Logged**: 2026-08-05
- **Context**: Probing the NAS Download Station API from a shell command.
- **What happened**: The tool call passed literal `\\n` sequences into a Python heredoc, causing a syntax error.
- **Fix**: Use a simple `python3 -c` probe or a properly literal multiline command; verify the command before relying on its output.

- 2026-08-05: Initial remote frontend grep probe failed because a quoted heredoc was escaped incorrectly inside the SSH command. Retry with a one-line remote Python command or a temporary script.
