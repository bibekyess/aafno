## What & why

<!-- One paragraph: what this PR does and why. Link to the spec/plan if they exist. -->
<!-- Tier: trivial | small | full — matches the final commit's `Change-Tier` trailer. -->

## Files changed

<!-- Bullet list of areas/files added or modified. -->

## Intentional contract changes

<!-- List any observable interface or compatibility changes that are intentional.
     If none, write "None." -->

## ADRs added / updated

<!-- List each ADR file (filename + one-line summary). If none, write "None." -->

## Spec / plan links

- Spec: `specs/<slug>.md`
- Plan: `plans/<slug>.md`

---

## Review checklist (for the reviewer)

### Pass 1 — Correctness
- [ ] Satisfies every Given/When/Then acceptance criterion in the spec
- [ ] Wired end-to-end (not just constructed)
- [ ] Edge cases and error paths handled

### Pass 2 — Conventions & Rules
- [ ] AGENTS.md conventions followed
- [ ] Existing patterns reused; no needless abstraction
- [ ] No dead code or commented-out blocks

### Pass 3 — Interfaces & Compatibility
- [ ] Observable contracts preserved or intentional changes documented above
- [ ] No unintended breaking changes

### Pass 4 — Architecture & ADR drift
- [ ] Change fits the architecture (layering, separation)
- [ ] All new architectural decisions covered by an ADR in this PR
- [ ] ADR statuses correct (`Accepted` for implemented, `Superseded` for replaced)

### Pass 5 — Security
- [ ] No secrets in code; config from environment variables
- [ ] Input validation on user-supplied fields
- [ ] Auth/permission checks on protected paths
