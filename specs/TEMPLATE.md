---
title: <short feature title>
date: <YYYY-MM-DD>
status: Draft        # Draft | Ratified | Delivered
---

# <YYYY-MM-DD> — <short feature title>

## Objective
One paragraph: the problem and the user/business value. What and why — not how.

## User stories
- As a <role>, I want <capability> so that <benefit>.

## Functional requirements
- Numbered, testable statements of what the system must do.

## Edge cases
- Boundary conditions, error states, and unusual inputs that must be handled.

## Acceptance criteria
Binary and testable, in Given/When/Then form:
- **Given** <context>, **when** <action>, **then** <observable outcome>.

## Non-functional requirements
- Performance, security, compliance, observability, accessibility — whatever applies.

## Assumptions & open questions
List every unstated decision, ranked by impact. HIGH-impact items must be resolved by
the user before this spec can be `Ratified`.
- `[ASSUMPTION | HIGH]` <what was assumed, and what to confirm>
- `[ASSUMPTION | MEDIUM]` ...
- `[OPEN QUESTION | LOW]` ...
