# Environment Variables - JOSH 2.0 (Deprecated)

This file is deprecated as the canonical env-var inventory.

Use this document instead:
- `docs/runbooks/environment-contract.md`

## Why

`docs/runbooks/environment-contract.md` is now the single source of truth for:

- Canonical variable list
- Required vs optional status
- Format and validation constraints
- Local/staging/production set locations
- Security and rotation expectations
- Verification commands to keep coverage complete

## Guardrails (Still Applicable)

- Never commit secrets.
- Never print secret values in logs or docs.
- Keep strict environment isolation (local, staging, production).
- Update the canonical contract in the same PR when env vars change.
