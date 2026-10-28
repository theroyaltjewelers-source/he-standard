# Scoring policy 2026.10-1

Implementation: `src/lib/scoring/index.ts` (pure, deterministic, no AI). Tests: `src/lib/__tests__/scoring.test.ts`.
Claude can read scores through the `get_scores` tool to explain them; no tool can write or change a score.

## Principles

| Rule | How it is enforced |
|---|---|
| Unknown ≠ failure | Open/unanswered items are counted in `unknown` and excluded from the denominator. |
| Late ≠ not done | Completion after the (original) deadline earns 50 % credit. |
| Rescheduling never erases | Commitments keep `original_promised_by`, tasks keep `original_due_at` / `original_scheduled_for`, activity occurrences keep their original start and are marked `rescheduled`. Lateness is measured against the original. |
| Insufficient data | A metric needs ≥ 3 eligible events; a domain needs at least one sufficient metric; no overall score below 50 % weight coverage. Excluded domains are listed with the reason. |
| Days before the account existed | Never counted (`since`). Future days are never counted. |
| Spiritual practice | Never part of any score. |
| Worth | Scores measure recorded behaviour — not worth, intelligence, psychological health or religious standing. |

## Domains and metrics

Domain score = Σ numerators / Σ denominators of its sufficient metrics × 100. Overall = weight-normalised mean of scored domains.

| Domain (weight) | Metric | Numerator | Denominator (eligible) | Exclusions | Evidence source |
|---|---|---|---|---|---|
| Reliability (25 %) | Commitments kept on time | kept = 1, kept late = 0.5 | commitments in period with a recorded outcome | released (excused); open = unknown | `commitments` |
| | Appointments, calls, deadlines kept | completed = 1, late = 0.5 | past occurrences with an outcome | rescheduled, excused; awaiting = unknown | `activity_occurrences` |
| | Tasks completed | done = 1, done after deadline = 0.5 | tasks marked done / not done | cancelled; open past = unknown | `tasks` |
| Discipline & attention (20 %) | Focus sessions completed | completed sessions | ended sessions | running sessions | `focus_sessions` |
| | Urges resisted | resisted = 1, partly = 0.5 | urges with an outcome | no outcome / unsure = unknown | `impulse_logs` |
| | Habit consistency | completions (capped) | prorated weekly target − rest days | fitness, learning and spiritual habits | `habits`, `habit_logs` |
| Fitness (15 %) | Scheduled workouts completed | completed = 1, late = 0.5 | past workout occurrences with an outcome | rescheduled, excused; awaiting = unknown | `activity_occurrences` |
| | Training frequency | logged workouts (capped) | weekly target × weeks | only when a target is set | `workout_logs` |
| | Fitness habits | completions (capped) | prorated target | — | `habits` |
| Planning & execution (15 %) | Days planned | days with a completed morning plan | finished days (today once planned) | future days | `accountability_sessions` |
| | Tasks done on the day planned | done without postponement | tasks done or not done | — | `tasks` |
| Self-awareness (10 %) | Evening reviews | days reviewed | finished days | — | `accountability_sessions` |
| | Weeks with written reflection | weeks with ≥ 1 entry | complete weeks (current week once written) | — | `journal_entries` |
| Communication (10 %) | Promises to others kept on time | as commitments | commitments made to another person | as commitments | `commitments` |
| | Honest-communication reflection answered | answered | evening reviews that asked | measures examination, not honesty | `accountability_answers` |
| Learning & reasoning (5 %) | Learning habits | completions (capped) | prorated target | — | `habits` (area = learning) |

Evidence mix is reported per metric: confirmed (evidence/system), self-reported, imported, unverified.

## Trends

Each trend point is the score of the trailing window ending that day (7 days for ≤ 30-day periods, 30 days otherwise), sampled daily, weekly, fortnightly or monthly depending on the period. A window without enough evidence is a gap — never interpolated.

## Changing the policy

Add a new policy object (e.g. `POLICY_V2`) with a new `version`; never edit a released one. Reports show the version they were computed with.
