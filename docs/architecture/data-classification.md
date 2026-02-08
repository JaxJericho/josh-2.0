# Data Classification — JOSH 2.0

This document defines data classes and handling rules for JOSH 2.0.
Do not include secrets or PII in documentation.

## Data Classes

### Public
- Safe to publish
- Example: marketing copy, public docs

### Internal
- Non-public operational data
- Example: runbooks, non-sensitive metrics

### Confidential
- Sensitive user or operational data
- Example: user profiles, message metadata

### Restricted
- Highly sensitive or regulated data
- Example: message bodies, encryption keys, safety incidents

## JOSH Data Types → Classification

- Phone numbers: Restricted
- Profile traits (age, location, preferences): Confidential
- Message bodies (SMS content): Restricted
- Encryption keys (SMS_BODY_ENCRYPTION_KEY, JWT secrets): Restricted
- Safety strikes/incidents: Restricted
- Payment metadata (Stripe customer IDs): Restricted
- System logs (non-PII): Internal

## Handling Rules By Class

### Public
- Logging: allowed
- Access: unrestricted
- Export: allowed

### Internal
- Logging: allowed (no PII)
- Access: least privilege
- Export: allowed with internal approval

### Confidential
- Logging: avoid payloads; log only IDs
- Access: least privilege, role-based
- Export: approved only; redact PII where possible

### Restricted
- Logging: never log contents
- Access: strict least privilege; audited access where possible
- Export: only with explicit approval; redact or tokenize wherever possible

## Systems And Access Boundaries

### Supabase (Database)
- Stores authoritative user data
- Access by server-side code only
- Restricted data must never be exposed to client

### Vercel (App + API)
- Handles HTTP and cron routes
- Must avoid logging restricted data
- Env vars are secrets; never log values

### Twilio (SMS Provider)
- Receives and transmits message bodies
- Treat all message content as Restricted
- Do not store long-term message bodies in Twilio logs

### Stripe (Payments)
- Store only required identifiers
- Do not store full payment instrument data
- Treat identifiers as Restricted

## Logging And Observability Rules

- No message bodies in logs
- No phone numbers in logs
- Log IDs and event types only
- For secrets, log only: set/unset, length, sha256 prefix

## Export Rules

- Exports must be approved and logged internally
- Restricted exports require redaction or anonymization
- Do not export safety incidents without explicit approval
