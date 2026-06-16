// Shared leaf for the EXTEND panels (docs/MAINTAINABILITY.md Phase 1).
// SKILL_NAME_RE validates the lowercase-hyphen id used by skills, commands and
// agents (the directory/file name). Extracted verbatim from App.tsx.
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
