# Friction log (template)

The hackathon accepts optional friction-log entries for each tool, API or SDK used. Add **real** entries as you
hit them; do not pre-fill. Fields: task attempted, steps taken, expected vs actual, severity, workaround, suggestion.

## Entry template
- **Tool/SDK:**
- **Task attempted:**
- **Steps:**
- **Expected / Actual:**
- **Severity:** low | medium | high
- **Workaround:**
- **Suggestion:**

## npm workspace dependency restoration (local audit, 2026-10-23)

- **Tool/SDK:** npm 11.9.0, npm workspaces, Windows PowerShell.
- **Task attempted:** Restore the local workspace links so the repository typecheck could resolve `@exam-sprint/core`.
- **Steps:** From the repository root, run `npm install --ignore-scripts --no-audit --no-fund --package-lock=false`; after it did not complete, retry with `--offline`.
- **Expected / Actual:** Expected npm to finish linking existing workspace packages. The first attempt produced no output and was interrupted after roughly 90 seconds. The offline retry exited with `ENOTCACHED` for a `brace-expansion` package tarball and a cleanup `EPERM` warning for a `rolldown` directory. The core workspace link appeared during the attempts; a subsequent typecheck passed. No lockfile change was made, and a clean install was not verified.
- **Severity:** medium.
- **Workaround:** The local workspace link appeared during the install attempts and typecheck passed afterward. A clean install remains unverified; confirm installation from a clean checkout with registry access before relying on this as a supported workaround.
- **Suggestion:** Surface which workspace links and package tarballs are missing early, and provide an actionable cache/registry error instead of appearing stalled. Confirm that the lockfile supports clean Windows installation.
