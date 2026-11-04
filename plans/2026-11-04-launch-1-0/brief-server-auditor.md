# server-auditor: opus-high · phase 1 (read-only audit)

Re-read this file and the Standing answers in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** A ranked, evidence-backed finding list for the server, money and data side of Squiggletale 1.0 (`/w/code/onceupon-f/apps/web/`, `/w/code/onceupon-f/packages/shared/src/`, the studio's `src/backend/`), judged against a Kids Category App Store launch, plus a cost-exposure model Sal can trust. Sal: "I'm a little afraid on the cost." Every finding must be concrete enough to brief a fix from.

**Read first.** /w/code/onceupon-f/cliffnotes.md, /w/code/onceupon-f/decisions.md, /w/code/onceupon-f/features/launch-platform.md, /w/code/onceupon-f/plans/2026-09-22-go-to-market.md, /w/code/onceupon-f/plans/2026-09-22-launch-build.md, /w/code/onceupon-f/apps/web/cliffnotes.md if it exists, /w/code/drydock/onboarding.md (custom domains section).

**Decisions already made (audit against them).**
- Kids Category: no PII or device info to third parties beyond what's needed to run the service; a privacy policy that covers children's data (COPPA); a parent consent before story words go to Anthropic. On-device ears only, so the server should not mint cloud ears tokens for the 1.0 app.
- Domain moves to squiggletale.com; onceupon.dested.com must keep redirecting (share links, Apple notification URL, Stripe webhooks).
- Pricing is being re-evaluated by the lead; you supply the cost facts, not the price.

**Audit areas (cover every one; say "nothing found" where true).**
1. **Ledger and metering:** free first story (120 s) and weekly top-up, beats, typed charges, exhausted handling, comped devices, stale-session closing. Can a device get free minutes it shouldn't (reinstall: is `installId` kept in the keychain across delete/reinstall? clock tricks, parallel sessions, replayed requests)? Can a paying parent lose minutes they paid for?
2. **Cost exposure:** per-device daily caps, relay cost caps, kill switches, alerts, and what they are set to. Build a worst-case table: 1,000 / 10,000 free installs per day, a scripted abuser, a runaway client loop. Which limit stops each, at what $ per day. Name the gaps.
3. **The relay:** model and thinking setting in production (`apps/web/server/flags.ts`, `relay.ts`, `anthropic-thinking.ts`), max_tokens, prompt caching (are cache reads happening for the kit prompt? is the prefix over the model's minimum?), timeouts, retries, what is logged (does child text land in logs or the DB, and for how long?).
4. **Purchases:** StoreKit 2 JWS verification: does a production build accept sandbox transactions (App Review buys in the sandbox; refusing them is a classic rejection)? Dedup, refunds via App Store Server Notifications, restore. Stripe and gift codes: correct, and unreachable from inside the app.
5. **Privacy and data:** every table with child-originated data (story text, names, voice files, shares), retention and deletion jobs, delete-my-data, what the admin can see, what goes to Anthropic (and Anthropic's API data retention for this account type), what the privacy policy page actually says vs the code.
6. **Website pages Apple needs:** fetch https://onceupon.dested.com/privacy, /terms, /support (and any delete-data page) with plain `curl` (no JavaScript). Are they readable static HTML, or an empty SPA shell? Does the content name the third parties, children's data, retention and contact? Draft the gaps.
7. **Security:** admin auth and the allow-list, device token HMAC, CORS, rate limits, secrets handling (names only; never print a value), the single-file build never inlining keys (`grep -c 'sk-' dist-hosted/index.html` after `bun run build:hosted` at the repo root).
8. **Domain move:** every hardcoded `onceupon.dested.com` / `BRAND.origin` dependency (server, studio, shell, Apple notification URL, Stripe webhook, OG tags, share links), and the Drydock steps for adding squiggletale.com (from /w/code/drydock/onboarding.md). List them as an ordered checklist.
9. **Ops:** Drydock config, DB backups, health checks, error alerting, what happens when Anthropic is down or slow (does the child see a stuck crayon?).
10. **Cost facts for pricing:** from the code, the bench write-ups (/w/code/onceupon-f/plans/2026-09-28-dsl-rethink.md, /w/code/onceupon-f/plans/2026-09-22-pricing-model.html), and the server's own pricing tables: tokens per beat (input, cache read, cache write, output) on the kit dialect, beats per minute of talking, and the per-minute model cost at the production model. State each number's source. Do not look up list prices on the web; the lead does that.

**Output.** /w/junk/onceupon-f/audit-server.md. Findings grouped by area, each with: id (V-01...), severity (`review-blocker` | `1.0-must` | `polish` | `1.1`), file:line (absolute), what is wrong, evidence, and the concrete fix in one or two sentences. Then the worst-case cost table, the domain-move checklist, and "Top 10 for 1.0". Under ~400 lines.

**Owns.** /w/junk/onceupon-f/audit-server.md. Read-only everywhere else. A local `bun run build:hosted` (gitignored output) is fine. You may run the server's unit tests if any exist.

**Don't.** Edit repo files, commit, push or deploy. Connect to the production database or any remote machine (no ssh, no SSM). Call production admin endpoints that change state. Print secret values.

**Report** (≤ 10 lines): count by severity, the 5 worst with ids, the worst-case $/day with today's limits, the report path, and what you could not check.
