# Phase 6 — Ella AI-scoring validation

Status: **manual benchmark step BLOCKED — needs HR-provided manual scores.**
Tooling and template below are ready; regression-side checks are done.

## Why this is blocked

Validating Ella's scoring against "the HR scoring standard" requires a set of
resumes that a human recruiter has already scored using the same rubric. Those
manual scores do not exist in the repo or the portal and must be supplied by HR.
Without them there is nothing to compare against, so only the template and the
tooling can be prepared now.

## What HR must provide

For **8–12 representative candidates** spanning the outcome range (clear reject →
borderline → strong hire), for a **single published role**:

| Field | Notes |
| --- | --- |
| Resume file | the exact PDF/DOC/DOCX that was (or will be) screened |
| Role ID | must be a published role in the portal |
| HR overall score | same scale Ella uses (confirm: 0–100 / 1–5 / band) |
| HR criteria-level scores | one score per rubric criterion (see below) |
| HR decision | Advance / Hold / Reject |
| Short rationale | 1–3 sentences per candidate — the evidence HR used |
| Scorer | who scored it, so we can check inter-rater drift later |

The rubric criteria and weights Ella uses must be confirmed by HR as the
**intended** standard before comparison — otherwise a "discrepancy" may just be a
rubric disagreement, not a model error.

## Benchmark procedure (once scores are provided)

1. Screen each benchmark resume through the normal bulk flow for that role.
2. Pull Ella's output per candidate: overall score, per-criterion score,
   extracted evidence, and the decision/recommendation.
3. Fill in `scoring-benchmark-template.csv` (one row per candidate).
4. Compute per the "Analysis" section.
5. Only change the prompt / rubric / weights where the evidence shows a
   **systematic** cause (same error class across ≥3 candidates). Never tune to
   force agreement on a single case. Human decision authority is preserved — Ella
   scores are advisory input, not the gate.

## `scoring-benchmark-template.csv`

Saved alongside this doc as
[scoring-benchmark-template.csv](scoring-benchmark-template.csv). Columns:

```
candidate_id,role_id,resume_file,
hr_overall,ella_overall,overall_delta,
hr_<criterion>,ella_<criterion>,<criterion>_delta,   (repeat per criterion)
hr_decision,ella_recommendation,decision_match,
material_discrepancy(Y/N),suspected_cause,notes
```

## Analysis to run on the completed sheet

| Metric | Definition | Threshold for concern |
| --- | --- | --- |
| Mean absolute overall delta | avg( \|hr_overall − ella_overall\| ) | > 10 pts (on 0–100) |
| Overall bias | mean( ella_overall − hr_overall ) | \|bias\| > 5 pts → systematic over/under-scoring |
| Decision agreement | % rows where decision_match = Y | < 80% |
| Criteria with largest mean delta | rank criteria by mean \|delta\| | top criterion → inspect its prompt section |
| Evidence-missing rate | % rows where Ella scored a criterion with no cited evidence | any > 0 worth a prompt note |
| Rank correlation | Spearman ρ between hr_overall and ella_overall ordering | ρ < 0.7 → weighting problem |

## Suspected-cause taxonomy (fill `suspected_cause`)

- `rubric-mismatch` — Ella applied a different standard than HR intends
- `weighting` — criteria scored ok individually, overall weighting off
- `missing-evidence` — Ella didn't extract a qualification that was in the resume
- `hallucinated-evidence` — Ella credited something not in the resume
- `format-sensitivity` — score varies with resume layout, not content
- `prompt-ambiguity` — instruction is under-specified for this case
- `none` — within tolerance

## Unblocked regression work done now

- Ella interview-summary question mapping uses the canonical numbered-question
  set (`interview-question-count.ts`, covered by the automated suite —
  "provider question counts cannot exceed the five-question maximum",
  "voice interview completion uses one canonical display label").
- Scoring-path code compiles/lints/builds clean; no scoring logic changed in
  this release.
