# Phase 6 — Ella AI-scoring validation

Status: **manual benchmark BLOCKED — needs HR-provided scores.** Tooling, the
exact scoring model, and the comparison procedure are ready.

## The scoring model Ella actually uses (from `recruitment-setup-schema.ts`)

Every role scores these **baseline** fields (`BASELINE_EVALUATION_FIELDS`):

| Field | Meaning |
| --- | --- |
| `score` | overall numeric fit, normalised to **0–100%** on display (`score-format.ts`) |
| `recommendation` | **Proceed / Hold / Reject** |
| `strengths` | free text |
| `concerns` | free text |

Plus **per-role toggled** criteria (`EVALUATION_FIELD_CATALOG`, HR turns on the
ones that matter for that role) — each is a sub-assessment:

`communication_quality`, `culture_fit`, `leadership_potential`,
`customer_service_orientation`, `technical_depth`, `problem_solving`,
`attention_to_detail`, `reliability` — **plus up to 3 custom fields** HR defines.

The scoring inputs come from the role's Recruitment Setup: `screeningCriteria`,
`keywordsToLookFor`, `minimumYearsOfExperience`, `licenseOrCertificateRequired`,
`transferableSkillsAccepted`, the job description, and `aiSystemPrompt` /
`resolvedAiSystemPrompt`. **The actual scoring/prompt execution runs in n8n**,
not the portal — so any rubric tuning is an n8n workflow change (pilot workflow
only), and the portal side only stores the setup and displays the result.

## Exactly what HR must provide

Pick **one published role** and **8–12 candidates** spanning the outcome range
(2–3 clear Reject, 3–4 borderline/Hold, 3–4 clear Proceed). For each:

1. The exact resume file (PDF/DOC/DOCX).
2. HR **overall score 0–100** using the same standard the role's screening
   criteria describe.
3. HR **recommendation**: Proceed / Hold / Reject.
4. HR **strengths** and **concerns** (1–3 bullets each — the evidence used).
5. For **each criterion toggled on for that role**, an HR sub-score on the same
   0–5 (or 0–100 — state which) scale, plus a one-line reason.
6. Which criteria are toggled on for the role (so we compare like-for-like).
7. Confirmation that the role's `screeningCriteria` text **is** the intended
   standard (if HR would score differently than the written criteria, fix the
   criteria first — that is a setup bug, not a model error).

Fill one row per candidate in
[scoring-benchmark-template.csv](scoring-benchmark-template.csv) (blank the
criterion columns that are not toggled on for the role).

## Procedure once scores arrive

1. Screen all benchmark resumes through the normal bulk flow for that role.
2. Record Ella's `score`, `recommendation`, `strengths`, `concerns`, and each
   criterion sub-score into the CSV next to the HR values.
3. Run the analysis below.
4. Tune **only** where a cause repeats across ≥3 candidates. Never tune to force
   a single case to agree. Ella's score is advisory — the human recommendation
   is the gate.

## Analysis

| Metric | Definition | Concern threshold |
| --- | --- | --- |
| Mean absolute score delta | avg \|hr_score − ella_score\| | > 10 (of 100) |
| Score bias | mean(ella_score − hr_score) | \|bias\| > 5 → systematic over/under-scoring |
| Recommendation agreement | % rows recommendation_match = Y | < 80% |
| Adjacent vs opposite mismatch | Hold↔Proceed (adjacent) vs Reject↔Proceed (opposite) | any opposite mismatch = investigate that resume |
| Worst criterion | criterion with largest mean \|delta\| | inspect that criterion's prompt/rubric section in n8n |
| Missing-evidence rate | % criteria Ella scored with no cited evidence | any > 0 → prompt note |
| Hallucinated-evidence count | Ella cited a qualification not in the resume | any > 0 → P1 prompt fix |
| Rank correlation | Spearman ρ of hr_score vs ella_score ordering | ρ < 0.7 → weighting problem |

## Suspected-cause taxonomy (`suspected_cause` column)

`rubric-mismatch`, `weighting`, `missing-evidence`, `hallucinated-evidence`,
`format-sensitivity`, `prompt-ambiguity`, `none`.

## Unblocked now

- Scoring path code compiles/lints/builds clean; **no scoring logic changed** in
  this release.
- Interview-summary question mapping (a related QC blocker) is covered by the
  automated suite (canonical numbered-question guard).
- Template + procedure ready; nothing else can proceed until HR scores land.
