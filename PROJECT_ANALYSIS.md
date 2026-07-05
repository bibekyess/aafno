# AAFNO — Project Analysis (Consolidated Reference)

**Status:** Direction validated (research-backed, July 2026). Ready for a verification pass, then Phase 1.
**Audience:** Implementing agent/developer/planner. This document consolidates and supersedes
`PROJECT_BRIEF.md`, `AAFNO_PRODUCT_REVIEW.md`, and `DEVELOPMENT_GUIDE.md` (source files to be
deleted after this consolidation). It is the single canonical reference for phase-wise planning
and implementation of AAFNO.

> **Source note:** every claim below traces to one or more of the three source documents. Where
> the sources diverged slightly, the divergence is flagged explicitly rather than silently
> resolved (see "Reconciled divergences" at the end of each relevant section).

---

## Table of Contents

1. [Product Vision, Differentiation & Moat](#1-product-vision-differentiation--moat)
2. [Target Users](#2-target-users)
3. [Locked Technology Stack](#3-locked-technology-stack)
4. [Day-1 Constraints](#4-day-1-constraints)
5. [Verification Unknowns — Confirm in the Phase-0 Spike](#5-verification-unknowns--confirm-in-the-phase-0-spike)
6. [Product Principles](#6-product-principles)
7. [Key Risks & Warnings](#7-key-risks--warnings)
8. [Consolidated Phased Plan](#8-consolidated-phased-plan)
9. [Privacy Console Spec](#9-privacy-console-spec)
10. [Engineering Practices](#10-engineering-practices)
11. [Repository Artifact Lanes & Immediate Next Steps](#11-repository-artifact-lanes--immediate-next-steps)
12. [Suggested Requirement Themes](#12-suggested-requirement-themes)

---

## 1. Product Vision, Differentiation & Moat

**What we are building:** A website — open the URL and go, no install, no signup, nothing
leaves the device — that does two things:

1. **Document Q&A (RAG):** upload docs → parse → chunk → embed → retrieve → answer, all
   client-side.
2. **Writing:** a rich-text editor (Tiptap) with the documents as grounding/context.

**Core identity: privacy is the product.** All inference (parse, embed, retrieve, generate) runs
in the browser via WebGPU. No backend in production. A configurable OpenAI-compatible cloud
endpoint (base URL + model + API key) is a **dev-only** shortcut for fast pipeline iteration and
is compile-time excluded from production builds.

**One-line positioning:**

> A private, zero-install AI writing workspace where users can ask questions from their files,
> draft with grounded context, inspect every network boundary, and keep their documents on their
> own device.

**The moat — read this first:** In-browser PDF Q&A is **already a crowded demo space**
(ask-my-pdf, SemanticFinder, BARQ, ChatGPP, on-device-rag, Vectoria — all fully client-side, all
open source). The RAG pipeline is now commodity. **The moat is the WRITING workspace + product
polish + frictionless private UX, not the RAG.** Q&A is table stakes; "a private in-browser AI
writing tool with great document grounding" is the wedge. Prioritize accordingly — the editor
must appear early in the product (Phase 1), even if it starts simple. Deferring the writing
workspace too long risks AAFNO looking like just another PDF chatbot.

Document Q&A should be treated as table stakes; the real product value comes from writing
workflows:
- Draft from selected sources
- Ask about highlighted text
- Insert cited passages into a document
- Rewrite using uploaded context
- Check claims against local files
- Maintain source trails while authoring

**Closest conceptual competitor:** **Reor** (local AI notebook + RAG) — but it's an Electron
*desktop install*. AAFNO's zero-install browser delivery + observable privacy is the gap Reor
doesn't fill.

A built-in **Privacy Console** (see §9) that shows — not just claims — the device boundary could
become a signature/distinctive brand feature.

**The promise, in plain language:**

> Open the app. Add your files. Work with AI. Your documents stay on your device.

**Product framing (final recommendation):** AAFNO should not compete as a generic in-browser RAG
demo. It should be positioned as a private AI writing and research workspace, not only a file
chatbot. The two most important early bets:
1. Make the first-run model and local processing experience feel trustworthy and smooth.
2. Build the writing workspace early enough that AAFNO is clearly more than Q&A.

---

## 2. Target Users

- Researchers and students
- Writers and analysts
- Legal and policy workers
- Founders and operators reviewing private docs
- Privacy-conscious professionals

---

## 3. Locked Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| **PDF/doc parse** | `liteparse-wasm` (Rust→WASM, multi-format) | ✅ **Confirmed** — already used, works well, license OK. **Do NOT use MuPDF.js** (AGPL). PDF.js only if a format edge-case needs it. Already validated by the team — no further verification action needed. |
| **Chunking** | `chonkie-ts` | Chosen for flexibility (Recursive + Semantic + Token chunkers). Zero-dep, runs in-browser. |
| **Embeddings** | `EmbeddingGemma` via `transformers.js` on WebGPU | Same runtime (transformers.js/ONNX) as the LLM — one inference stack. WASM fallback automatic. |
| **Vector store** | **PGlite + pgvector** (from the start — no brute-force) | Full Postgres-in-WASM: documents + chunks + metadata + `tsvector` full-text + vectors in one durable store. Persists to IndexedDB/OPFS. Enables hybrid (BM25 + vector) search later in a single query. LEANN was considered and dropped (Python-only, confirmed unsuitable). |
| **LLM (generation)** | **Gemma-4-E2B** (WebGPU, ONNX via `transformers.js`) — user has working code. `SmolLM2-360M` as a lightweight dev/fast tier | **Dev-only cloud flag:** any **OpenAI-compatible endpoint** — configurable base URL + model name + API key. Compile-time excluded from production. |
| **Editor** | **Tiptap** (latest version) | The differentiator. Co-equal pillar with QnA. |
| **Persistence** | OPFS for model weights; **PGlite** (persisted to IndexedDB/OPFS) holds documents + chunks + metadata + vectors | Avoids re-download and re-indexing on reload — critical for UX. |
| **Acceleration ladder** | WebGPU now → OpenAI-compatible endpoint (dev only). WebNN/NPU = **later**, do not build on it | WebNN is experimental in 2026 (Chrome/Edge only, behind flags, no Firefox/Safari). |
| **App shell** | **React + Vite**; heavy work in Web Workers | Parse, embed, and inference must run off the main thread — heavy work must not block the main UI thread. |

**Do-not list:**
- Do **not** use MuPDF.js (AGPL license conflict).
- Do **not** build on WebNN/NPU yet (experimental, narrow browser support in 2026) — investigate only once it stabilizes, no earlier than Phase 3.
- Do **not** rely on LEANN (Python-only; incompatible with the in-browser requirement).

---

## 4. Day-1 Constraints

Bake these in from the start; they are non-negotiable:

- **No production backend.** If a feature needs a server, it breaks the product identity —
  flag it, don't build it.
- **Cloud = dev only, and compile-time excluded from production.** A configurable
  OpenAI-compatible endpoint (base URL + model + API key) exists purely for fast dev-time
  pipeline iteration. Any cloud call must be an explicit, visible user choice; production builds
  must not include cloud inference code paths at all (not merely disabled by config/flag —
  compiled out).
- **Persistence is not optional.** Re-indexing or redownloading on every reload is a dealbreaker
  and will make the product feel unreliable.
- **Desktop-first; mobile must not constrain desktop.** The primary product is desktop-first.
  Mobile can support lighter workflows later (reading, writing, small-context Q&A). Heavy file
  ingestion and large model operation should not be forced into the initial mobile experience,
  and mobile considerations should not shape or limit the desktop-first MVP.
- **Honest UX about the model download.** The "no hassle" promise fights a multi-hundred-MB
  model fetch — make the wait feel productive and understandable rather than hiding or
  downplaying it.

---

## 5. Verification Unknowns — Confirm in the Phase-0 Spike

The stack is locked (§3), but these technical unknowns must be confirmed during the Phase-0
spike before investing further:

1. ⚠️ **PGlite + pgvector**: confirm pgvector's **HNSW index builds under PGlite** (exact/flat
   scan is an acceptable fallback at personal-corpus scale), and that the DB **persists across
   reloads via OPFS/IndexedDB**.
2. ⚠️ **chonkie-ts**: confirm the Recursive + Semantic chunkers run in-browser and integrate
   cleanly with the EmbeddingGemma tokenizer/token limits.
3. ⚠️ **Model warm-load**: confirm OPFS caching brings Gemma-4-E2B warm loads to **~2–3s** (cold
   download is the pain point — see #4).
4. ⚠️ **First-load UX / cold-start**: measure cold-start (model download **20s–3min**). Design
   the "use SmolLM2-360M or the dev cloud endpoint while Gemma-4-E2B downloads" flow. **This is
   the #1 UX risk** for the whole product.
5. ⚠️ **Browser coverage**: WebGPU ≈ **82%** coverage (Chrome/Edge solid; Firefox/Safari
   partial; AMD/Linux driver bugs reported). Confirm the WASM fallback path works for both
   embeddings and generation.

---

## 6. Product Principles

### Privacy should be observable
Do not hide privacy behind a policy page — show the user what is happening in real time, e.g.:
- "Parsed locally"
- "Generated embeddings on this device"
- "Saved index to browser storage"
- "No document content sent over the network"
- "Downloaded model weights from source domain"

The user should be able to inspect this activity without opening browser DevTools.

### Useful before complete
The MVP should support a small number of excellent workflows rather than many shallow ones.
Recommended early workflows:
- Upload one or more files
- Ask grounded questions with citations
- Open a writing document
- Insert cited answers into the document
- Ask AI to rewrite or expand selected text using local sources

### Model management is product UX
Model selection, download, caching, and fallback are product surfaces, not backend details. The
user should always understand:
- Which model is active
- Whether it is local
- Whether it is downloaded or still loading
- How much space it uses
- Why a smaller or larger model may be recommended

### Desktop-first, mobile later
The primary product is desktop-first; mobile supports lighter workflows later (reading, writing,
small-context Q&A). Heavy file ingestion and large model operation are not forced into the
initial mobile experience.

---

## 7. Key Risks & Warnings

### 1. First-run model download is the biggest UX risk
"No install" can still feel like an installation if the user immediately faces a large model
download with unclear progress. This flow should be designed as a core onboarding experience,
not a loading screen. Requirements should include:
- Clear model size before download
- Download progress with speed and remaining-time estimate
- Resumable or cached downloads where possible
- Explanation of why the model is needed
- Small-model quick-start option
- Warm-load behavior that feels fast after the first run
- Honest messaging if the browser/device is not suitable

### 2. Browser capability differences will matter
WebGPU, WASM fallback, OPFS, memory limits, and model execution will vary across browsers and
devices. The product should not silently fail or appear broken when a device cannot run the
preferred model. Requirements should include:
- Browser/device capability detection
- Clear compatibility messaging
- Graceful fallback modes
- Model tier recommendations based on device capability
- Avoiding mobile constraints during the desktop-first MVP

### 3. "Local only" must be technically enforced
Cloud inference may be useful during development, but production must not depend on hidden
configuration or developer discipline. Trust depends on both design and enforcement.
Requirements should include:
- Production builds exclude cloud inference code paths (compile-time, not just config-gated)
- Any network call is classified by purpose
- Cloud endpoints are impossible to enable accidentally in production
- If a user-visible remote option ever exists, it must be explicit and clearly labeled

### 4. Persistence is not optional
If users must redownload models or re-index files after reload, the product will feel
unreliable. Requirements should include:
- Persistent local model cache
- Persistent document metadata
- Persistent chunks and embeddings
- Clear local storage usage display
- Ability to delete local data
- Recovery from interrupted indexing or model download

### 5. The technical stack is ambitious
Multiple hard systems are being combined: WASM document parsing, in-browser chunking, WebGPU
model execution, transformers.js model loading, PGlite and pgvector, OPFS/IndexedDB
persistence, web workers, and Tiptap editor integration. This must be validated with a focused
technical spike (Phase 0) before building the polished app shell.

### Initial risk register
(Track project-wide risks here, feature-specific risks in `specs/` and `plans/`, and durable
architecture tradeoffs in `adr/` — see §11.)

- WebGPU browser/device compatibility
- Large model download friction
- OPFS/IndexedDB persistence issues
- PGlite + pgvector limitations
- Memory pressure with large documents
- Safari/Firefox behavior
- Model quality for writing
- Citation correctness
- Accidental cloud call in production

---

## 8. Consolidated Phased Plan

The three sources describe the same four phases with slightly different emphasis and detail; the
plan below merges all scope items and success/acceptance criteria from all three. Nothing from
any source's phase description has been dropped.

### Phase 0 — Verification Spike

**Goal:** prove the full client-side pipeline works end-to-end before investing in polish.

**Scope:**
- Upload one PDF/document → `liteparse-wasm` parse (locally) → `chonkie-ts` chunk →
  `EmbeddingGemma` (via `transformers.js`/WebGPU) embed locally → store chunks + vectors in
  PGlite+pgvector → retrieve relevant chunks → generate an answer with Gemma-4-E2B (locally).
- Dev cloud flag (OpenAI-compatible endpoint) enabled, and `SmolLM2-360M` available, for fast
  iteration during the spike.
- Persist data across reload; measure cold-load and warm-load timings.

**Success criteria:**
- End-to-end local Q&A works.
- Model download and load times are measured.
- Storage persists across reload.
- Retrieval latency is acceptable for a personal corpus.
- Browser limitations are documented.
- The §5 verification unknowns are confirmed or their answers documented.

**Phase 0 output should include:**
- Working technical demo
- Measurement notes
- Known limitations
- Updated risk register
- Decision log updates

### Phase 1 — Desktop MVP Shell

**Goal:** build the real user-facing app around the validated pipeline, desktop-first.

**Scope:**
- Document library
- Model manager
- Upload and indexing progress
- Q&A with citations
- Persistence (OPFS for models + doc store, IndexedDB/PGlite for vectors); multi-doc support
- Model-download UX; WASM fallback
- Basic **Tiptap** writing editor — stood up alongside QnA; this is the differentiator and must
  not be deferred
- Privacy Console
- Local storage management
- Worker-based background processing

**Success criteria:**
- User can upload files, ask questions, and write in the same workspace.
- User can see what is local and what network calls occurred.
- Reloading the app does not lose indexed work.
- The first-run model experience is understandable.
- (Roadmap-level acceptance detail) User can upload multiple documents; answers include
  citations; user can write in the editor; user can insert a cited answer into the editor;
  indexed documents persist after reload; Privacy Console shows local and network activity;
  model download progress is clear.

### Phase 2 — The Writing Workspace

**Goal:** make AAFNO meaningfully different from file-chatbot demos; editor ↔ RAG integration
is where the product wins.

**Scope:**
- Ask about selected editor text
- Draft from selected sources
- Insert cited answers/passages into the document
- Rewrite/expand using uploaded context
- Claim/source checking against local files
- Source-aware writing suggestions; better citation management

**Success criteria:**
- The editor and documents feel connected.
- Citations remain visible and useful.
- Users can move from question to authored output smoothly.

### Phase 3 — Compatibility, Polish, Mobile & Acceleration

**Goal:** improve reliability, resilience, and broader usability.

**Scope:**
- Better model tiers and model-tier recommendations
- Better onboarding and improved browser-compatibility handling
- Import/export of workspace data
- Mobile-light experience: same architecture, small-model tier (Gemma-4-E2B / SmolLM2-360M) —
  writing + light QnA, likely no heavy file upload
- Better storage controls; browser-specific fallback guidance
- Investigate WebNN/NPU offload once it stabilizes (optional, future)

**Success criteria:**
- Users understand device compatibility before frustration.
- Local state is easy to manage.
- The app feels dependable across realistic devices.

---

## 9. Privacy Console Spec

The Privacy Console should be considered a **major product feature, not a debug panel** — a
potential signature brand feature that makes the device boundary visible. It should be
understandable to non-technical users but useful to technical users: plain language first, with
expandable technical details. Avoid making it look like raw browser DevTools.

### Network section
Show app-origin network requests:
- Destination domain
- Request purpose
- Status
- Data type
- Timestamp
- Whether user content was sent

Example display text:
```text
No document content has left this device.
No prompt content has left this device.
Downloaded model weights from huggingface.co.
```

### Local Activity section
Show local processing events:
- Parsed file locally
- Created chunks
- Generated embeddings
- Stored vectors locally
- Retrieved source passages
- Generated answer locally

### Storage section
Show local storage state:
- Models cached
- Documents indexed
- Approximate storage used
- Clear local data action

### Recommended user-facing messages
```text
No document content has left this device.
Generated embeddings locally.
Saved document index to browser storage.
Downloaded model weights from huggingface.co.
Answer generated on this device.
```

### Technical note (how it's actually implemented)
Browsers do not allow a normal web app to inspect every global network request the way DevTools
can. AAFNO can show the requests that AAFNO itself makes by:
- centralizing network access through a fetch wrapper,
- instrumenting model downloads,
- and using a service worker where appropriate.

### `NetworkPurpose` classification

All intentional network requests should go through a central network client, which records URL,
domain, method, purpose, timestamp, status, and whether user content was included.

```ts
type NetworkPurpose =
  | "app_asset"
  | "model_download"
  | "dev_cloud_inference"
  | "update_check"
  | "unknown";
```

Production requirements for the network layer:
- Cloud inference should be compile-time excluded.
- Unknown network requests should be treated as suspicious.
- Privacy Console should show app-origin network activity.
- Sensitive user content should not be sent in production.

---

## 10. Engineering Practices

### Core development principles

1. **Privacy is an engineering requirement**, not only messaging or branding — it must be
   enforced in architecture, code, builds, tests, and UX.
   - Production builds must not include cloud inference paths.
   - User documents must not leave the device unless a future explicit remote mode is
     intentionally designed and clearly enabled by the user.
   - All intentional network calls go through a centralized network layer.
   - Network activity is visible in the Privacy Console.
   - Local activity is explainable to the user.
2. **Local-first by default** — the user's browser/device is the primary workspace.
   - Models cached locally where possible.
   - Documents, chunks, embeddings, and metadata persist locally.
   - Reloading the app does not force re-indexing or redownloading.
   - Local data deletion is easy and explicit.
3. **UX is part of the architecture** — the app's technical behavior must be understandable to
   users (clear model-download progress/purpose, visible status for long-running indexing jobs,
   honest browser/device limitation messages, visible privacy-boundary evidence, failure states
   that explain what happened and what the user can do next).
4. **Writing workspace is a first-class product pillar** — developed early enough that AAFNO is
   clearly a writing workspace, not just a chatbot over files.
5. **Spikes prove truth; product code builds the app** — experimental code is allowed and
   encouraged during validation but must be isolated. Spike code may be messy; product code must
   be typed, reviewed, tested, and maintainable.

### Recommended repository structure (spikes + src)

```text
spikes/
  rag-pipeline/
  model-loading/
  pglite-persistence/

src/
  app/
  features/
  workers/
  lib/
```

### Recommended project structure (once the application scaffold is created)

```text
src/
  app/
    routes/
    providers/
    shell/

  components/
    atoms/
    molecules/
    organisms/
    templates/
    pages/

  features/
    documents/
    editor/
    models/
    privacy-console/
    qna/
    workspace/

  workers/
    parse.worker.ts
    embed.worker.ts
    llm.worker.ts
    index.worker.ts

  lib/
    ai/
    db/
    network/
    storage/
    telemetry/
    workers/

  types/
```

Guidelines:
- Keep feature-specific UI and logic close together.
- Use Atomic Design for shared frontend composition:
  - `components/atoms/` for indivisible primitives such as buttons, inputs, icons, badges,
    progress bars, labels, separators, and tooltips.
  - `components/molecules/` for small composed controls such as search boxes, file upload rows,
    citation chips, model status rows, source selectors, and inline command bars.
  - `components/organisms/` for larger reusable interface sections such as the document sidebar,
    model manager panel, Privacy Console, Q&A panel, editor toolbar, upload queue, and source
    viewer.
  - `components/templates/` for route-level layouts and screen skeletons such as workspace
    layout, onboarding/model-download layout, document-review layout, and split editor/Q&A
    layout.
  - `components/pages/` for route-bound page compositions that assemble templates and feature
    modules. Pages should stay thin and avoid owning core business logic.
- Put browser APIs and infrastructure in `lib/`.
- Keep worker contracts typed and documented.
- Avoid global state unless the need is clear.

Atomic Design should support maintainability, not create busywork. If a component is used only
inside one feature and is unlikely to be shared, keep it inside that feature folder first. Promote
it to `components/` only when it becomes a genuine shared design element.

Suggested feature-local pattern:

```text
src/features/privacy-console/
  components/
  hooks/
  state/
  types.ts
```

### Worker architecture guidelines

Heavy work must not block the main UI thread. Worker candidates:
- File parsing
- Chunking
- Embedding generation
- Vector indexing
- Retrieval
- LLM generation

Each worker should have:
- Typed request messages
- Typed response messages
- Progress events
- Error events
- Cancellation support where possible
- Clear ownership of resources

```ts
type WorkerJobStatus =
  | "queued"
  | "running"
  | "progress"
  | "complete"
  | "failed"
  | "cancelled";
```

### Network and privacy guidelines

See §9 for the `NetworkPurpose` type and Privacy Console spec. All intentional network requests
go through a central network client (recording URL, domain, method, purpose, timestamp, status,
and whether user content was included). Cloud inference must be compile-time excluded from
production; unknown network requests should be treated as suspicious.

### Testing strategy

Testing scales with product risk. Recommended test categories:
- Unit tests for parsing/chunking helpers
- Unit tests for network classification
- Unit tests for privacy policy helpers
- Integration tests for storage persistence
- Worker contract tests
- UI tests for model download and indexing states
- Production build checks for excluded cloud code

High-priority test areas:
- Network request routing
- Local persistence
- Model manager states
- Privacy Console accuracy
- Document indexing pipeline
- Citation correctness

### Code review checklist

- Correctness
- Type safety
- Privacy boundaries
- Error handling
- Loading/progress states
- Worker usage for heavy work
- Persistence behavior
- Test coverage proportional to risk
- No accidental production cloud paths
- No unrelated refactors

For privacy-sensitive changes, reviewers should explicitly ask:
- Could user content leave the device?
- Is the network call visible?
- Is this behavior allowed in production?
- Is the user clearly informed?

### UI/UX review checklist

Every user-facing feature should be reviewed with these questions:
- Does the user understand what is happening?
- Is local/private behavior visible?
- Is progress visible for slow operations?
- Can the user cancel or recover?
- Are errors understandable?
- Does this support the writing workspace vision?
- Does this avoid unnecessary setup friction?
- Does the interface feel calm and trustworthy?

### Definition of Done

A feature is not done until:
- It meets its acceptance criteria.
- It handles loading, success, empty, and error states.
- It does not block the main thread during heavy work.
- It respects local-first privacy rules.
- It is reflected in the Privacy Console if relevant.
- It persists data where expected.
- It has appropriate tests or a documented reason tests were deferred.
- It updates docs or decisions if behavior changed.

### ADR format

Use the existing `adr/` lane for meaningful architecture decisions. Each ADR should follow
`adr/TEMPLATE.md` and include frontmatter, context, decision, alternatives considered, and
consequences.

```md
---
title: Use PGlite + pgvector for local vector storage
date: 2026-07-06
status: Proposed
---

# 2026-07-06 — Use PGlite + pgvector for local vector storage

## Context
AAFNO needs durable local storage and future hybrid search.

## Decision
Use PGlite with pgvector for local document metadata, chunks, full-text search, and vector search.

## Alternatives considered
- IndexedDB only
- In-memory vector search
- LanceDB WASM

## Consequences
More complexity early, but stronger long-term architecture.
```

### Requirements process (feature notes)

Before building a major feature, create a short requirement note in this format:

```md
# Feature: Model Manager

## User Goal

The user wants to see, download, switch, and delete local AI models.

## Must Have

- Active model status
- Download progress
- Cached/not cached state
- Storage used
- Failure and retry states

## Out of Scope

- Cloud model marketplace
- Background downloads without user awareness

## Acceptance Criteria

- User can see which model is active.
- User can start a model download.
- User can see download progress.
- User can delete a cached model.
- User can understand why a model failed to load.
```

### Risk tracking format

For this template-based workflow, track risks in the artifact where they affect the work:

- Product and project-wide risks stay summarized in §7 of this document.
- Feature-specific risks go in `specs/<date>-<slug>.md` under edge cases, non-functional
  requirements, or assumptions.
- Implementation sequencing risks go in `plans/<date>-<slug>.md` under Risk & Sequencing.
- Durable architectural risks and tradeoffs go in `adr/`.

If risk tracking grows large enough, create `docs/risk-register.md`; do not add a separate root-level risk register until the project needs it.

### Roadmap discipline

For this repository style, keep the high-level roadmap in §8 of this document and turn each
phase or major feature into a dated spec in `specs/`. Each spec should include acceptance
criteria, e.g.:

```md
## Phase 1 Acceptance Criteria

- User can upload multiple documents.
- User can ask grounded questions.
- Answers include citations.
- User can write in the editor.
- User can insert a cited answer into the editor.
- Indexed documents persist after reload.
- Privacy Console shows local and network activity.
- Model download progress is clear.
```

### Final guidance

AAFNO should move quickly, but not casually. Three areas must stay professional from the start:
- Privacy boundaries
- Local persistence
- User experience around slow and complex AI operations

If those are handled carefully, the rest of the product can grow with confidence.

---

## 11. Repository Artifact Lanes & Immediate Next Steps

### Repository artifact lanes

The repository already uses a template-based agent workflow. Keep that structure and treat
`PROJECT_ANALYSIS.md` as the canonical product and architecture reference, not as a replacement
for every workflow artifact.

Recommended roles:

```text
README.md             Project entry point for humans and agents.
AGENTS.md             Always-apply invariants for coding agents.
PROJECT_ANALYSIS.md   Canonical AAFNO product, architecture, and engineering reference.
specs/                Requirements artifacts for Tier 2 work.
plans/                Implementation plans derived from ratified specs.
adr/                  Durable architecture decisions.
justfile              Single quality-gate contract through `just check`.
```

This is a better fit for the existing template than maintaining separate root files such as
`PRODUCT_PRINCIPLES.md`, `ROADMAP.md`, `RISK_REGISTER.md`, and `DECISIONS.md` by default.
Their content should be expressed through the template lanes:

- Product principles and long-lived product constraints live in `PROJECT_ANALYSIS.md`.
- Roadmap items become dated feature specs in `specs/`.
- Implementation sequencing lives in `plans/`.
- Durable technical choices live in `adr/`.
- Risks are captured in relevant specs/plans and promoted into ADRs when they affect architecture.

If the project later needs standalone durable docs, put them under `docs/` rather than adding more
root-level files:

```text
docs/
  architecture.md
  privacy-model.md
  model-management.md
  local-storage.md
  worker-contracts.md
  testing.md
  risk-register.md
```

### Suggested immediate next steps

1. Update `README.md` so it describes AAFNO first and the agent template second.
2. Create the first Phase 0 spec in `specs/`, using the existing spec template.
3. Create the matching Phase 0 implementation plan in `plans/` after the spec is ratified.
4. Add ADRs in `adr/` for accepted architectural choices such as in-browser-only inference,
   PGlite + pgvector, Atomic Design, and the Privacy Console/network wrapper pattern.
5. ~~Clean encoding issues in `PROJECT_BRIEF.md`~~ — carried forward: verify no encoding
   artifacts were introduced/retained in this consolidated document (`PROJECT_BRIEF.md` had a
   known encoding-cleanup item pending at the time of consolidation).
6. Start Phase 0 as isolated spike code (see `spikes/` layout in §10).
7. Record measurements from the spike in the relevant spec/plan before committing to the full app
   shell.

---

## 12. Suggested Requirement Themes

For whoever writes formal specs (requirements engineer), consider requirements around these
themes:

- Local-only processing guarantee
- Production network restrictions
- Model download and caching UX
- Browser capability detection
- Persistent local workspace
- Privacy Console and activity log
- Source-grounded writing workflows
- Citation behavior
- Failure and fallback states
- Local data deletion and recovery

---

## Reconciled Divergences (summary)

The three source files describe the same product and mostly agree; the following minor
divergences were reconciled above:

- **Phase count/naming:** `PROJECT_BRIEF.md` labels Phase 3 "Mobile + acceleration";
  `AAFNO_PRODUCT_REVIEW.md` and `DEVELOPMENT_GUIDE.md` label it "Polish, Compatibility, and
  Expansion" / "Compatibility and Polish." All three cover the same scope (model tiers,
  onboarding, browser compatibility, import/export, mobile-light, WebNN/NPU investigation) —
  merged into one Phase 3 titled "Compatibility, Polish, Mobile & Acceleration" (§8).
- **Phase 0 exit artifacts:** only `DEVELOPMENT_GUIDE.md` explicitly lists Phase 0 output
  artifacts (demo, measurement notes, limitations, risk register, decision log updates);
  `PROJECT_BRIEF.md` and the product review describe the same success criteria in narrative form.
  Both are preserved in §8's Phase 0 entry.
  - **Model naming:** all sources agree on **Gemma-4-E2B** and **SmolLM2-360M**; no naming
  conflict was found between sources — flagged here only because the task description called out
  model naming as a possible divergence to check for.
- **Document structure:** `DEVELOPMENT_GUIDE.md` originally proposed a simpler shared
  `components/ui` and `components/layout` structure. This consolidated version adapts that
  guidance to the user's preferred Atomic Design methodology (`atoms`, `molecules`, `organisms`,
  `templates`, `pages`) while preserving the same intent: keep shared UI primitives separate from
  feature-owned product logic.

No information was dropped from any of the three source files. All risks, metrics, checklists,
type definitions, templates, and phase details from `PROJECT_BRIEF.md`, `AAFNO_PRODUCT_REVIEW.md`,
and `DEVELOPMENT_GUIDE.md` are represented above.
