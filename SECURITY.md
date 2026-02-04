# Security Policy — JOSH 2.0

## Purpose

This document defines the minimum security rules for working in this repository.
These rules are mandatory and apply to all contributors and tools.

---

## Secrets And Credentials

- **Never commit secrets** to this repository.
- Secrets include (but are not limited to):
  - API keys
  - Tokens
  - Private keys
  - Webhook secrets
  - Service credentials

All secrets must be supplied via environment variables.

If a secret is accidentally committed:

1. Assume it is compromised.
2. Rotate it immediately.
3. Remove it from Git history if required.

---

## Environment Files

- `.env` and `.env.*` files are ignored by Git.
- `.env.example` is the only environment file that may be committed.
- `.env.example` must never contain real secrets.

---

## AI And Generated Content

- AI-assisted code must follow all project rules and specs.
- Generated code is reviewed the same way as human-written code.
- Prompts, prompt templates, and personality constraints are treated as code and versioned in Git.
- No AI tool may introduce:
  - Undocumented behavior
  - Hidden state
  - Implicit data storage
  - Safety bypasses

---

## Safety-Critical Systems

The following areas are considered safety-critical:

- SMS handling
- Safety and abuse prevention
- Eligibility and entitlements
- Contact exchange
- Learning and derived state updates

Changes in these areas require extra care and explicit verification.

---

## Responsible Disclosure

If you discover a security vulnerability:

- Do **not** open a public issue.
- Do **not** disclose it publicly.
- Contact the repository owner directly.

---

## Non-Negotiable Rule

If a change improves speed or convenience but weakens security, **do not make the change**.
