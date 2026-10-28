# Performance notes (v5)

## How it was measured

`tests/perf/perf.mjs` drives the production build (`next start`) in headless Chromium at 390×844
against the local stack (real PostgreSQL + RLS via the API stand-in) with **40 ms added to every
database/auth round trip** (`DELAY=40`) to model the network between the app server and Supabase.
It signs up a throwaway account, seeds two weeks of tasks, events and journal entries, then for each
route records a full document load and an in-app navigation (from /more). Single run per build,
same machine, same data shape — lab numbers, not field metrics. Real-user Core Web Vitals (LCP/INP/CLS)
were not available for this release.

## Causes found

1. **Today re-ran the whole day rollover on every load.** The page reconciled with the user's own
   database client, whose insert into `daily_scores` is (correctly) refused by RLS; the reconcile
   threw before marking the day done, so every Today load repeated ~25 queries plus a full scoring
   load. Now it runs once, after the response, with the server client (as the scheduler does).
2. **Two auth round trips before any data.** The proxy verified the session, then every page
   verified it again (`auth.getUser`). The proxy now forwards the verified user id in a header it
   controls (client copies are stripped); pages use it. RLS still checks the JWT on every query.
3. **The session/profile lookup ran twice per page.** `requireUser` was memoised by argument
   identity; the layout and page passed different option objects, so it ran twice. Now one cached
   lookup per request.
4. **Sequential query waterfalls.** Today fetched preferences → timeline → verse count → verse →
   VAPID key one after another; Progress ran six sequential rounds. Both now issue independent
   queries together (Today: one round after the session; Progress: one round plus one dependent query).
5. **Scroll cost on phones.** The fixed bottom navigation and the Coach composer used
   `backdrop-filter: blur`, recomputed every scroll frame; replaced with solid surfaces.
6. **Page entrance animation** was 280 ms from fully transparent on every navigation; now 180 ms
   from 35 % opacity, so content is visible immediately.

7. **Server and database on opposite coasts (production).** Vercel ran the app's functions in
   `iad1` (Washington, DC) while the Supabase database is in `us-west-2` (Oregon), so every query
   paid a cross-country round trip. `vercel.json` now pins functions to `pdx1` (Portland), next to
   the database.

## Results (ms, lower is better)

| Route | Full load before | after | In-app nav before | after |
|---|---|---|---|---|
| /today | 1116 | 517 | 932 | 398 |
| /word | 326 | 283 | 301 | 243 |
| /coach | 303 | 250 | 299 | 204 |
| /faith | 291 | 216 | 319 | 199 |
| /journal | 377 | 223 | 242 | 197 |
| /rhythm | 316 | 226 | 246 | 181 |
| /progress | 903 | 476 | 710 | 626 |
| /plan | 327 | 316 | 258 | 218 |
| /fitness | 545 | 222 | 519 | 482 |
| /settings | 402 | 306 | 419 | 235 |
| /food (new) | — | 474 | — | 437 |

Single-run numbers vary by roughly ±80 ms; the Today and Progress changes are well outside that.

## Production (live) measurements

Signed-in Chrome on the owner's computer, fetching each page's full HTML 3 times (median), same
account and data, minutes apart. Both columns run the v5 code; the only change is the function region.

| Route | iad1 (before) | pdx1 (after) |
|---|---|---|
| /today | 889 | 524 |
| /food | 407 | 302 |
| /word | 754 | 353 |
| /progress | 1098 | 442 |
| /fitness | 450 | 308 |
| /settings | 1029 | 443 |

The first load after a deploy (cold start) took 2.7 s to first byte; this is a one-off per new
server instance. Live numbers for the v4 code before this release weren't captured (no browser
access at the time), so the code-level gains are shown by the lab table above.

## Known remaining costs

- Each link prefetch passes through the proxy, which verifies the session with Supabase Auth
  (the project uses symmetric JWT signing, so verification is a network call). Prefetches run in the
  background and don't block navigation. Switching the project to asymmetric signing keys
  (Supabase dashboard → JWT signing keys) would let the proxy verify locally; that is an account
  security setting and was not changed.
