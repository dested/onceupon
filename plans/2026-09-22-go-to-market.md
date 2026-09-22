# Once Upon go-to-market

- **Date:** 2026-09-22
- **Status:** active
- **Type:** plan
- **What:** pricing decision, offer structure, App Store listing, Apple Ads plan with copy, organic loops, and the launch sequence to get Once Upon on the App Store as fast as possible. Numbers come from `plans/2026-09-22-pricing-model.html` (measured preset) and the Sep 22 debug session.

## The money, measured

A minute of mic-open story time costs ~3.4¢ to serve (Sonnet 5 on the ops dialect ~2.6¢, Deepgram ~0.8¢). Cost is not what sets the price; willingness to pay and acquisition cost are.

| Offer | Price | Net after 15% | Cost to serve in full | Margin | Charged per minute |
| --- | --- | --- | --- | --- | --- |
| Story pack, 40 min | $9.99 | $8.49 | $1.34 | $7.15 | 25¢ |
| Big pack, 120 min | $19.99 | $16.99 | $4.02 | $12.97 | 17¢ |
| Family pack, 400 min | $39.99 | $33.99 | $13.40 | $20.59 | 10¢ |

Every pack keeps at least 60% margin even if every minute gets used, and unused minutes are owed, not spent. The free tier at 60 s/week is a rounding error (~$4/mo at 1,000 daily free users).

## Pricing decision: packs only

No subscription (Sal, 2026-09-22). Minutes are the product, bought outright, never expiring, no renewals to cancel, nothing to explain to a grandparent. The economics support it: a minute costs ~3.4¢ and sells for 10 to 25¢.

1. **Free: the first story is free.** About 2 minutes of mic time, one time (Sal: "maybe two minutes", a server-side constant to tweak). Cost ~7¢. This is the trial: a kid who has heard their dragon come to life is the sales pitch. If the child says "The End" first, the finale plays and the share card follows as normal. If the minutes run out mid-story, the crayon "gets sleepy", plays The End for them, and the closing card becomes the paywall: "want more minutes?" with the 120 pack highlighted. That screen, with a kid saying "one more!", is the conversion. After that, **60 free seconds a week**, refilled on a fixed weekday ("Saturday story"), enough to remind the parent the app is there and too little to live on.
2. **Story pack, 40 minutes, $9.99.** The default buy. About eight stories.
3. **Big pack, 120 minutes, $19.99.** The "we're going to use this" buy, positioned as the value pick on the paywall (per-minute price shown: 17¢ vs 25¢).
4. **Family pack, 400 minutes, $39.99.** The gift SKU and the road-trip SKU; 10¢ a minute. Restore Purchases keeps a balance across reinstalls (the ledger lives on the server, keyed to the device account, credited only from validated receipts or redeemed codes).
5. **Gifting is a web product (decided 2026-09-22).** Apple has no IAP gifting, so gift codes are sold on onceupon.app with Stripe: grandma buys 40, 120 or 400 minutes, gets a code and a printable card, texts it; the parent redeems it in the app's parent area behind the parental gate (or on the website, signed in to the same device account via a link). Apple's multiplatform rule (3.1.3(b)) allows redeeming consumables bought elsewhere as long as the same packs are sold in-app, which they are. A web sale nets ~97% of price instead of 85%.
6. **Web checkout for packs, US storefront.** Since the 2025 Epic ruling, US apps may link out to external purchase without commission; the paywall's "buy on the web" link sits behind the parental gate and goes to the same Stripe shop. IAP stays the default button; the web link is the cheaper path for parents who take it.
7. **The rebuy screen.** Zero balance looks like the finale card, not an error: "the crayon needs more minutes", the pack bought last time pre-selected, Restore Purchases and "redeem a gift" underneath. Packs per buyer is the number that makes ads work; this screen is where it is earned.

No taster pack: the free story is the taster, and a $2.99 SKU trains people to buy small.

**What packs-only means for the funnel.** With no renewals, revenue per install is purchase rate × pack mix, once, plus repeat buys. At Apple Ads medians (US cost per tap ~$1.90, conversion ~60%, so ~$3.20 an install), a 5% first-purchase rate at an $11 average pack returns ~$0.47 net per install: ads lose 7x on the first buy. Three levers, in order of size:

- **Repeat purchase.** A child who finishes 40 minutes of stories buys again; the paywall at zero balance is the highest-converting screen in the app. Target 40% of buyers buying twice within 60 days; that lifts revenue per buyer from $9 to ~$15.
- **Pack mix.** Make the 120-minute pack the visual default on the paywall. Every buyer who picks it instead of the 40 doubles revenue per install.
- **The share loop.** Grandma's link and the MP4 watermark bring installs that cost nothing. A k-factor of 0.3 from shares cuts effective cost per install by a third.

Even with all three, paid acquisition at median costs pays back only on the best keywords. **Run Apple Ads as a seed at a hard cost-per-install cap ($2.50), harvest the keywords that convert, and let sharing carry growth.** Price higher, not lower: a $4.99 pack would need twice the buyers for the same result.

## Positioning

**Tell a story. Watch it draw.** The iPad listens and a crayon draws the child's own words as they say them. No tapping, no menus, no videos to watch; talking is the whole game. For parents: creative screen time that is the kid's imagination out loud, with a picture book at the end to send to grandma.

One line for everything: *Your kid talks. The crayon draws. Grandma cries.*

Audience in order: parents of 3 to 7 year olds on iPad (buyer and gatekeeper), grandparents (the share-link audience and the gift buyer), preschool and kindergarten teachers (later, a classroom mode).

## App Store listing (this is the ad; Apple Ads render from it)

- **Name (30):** `Once Upon: Tell It, Watch It` or `Once Upon – Story Crayon`. The first tests better on the promise; the second on the mechanic.
- **Subtitle (30):** `Say a story. Watch it draw.`
- **Promotional text (170):** `Your child tells a story out loud and a crayon draws it as they talk. Say "The End" and share the picture book with grandma. First story free, then buy minutes, no subscription.`
- **Keywords (100):** `story,stories,bedtime,kids,drawing,crayon,storytelling,imagination,creative,toddler,preschool,talk,book`
- **Category:** Kids (age band 5 and under; test 6 to 8), secondary Education. Made for Kids on.
- **Screenshots, in order** (iPad 13", landscape, each a real story frame with a short hand-lettered caption): (1) a dragon half drawn with the caption words along the bottom, "Tell your story out loud"; (2) the same page finished, "Watch the crayon draw it"; (3) a page turn with the filmstrip, "Every idea is a new page"; (4) The End finale, "Say The End"; (5) the share card and an iMessage bubble with the link, "Send it to grandma"; (6) the bookshelf, "Every story saved".
- **App preview (30 s):** the first 3 seconds must show a child's voice line appearing as words and the crayon starting to draw. Cut from a real replay (the export pipeline makes this). No narrator; the kid's words are the audio (a family member's child, with consent, or a recorded adult playing a kid).
- **Description opening:** `Once Upon listens while your child tells a story and draws it on the screen with a crayon, as they talk. A dragon, a castle, a rocket to the moon: whatever they say, it appears. When they say "The End", the story is saved as a picture book you can replay, download as a video, or send to family with a link.`
- **Review notes:** explain the safety layers (the drawing model refuses unsuitable ideas, the word masker, moderation on in production, no audio stored, no accounts, no third-party analytics), the parental gate before purchases and the mic prompt, and that the AI generates drawings only from the child's own words.

## Apple Ads plan

Apple Ads Advanced, cost per tap, no minimum spend. Search results campaigns are the core; Search tab and product-page placements are cheap add-ons; skip the Today tab until there is a brand.

**Campaign structure (US only to start):**

| Campaign | Match | Budget share | Purpose |
| --- | --- | --- | --- |
| Brand | exact: `once upon`, `once upon app`, `once upon story` | 10% | Defend the name cheaply |
| Generic, high intent | exact: `story maker for kids`, `kids storytelling app`, `make your own story`, `story creator kids`, `bedtime story app`, `bedtime stories for kids`, `drawing app for kids`, `kids drawing app`, `talking story app`, `interactive stories kids`, `story app for toddlers`, `imagination app` | 45% | The buyers |
| Competitor | exact: `pok pok`, `sago mini`, `toca boca`, `epic kids books`, `lingokids`, `khan kids`, `storybook`, `pinkfong` | 20% | Parents already paying for kids apps |
| Discovery | Search Match on, broad match of the generic terms | 25% | Harvest new terms weekly into exact; add negatives |

- **Budget:** $50 a day for the first two weeks, then scale by keyword, not by campaign. Rule: a keyword under $2.50 per install with a first-purchase rate over 5% gets a 20% bid raise per day; a keyword over $6 per install after 100 taps is paused.
- **Bids:** start at 80% of Apple's suggested bid; CPA goal $3.
- **Custom Product Pages (four, one per intent):** *Bedtime* (screenshots re-ordered around the finale and the bookshelf, promo text "A new bedtime story every night, told by them"); *Creativity* (drawing first, "No tapping. Just imagination out loud"); *Grandparents* (share card first, "Send the story to grandma"); *Competitor* ("Their words, their picture. Not another video"). Point each campaign at its page; the Discovery campaign uses the default page.
- **Search tab campaign:** one, low bid, default page; it is awareness at pennies.
- **Attribution without a third party:** the Expo app calls Apple's AdServices attribution token API on first launch and posts the token to the server, which resolves it with Apple's attribution endpoint. This keeps the Kids-category rule (no third-party analytics SDK) and still tells you which keyword brought each buyer.
- **Benchmarks to beat** (Apple Ads 2026 medians): tap-through 9%, conversion 60%, US cost per tap ~$1.90. Targets: tap-through over 8%, conversion over 50%, install to first story over 70%, first story to first purchase over 5%, repeat purchase over 40% within 60 days, share rate over 25% of finished stories.

## Copy

Apple Ads have no headline field; the ad is the product page. So the copy that matters is above (name, subtitle, promo text, captions) and here:

**Custom product page promo text variants (170 chars each):**
- Bedtime: `Tonight's story is theirs. Your child tells it, the crayon draws it, and it's saved as a picture book for tomorrow. First story free.`
- Creativity: `No tapping, no menus. Your child talks and a crayon draws every idea as they say it. Creative screen time that is actually their imagination.`
- Grandparents: `Your child tells a story, the crayon draws it, you send the link. Grandma watches it come to life. First story free.`
- Competitor: `Not another video to watch. Your child makes the story out loud and a crayon draws it live. Say "The End" and share it.`

**Share page (the organic ad):** headline `Ellie made this story` (the first name only if the parent typed one; otherwise `A story by a 5-year-old`), the replay, then `Made with Once Upon. Your kid's turn: get it on the App Store.` Video download button. Nothing else.

**MP4 end card (2 s):** `Made with Once Upon` in the crayon hand, the app icon, `onceupon.app`.

**Reels / TikTok, 15 s, three scripts** (parent-filmed, phone pointed at the iPad, kid's voice audible):
1. Kid says "the dragon ate a giant ice cream", the crayon draws it, parent laughs off camera. Caption: `she said it, it drew it`.
2. Screen recording only: words appearing, crayon drawing, "The End", the share card. Caption: `send this to grandma`.
3. A grandparent watching the share link on a phone, reacting. Caption: `the best text I got all week`.

**Launch post (Product Hunt, Reddit r/Parenting and r/iPad, Facebook parent groups), 60 words:** `I built an iPad app that listens while my kid tells a story and draws it with a crayon as she talks. Dragon, castle, rocket to the moon, whatever she says. When she says "The End" it becomes a little picture book we send to her grandma. First story is free; I'd love to know what your kid makes.`

## Organic loops (what actually scales)

1. **The share link is the growth engine.** Every finished story ends on the share card. The share page converts grandma and the other parents in the family thread. Track share rate and install rate from share pages as the top KPIs; a k-factor of 0.3 from shares halves the effective cost per install.
2. **The MP4 export** puts the watermark in feeds where links die (Instagram, TikTok, WhatsApp status).
3. **ASO** as above; iterate the name and subtitle every two weeks with the keyword data from Discovery.
4. **Apple featuring.** Submit the featuring nomination in App Store Connect the day the app is approved; Made for Kids with a genuinely new mechanic is what the Kids editors look for. Give them the preview video and three stories.
5. **Press and reviewers:** Common Sense Media (request a review), kids-tech newsletters, a few parenting influencers with a free year. One angle, not five: "the first app where the kid is the author".
6. **Teachers:** free classroom use on request; a preschool that projects a story on the wall makes twenty parents install it that night.

## Launch sequence (immediately means four weeks to a live listing)

| Week | Ship | Notes |
| --- | --- | --- |
| 1 | Server (keys, Sonnet relay, STT token minting, ledger, free grants, gift-code redeem), IAP with RevenueCat or own validation (three consumables), Stripe shop + gift codes on the website, The End finale, sleepy-crayon paywall and rebuy screen, share upload and page, parental gate, the Expo shell with the WebView, mic spike on a real iPad | The sal-starter repo; the website skeleton (landing, shop, gift, privacy, terms, support, share pages) ships with it because the listing needs the URLs |
| 2 | Tutorial replay, MP4 export (device side first), settings and parent area (balance, buy, redeem a gift, restore), production build with debug and moderation toggle stripped, TestFlight to 10 families | Record the App Store preview from real TestFlight stories; measure first-purchase rate and rebuy on the TestFlight families before touching ads |
| 3 | App Store Connect: listing, screenshots, preview, Kids questionnaire, privacy labels, Small Business Program enrollment, submit | Kids-category review runs longer; expect one rejection round on the parental gate or the AI disclosure; answer in review notes up front |
| 4 | Approved: Apple Ads on at $50 a day, featuring nomination, launch post, share-loop instrumentation live | Two weeks of data before touching bids or pack prices |

Server-side MP4 rendering, teachers, and non-US markets come after the first month of data.

## KPIs (one dashboard, read weekly)

Installs by source, cost per install, install to first story, first story to first purchase (target 10%), pack mix, packs per buyer within 60 days (target 1.5), gift codes sold and redeemed, web checkout share, minutes used per buyer (the COGS driver), COGS per paying user, share rate per finished story (target 25%), installs from share pages, refund rate.

## Risks

- **Kids review and the AI angle.** Apple reads "AI" in a Kids app carefully. The review notes must say what the model can and cannot do, what data leaves the device, and how content is kept suitable. Moderation off does not ship.
- **Parental gate friction on the paywall.** Required, and it costs conversion. Put the gate on the purchase button, not on the paywall screen. With packs there is no trial to explain, which keeps the paywall to one screen: three packs, the 120 highlighted, Restore Purchases.
- **Kid-speech accuracy** decides retention more than anything above; the Deepgram versus OpenAI A/B on real children happens before launch, not after.
- **Cost tail.** Packs bound the spend by construction (a minute is paid before it is served); the only caps needed are per-device daily limits on the free grant and abuse protection on the ledger.
- **COPPA.** No audio stored server-side, no accounts, the share upload is masked text only and parent-initiated. Written into the privacy policy in plain words.

## Decisions from the viability review (2026-09-22, evening)

Sal: "I love the road trip idea and the gifting has to be fully supported. Maybe two minutes up front. I'm not locked into anything." Reviewed the numbers and decided:

- **This is an organic and viral business with a small paid seed, not a paid-acquisition machine.** Serving clears 60% margin at full use; the only weak number is buying installs at the App Store median (~$3.20) against ~$0.47 per install from a 5% first-purchase rate. Nearly every surviving kids app looks like this.
- **Two product numbers decide everything and both are tested in TestFlight before any ad spend:** first-purchase rate (the sleepy-crayon paywall at the end of the free story) and packs per buyer (the rebuy screen). Targets: 10% first purchase, 1.5 packs per buyer with a 40/120 mix, which makes an install worth ~$2.10 and most of the keyword plan pay back. At 5% and 1 pack, only brand and exact high-intent keywords are bought.
- **Gifting via web gift codes and US web checkout** (pricing decision items 5 and 6) are in scope for launch, not later.
- **Apple featuring is the single biggest free lever:** nominate on approval day with the preview video and three real stories.
- **Every story is an ad:** share-page installs are instrumented from day one and share rate is a top-three KPI.
- **Apple Ads is a seed:** brand terms and a dozen exact high-intent terms at a hard $2.50 cost per install; no Discovery budget until the first-purchase rate is known; scale only keywords whose measured revenue per install beats their cost.
- **Road trip = the 400 pack plus offline replay.** Live drawing needs the network (model and ears), so the car needs a hotspot; every saved story and its finale replay offline. Do not promise offline storytelling.
- **Later, in this order:** Android on the same Expo shell (doubles the market), preschools and libraries on site licences, a browser version of the story screen sold through Stripe with no store cut.
