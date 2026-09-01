# V55.1 — Language Layer

Adds a system-wide per-user language preference with exactly two supported options:
- `en` — English
- `hi` — हिन्दी

## APIs
- GET `/api/settings/language`
- POST `/api/settings/language`

The preference is stored per user, so an Owner and their sub-users can independently choose English or Hindi. UI modules can use this preference for role-specific translated labels.

No third language is enabled in this phase.
