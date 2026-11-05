# Squiggletale 1.0.0: App Store listing

Status: passed by the lead and written to App Store Connect (store lane, 2026-11-04). Machine copy of the same text: `store/asc/listing.json` (the write script reads that file;
keep the two identical). Lengths are checked by `bun store/asc/check-listing.ts`.

## Name (set, unchanged)

Squiggletale

## Subtitle (≤ 30)

Tell a story, see it drawn

## Promotional text (≤ 170)

Your child tells a story out loud and a crayon draws it as they talk. The first story is free, and there's a free 3-minute story every Saturday.

## Description (≤ 4000)

Your child tells a story out loud, and the crayon draws what your child says. The dragon, the castle, the cookie the dragon was after: each one appears on the page as the words come. Say "The End" and the story is saved as a little book you can play back, in your child's own voice.

HOW IT WORKS
• Tap the microphone and tell a story. The crayon draws along.
• Finished stories go to My stories. Play one back, page by page, with the voice that told it.
• Make a link to send to family. The story plays in their browser, no app needed.
• No reading needed. Stories can be typed too.

FREE TO START
• The first story is free: 5 minutes of story time.
• Every Saturday there's a free 3-minute story.
• For more, a grown-up can buy a minute pack: 40, 120 or 400 minutes.
• No subscription, no ads and no account.

MADE FOR CHILDREN, SET UP BY GROWN-UPS
• Speech turns into words on the iPhone or iPad. The recording of your child's voice stays on the device unless a grown-up shares a story with voice.
• Before the first story, a grown-up agrees to send the story's words, as text, to our server, which asks an AI service what to draw. A grown-up can turn this off at any time in Grown-ups.
• Purchases, links and settings sit behind a grown-up question.
• The crayon skips anything that doesn't belong in a picture book.

Works on iPhone and iPad.

Privacy Policy: https://onceupon.dested.com/privacy
Terms of Use: https://onceupon.dested.com/terms

## Keywords (≤ 100, comma-separated, no spaces after commas)

storytelling,bedtime story,drawing,crayon,picture book,storybook,draw,imagination,tell a story,voice

## URLs

| Field | Value |
| --- | --- |
| Support URL | https://onceupon.dested.com/support |
| Marketing URL | https://onceupon.dested.com/ |
| Privacy Policy URL | https://onceupon.dested.com/privacy |

## In-app purchases (en-US)

| Product | Display name (≤ 30) | Description (≤ 45) | Price (USD tier) | Review note |
| --- | --- | --- | --- | --- |
| com.quickgame.squiggletale.pack40 (6815030317) | Story pack, 40 minutes | 40 minutes of story time, about 8 stories | $9.99 | Consumable: adds 40 minutes of story time to this device; shown on the paywall in Grown-ups → Buy minutes |
| com.quickgame.squiggletale.pack120 (6815031238) | Big pack, 120 minutes | 120 minutes of story time, about 24 stories | $19.99 | Consumable: adds 120 minutes of story time to this device; shown on the paywall in Grown-ups → Buy minutes |
| com.quickgame.squiggletale.pack400 (6815032143) | Family pack, 400 minutes | 400 minutes of story time for the family | $39.99 | Consumable: adds 400 minutes of story time to this device; shown on the paywall in Grown-ups → Buy minutes |

Other territories: Apple's equalization from the USA base price. Availability: the same 165 territories as the
app (`store/asc/territories.json`), new territories off. Family Sharing: off (consumables can't use it).

## Version and app info

| Field | Value |
| --- | --- |
| Version string | 1.0.0 (was 1.0) |
| Copyright | 2026 QuickGame World Inc. |
| Release | Automatically after approval (`AFTER_APPROVAL`, already set) |
| Primary category | EDUCATION (see "Kids Category" below) |
| Secondary category | ENTERTAINMENT |
| Kids Category | Made for Kids, age band 6–8 (`kidsAgeBand` SIX_TO_EIGHT on the age rating declaration) |
| Content rights | Does not use third-party content |
| Price | Free |
| Availability | 165 territories (`store/asc/territories.json`): Store Brand Puzzles' 175 minus China mainland (ICP + generative-AI licence) and the regions Anthropic doesn't serve: HKG, MAC, AFG, BLR, MMR, RUS, VEN, XKS, YEM. New territories: off on the IAPs; the app's switch is still on (no API for it: App Store Connect → Pricing and Availability) |

### Kids Category

App Store Connect has no `KIDS` app category (the API's iOS categories list it nowhere). An app joins the
Kids Category by answering Made for Kids with an age band in the age rating declaration; the primary and
secondary categories stay ordinary ones. So: primary EDUCATION, secondary ENTERTAINMENT, `kidsAgeBand`
SIX_TO_EIGHT. Lead OK, 2026-11-04.

## Age rating declaration (answers)

| Question (API field) | Answer | Why |
| --- | --- | --- |
| Made for Kids (`kidsAgeBand`) | SIX_TO_EIGHT | Lead call, phase 4 |
| Cartoon or fantasy violence (`violenceCartoonOrFantasy`) | NONE | The app's own art and intro have none; the prompt turns fights into pillow fights and explosions into a poof |
| Realistic violence (`violenceRealistic`) | NONE | |
| Prolonged, graphic or sadistic realistic violence (`violenceRealisticProlongedGraphicOrSadistic`) | NONE | |
| Guns or other weapons (`gunsOrOtherWeapons`) | NONE | Real weapons are a skip |
| Profanity or crude humor (`profanityOrCrudeHumor`) | NONE | Rude words masked; potty humor is a skip |
| Mature or suggestive themes (`matureOrSuggestiveThemes`) | NONE | |
| Horror or fear themes (`horrorOrFearThemes`) | NONE | Monsters are drawn goofy |
| Sexual content or nudity (`sexualContentOrNudity`) | NONE | Skip |
| Graphic sexual content and nudity (`sexualContentGraphicAndNudity`) | NONE | |
| Alcohol, tobacco or drug use or references (`alcoholTobaccoOrDrugUseOrReferences`) | NONE | Skip |
| Medical or treatment information (`medicalOrTreatmentInformation`) | NONE | |
| Health or wellness topics (`healthOrWellnessTopics`) | false | |
| Simulated gambling (`gamblingSimulated`) | NONE | |
| Gambling (`gambling`) | false | |
| Contests (`contests`) | NONE | |
| Loot boxes (`lootBox`) | false | Packs are fixed minutes |
| Unrestricted web access (`unrestrictedWebAccess`) | false | Links out only behind the grown-up question, to our own pages |
| Messaging and chat (`messagingAndChat`) | false | |
| User-generated content (`userGeneratedContent`) | false | Nobody sees another person's stories in the app; a grown-up's share link opens on the website |
| Social media (`socialMedia`) | false | |
| Social media age restricted (`socialMediaAgeRestricted`) | false | |
| Advertising (`advertising`) | false | No ads, no ad SDK, no AdServices token in 1.0 |
| Parental controls (`parentalControls`) | true | Grown-ups (behind the grown-up question): "Drawing with AI" on/off, share-with-voice consent, purchases |
| Age assurance (`ageAssurance`) | false | No age check; the grown-up question is a gate, not age verification |
| Age rating override (`ageRatingOverride`, `ageRatingOverrideV2`) | NONE | |

Expected result: 4+.

## App Review contact

Copied server-side from Store Brand Puzzles' review detail (first name, last name, email, phone). Demo account:
not required. Notes and the demo attachment: after the lead's `notes ready`.
