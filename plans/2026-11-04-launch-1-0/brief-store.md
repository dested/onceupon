# Brief: store (opus-high), App Store Connect ready for submission

**Goal.** Everything in App Store Connect that Squiggletale 1.0.0 needs before the lead presses Submit, written through the API, plus the exact App Privacy answers Sal clicks by hand (the API has no endpoint for them). Sal: "submit the app to the app store".

**Tools.** `ssh mini 'zsh -lic "signing api qg <METHOD> <path> [--data <json>]"'` (team key, App Store Connect API). Docs: https://developer.apple.com/documentation/appstoreconnectapi (WebFetch). Read `/w/code/mac-mini/cliffnotes.md` (signing section) and the `app-review` skill (`~/.claude/skills/app-review/SKILL.md`, `rejections.md`) first.

**Ids.** App 6815029998. Version 1.0 (`ab409615-45cd-4e93-91f4-08b26038746b`, PREPARE_FOR_SUBMISSION). IAPs: pack40 6815030317, pack120 6815031238, pack400 6815032143 (all MISSING_METADATA).

**Owns.** `store/listing.md`, `store/privacy-labels.md`, `store/asc/**` (scripts and payload JSON), `store/review/review.json`. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (store)" <paths>`. The lead owns `store/review/notes.md`; the release lane owns screenshots and `demo.mp4`.

**Steps.**
1. Draft `store/listing.md`: subtitle (≤ 30), promotional text (≤ 170), description (≤ 4000), keywords (≤ 100, comma-separated, no spaces after commas), IAP display names (≤ 30) and descriptions (≤ 45). Rules: plain and true, no adjectives stacked; never "Claude", "Anthropic", "Haiku", "Sonnet" or "AI-powered" hype (say "the crayon draws what your child says"); name the free first story (5 minutes), the 3-minute free story every Saturday, and the minute packs; on-device speech (the child's voice stays on the device unless a grown-up shares a story); grown-up gate before purchases and links; no ads, no account. Report `ready store listing`, then **wait for `pass listing` from the lead before writing any copy to App Store Connect**.
2. After `pass listing`, write:
   - Version: `versionString` "1.0" → "1.0.0"; copyright "2026 QuickGame World Inc."; release type after approval: automatic.
   - Version localization en-US: description, keywords, promotional text, support URL `https://onceupon.dested.com/support`, marketing URL `https://onceupon.dested.com/`.
   - App info: subtitle; privacy policy URL `https://onceupon.dested.com/privacy`; primary category KIDS with age band 6–8 (`kidsAgeBand` SIX_TO_EIGHT on the age rating declaration), secondary category EDUCATION; content rights "does not use third-party content".
   - Age rating declaration: answer every question honestly from `/w/code/onceupon-f/cliffnotes.md`, the privacy page and the app (no violence, no web access, no chat, no user-to-user content; purchases yes; made for kids). List your answers in `store/listing.md`.
   - Pricing: free. Availability: the same territories as Store Brand Puzzles (app 6819053321); read them, don't guess.
   - IAPs: en-US localization (name + description from the listing), price to match `packages/shared/src/packs.ts` (pack40 $9.99, pack120 $19.99, pack400 $39.99 USD, other territories by Apple's equalization), availability like the app, a one-line review note each ("Consumable: adds N minutes of story time to this device; shown on the paywall in Grown-ups → Buy minutes"), and the review screenshot `store/screenshots/iap-paywall.png` once the release lane has it.
   - App Review details: contact first/last name, email and phone copied from Store Brand Puzzles' review detail (read them server-side and write them; never print the phone), demo account not required. Notes and the demo attachment wait for the lead's `notes ready`.
   - Screenshots: upload the release lane's `store/screenshots/iphone-6.9/*` and `ipad-13/*` in file order to the matching display types when they exist.
3. Draft `store/privacy-labels.md`: the exact App Privacy answers (each data type: collected?, linked to the user?, used for tracking?, purposes), derived from what the code really sends (`apps/web/server/**`, `packages/shared/src/api.ts`, the privacy page at `apps/web/src/app/privacy.tsx`), written as a click list Sal follows in App Store Connect. No tracking anywhere. Note anything the privacy page says that the labels must match.
4. Run `bun ~/.claude/skills/app-review/preflight.ts` from the repo root and report what is still FAIL.

**Done when.** Every ASC field above is set, preflight's ASC checks pass except notes/demo/build (lead and release), and the labels file exists.

**Don't.** Create a review submission, submit, release, attach a build (the lead does), touch any other app's data, change prices outside these three IAPs, print a key or the phone number.

**Report** (≤ 10 lines): `ready store <step> <result>`, what is set, what is left, absolute paths.

## Standing answers
- (2026-11-04, lead) Notes ready: paste store/review/notes.md (fc67c70) verbatim into appStoreReviewDetail.notes. Upload the demo attachment only after `demo ready`. Applies to: store.
- (2026-11-04, lead) `pass listing` (store/listing.md as drafted). Categories OK: primary EDUCATION, secondary ENTERTAINMENT, kidsAgeBand SIX_TO_EIGHT. EAS Update is off from 8912f86 (build 2); no Expo line needed on the privacy page or labels. Applies to: store.
- (2026-11-04, lead) Territories: drop China mainland for 1.0 (ICP filing, plus China's generative-AI rules: Apple pulls AI apps without a licence). Then cross-check the rest against Anthropic's supported regions (https://www.anthropic.com/supported-countries, WebFetch) and drop any territory not on it, since every story is drawn by that API. Apply the same list to the three IAPs. Report the final count and every territory dropped. Applies to: store.
