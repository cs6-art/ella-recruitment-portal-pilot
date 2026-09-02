# Phase 6 — Ella AI-scoring validation

Status: **Ella side prepared — awaiting HR manual scores.**
Benchmark role, resumes, Ella scores, and the specific discrepancy hypotheses
are ready ([ella-scoring-benchmark-ME02.csv](ella-scoring-benchmark-ME02.csv)).
The only remaining input is HR's manual score column.

## Benchmark role — ME02 (Mechanical Engineer)

Chosen because it now has **30 resumes screened by Ella** (2026-08-31 test run),
a full score spread (5 → 49), and clean role config.

- **Screening criteria:** "Bachelor's degree in Mechanical Engineering or
  related field, minimum 3 years of related mechanical design experience,
  proficiency in mainstream 3D CAD software, knowledge of manufacturing
  processes including injection molding, sheet metal, CNC machining; strong
  problem-solving skills and teamwork ability."
- **Minimum years of experience:** 3
- **Keywords:** mechanical design, 3D CAD, prototyping, tolerance analysis,
  DFM/DFA, product development, manufacturing processes, GD&T, cross-functional
  teamwork
- **Evaluation fields toggled:** baseline only (`score`, `recommendation`,
  `strengths`, `concerns`) — **no sub-criteria**, so HR scoring is just an
  overall 0–100 + recommendation + strengths/concerns per candidate.

## Observations from the 30-candidate Ella run (hypotheses for HR to confirm)

| # | Observation | Hypothesis |
| --- | --- | --- |
| H1 | **No candidate scored above 49**, including a 10-yr powertrain engineer with FEA (Sarah, 49) and an 8-launch product-dev manager (Emily Wong, 46). | Ella may **cap / compress the top of the range** — it deducts hard for any missing keyword (GD&T, a named CAD tool) even when the core criteria are clearly met. A human would likely score these 70–85. |
| H2 | **Every recommendation is "For HR Review"** — never "Proceed" or "Reject". | The n8n workflow may always return "For HR Review" and rely on the score alone. Confirm whether Proceed/Hold/Reject is expected (the portal's `BASELINE_EVALUATION_FIELDS` says "Proceed / hold / reject"). |
| H3 | Non-mechanical backgrounds (accountancy, psychology, software) correctly score 5–35. | Floor behaviour looks **correct** — expect HR agreement on the clear non-matches. |
| H4 | `Resume_15_Missing_Name.pdf` screened but **candidate name was not extracted** ("Professional Summary" stored as the name). | Header-parsing gap in contact extraction — cosmetic, not a scoring issue, but note it. |

## The scoring model Ella uses (from `recruitment-setup-schema.ts`)

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

## What HR must do now (the only remaining input)

Open [ella-scoring-benchmark-ME02.csv](ella-scoring-benchmark-ME02.csv). It has
**15 candidates** across the Ella score range with Ella's score / recommendation
/ key strength / key gap already filled. For each row, review the actual resume
(in the portal → Applicants → ME02) against the ME02 screening criteria above
and fill:

- `hr_score_0_100` — your overall fit score
- `hr_recommendation` — Proceed / Hold / Reject
- `hr_key_strength`, `hr_key_gap` — one line each
- `material_discrepancy_Y_N` — Y if HR and Ella differ by more than 10 points or
  disagree on advance-vs-reject
- `suspected_cause` — from the taxonomy below, when Y

Also confirm: **is the ME02 screening-criteria text the standard you actually
want Ella to apply?** If you would score differently from what that text says,
the criteria text should be fixed first (a setup issue, not a model error).

Leave the score-model / procedure sections below for reference. The generic
[scoring-benchmark-template.csv](scoring-benchmark-template.csv) is only needed
if a future role toggles sub-criteria on.

## Sample size

The CSV carries 15 candidates. HR only needs to score a representative
**8–12** of them for a valid benchmark — pick a mix across the Ella range:
~3 that look strong on the criteria, ~3–4 average/borderline, ~3 clearly weak.
Scoring all 15 is welcome but not required.

## Voice-interview scoring comparison (when applicable)

ME02 has **no completed voice interviews** for the benchmark candidates (the
2026-08-31 test resumes failed the contact-info gate before reaching the voice
stage), so this section is **prepared but not yet actionable for ME02**. Use it
for the first role that has ≥ 5 completed voice interviews.

For each completed voice interview, HR scores from the transcript and Ella's
summary side by side:

| Field | Scale | Notes |
| --- | --- | --- |
| `hr_communication_quality` / `ella_communication_quality` | 1–5 | clarity, structure, listening |
| `hr_answer_completeness` / `ella_answer_completeness` | 1–5 | did answers actually address each question |
| `hr_<role_eval_field>` / `ella_<role_eval_field>` | 1–5 | one pair per interview evaluation field configured on the role |
| `hr_voice_overall_0_100` / `ella_voice_overall_0_100` | 0–100 | overall voice score |
| `hr_voice_recommendation` / `ella_voice_recommendation` | Proceed / Hold / Reject | |
| `answer_question_mapping_ok_Y_N` | Y/N | each transcript answer shown under the correct question |
| `score_validity_ok_Y_N` | Y/N | Ella returned a score only when the call actually completed |
| `notable_mismatch`, `reviewer_notes` | free text | |

Template: `voice-scoring-benchmark-template.csv` (same shape, one row per
completed interview).

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

## Status

- **Done:** benchmark role selected (ME02), 30 resumes screened by Ella,
  15-candidate benchmark CSV pre-filled with Ella's output, 4 discrepancy
  hypotheses (H1–H4) documented for HR to confirm.
- **Blocked on HR:** the `hr_*` columns in `ella-scoring-benchmark-ME02.csv`.
- **Then (assistant):** compute the analysis table, classify each discrepancy,
  and — only if a cause repeats across ≥ 3 candidates — write up the specific
  n8n prompt/rubric change (pilot workflow only). H1 (top-of-range compression)
  is the leading candidate for a real tuning need.
- No scoring logic changed in this release; scoring path compiles/lints/builds
  clean; interview-summary question mapping covered by the automated suite.
