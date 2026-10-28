# App Review audit: Squiggletale 1.0

Status: active · 2026-10-27 · fix at the next submit, through the app-review skill

App Store Connect on 2026-10-27: 1.0 is at Prepare for Submission, with no build attached yet.

## At the next submit

- [ ] App Store Connect is mostly empty: no Privacy Policy URL, no Support URL, no review notes and no
  age rating. The 3 IAPs (pack40, pack120, pack400) are Missing Metadata.
- [ ] There are no privacy, terms or support pages in the repo. Put static pages on the app's domain.
- [ ] Create the packet with `--init apps/mobile` and set `bundleId: com.quickgame.squiggletale`.
  Write the notes and record a demo.
- [ ] The web side can call `requestReview` through `src/bridge/handlers/system.ts`. Check what
  triggers it: never in the first session, only after a success moment.
- [ ] This copy has no `node_modules`, so purpose strings, iPad and export compliance weren't
  checked. Rerun after `bun install`.
- [ ] If it's made for kids, set `kids: true` in review.json, and the Kids rules apply (parental gate,
  no third-party analytics).

## Checked and fine

- No unfinished strings. Restore Purchases is in `src/bridge/handlers/iap.ts`. The app links privacy.

Rerun: `bun ~/.claude/skills/app-review/preflight.ts --app apps/mobile --bundle com.quickgame.squiggletale`
