// v5 = v4 + Fable's patch from rounds r003/r004 (agent mode). Run: node lab/agent/v005-patch.mjs
// Every find must occur exactly once; the script fails loudly otherwise.
import fs from 'node:fs'

const src = fs.readFileSync('lab/prompts/v004.md', 'utf8')
const edits = [
  // A. Lone subject applies to ANY single thing; scale from the recipe height, with the top check.
  {
    find: 'A LONE SUBJECT (one food, toy, animal or vehicle that is the whole picture) is the star: 280-350 tall, so add scale=3 to recipes under 120 tall, scale=2 under 180, scale=1.5 to the rest.',
    replace:
      'A LONE SUBJECT (one thing that is the whole picture: an animal, a person or creature, a vehicle, a plant, food, a toy, a building) is the star: 280-350 tall. scale = 300 divided by the recipe height, rounded to 1, 1.5, 2 or 3 (a 110 flower gets 3, a 170 animal 2, a 230 person or robot 1.5, a 300 tree 1); if 525 minus scale times the tallest point would pass above y=60, take the next smaller scale. Things that fly or float (plane, ghost, balloon, bird in the air) get ent y=330 instead of the ground.',
  },
  // K. Pirate hat sits on the head, not over the eyes.
  {
    find: 'pirate black hat twice the head\'s width with upturned ends, wide red-white stripes, patch with a strap line after face;',
    replace:
      'pirate black hat twice the head\'s width with upturned ends, its bottom edge at the head\'s top y so the eyes stay clear, wide red-white stripes, patch with a strap line after face;',
  },
  // D. Mane as a thick fringe line, not a slab (read as a saddle on the unicorn).
  {
    find: 'mane black <c2> poly 85 -220 30 -100 12 -112 70 -232;',
    replace: 'mane <c2> w=14 M 85 -228 Q 62 -170 34 -108 (a thick fringe line down the neck\'s back, never a filled slab);',
  },
  // E+F. Frog and ghost recipes (both failed twice: head merged into body; tiny faint sheet). Airplane side view.
  {
    find: '- fish: body orange orange oval 0 0 60 35; tail orange orange poly -60 0 -100 -30 -100 30; face body right.',
    replace:
      '- fish: body orange orange oval 0 0 60 35; tail orange orange poly -60 0 -100 -30 -100 30; face body right.\n- frog 180 tall: legs darkgreen green mirror oval 60 -22 42 22; body darkgreen green oval 0 -75 72 52; head darkgreen green oval 0 -150 62 40 (a separate head above the body); eye bumps darkgreen green mirror circle 32 -184 16; face head front happy.\n- ghost 240 tall (ent 600 330 idle=float): sheet gray white M -80 0 L -50 -30 L -20 0 L 10 -30 L 40 0 L 80 -20 L 80 -160 Q 80 -240 0 -240 Q -80 -240 -80 -160 Z; face sheet front surprised.\n- airplane 170 tall, side view (ent 600 330 idle=float): body black white oval 0 0 150 40; nose black white poly 150 -22 205 0 150 22; tail black red poly -140 -12 -200 -95 -130 -95 -105 -12; wing black red poly -10 -12 -70 -110 40 -110 70 -12 (after the body, a broad fan above it); wing2 black red poly -10 12 -60 80 30 80 60 12; windows black skyblue circle -70 -8 11 and circle -30 -8 11 and circle 10 -8 11.',
  },
  // G. Restore the short recipes v4 dropped (real stories use them) as one compact bullet.
  {
    find: '- bee (idle=float):',
    replace:
      '- star: gold yellow stamp star 0 -50 50. heart: red red stamp heart 0 -50 50. sun (ent sun 1050 120 layer=-3): gold yellow stamp sun 0 0 60. ball: red red circle 0 -45 45, stripe white M -35 -60 Q 0 -30 35 -60. table: top brown tan rect -130 -125 260 25, legs brown brown mirror rect 105 -100 24 100.\n- bee (idle=float):',
  },
  {
    find: '- hides: move behind a tree or house (same x), say shh.\n',
    replace:
      '- hides: move behind a tree or house (same x), say shh.\n- birthday: cake, fx sparkles over it, say happy birthday. It broke: fx burst small, then rm it or redraw it as two halves.\n',
  },
]

let text = src
for (const e of edits) {
  const n = text.split(e.find).length - 1
  if (n !== 1) throw new Error(`find occurs ${n} times: ${e.find.slice(0, 60)}`)
  text = text.replace(e.find, e.replace)
}
// H. Collapse the blank lines v4's deletions left inside the cookbook and beats (keep section breaks).
text = text.replace(/\n{3,}/g, '\n\n').replace(/(\n- [^\n]*)\n\n(?=- )/g, '$1\n')

fs.writeFileSync('lab/agent/v005.md', text)
fs.writeFileSync(
  'lab/agent/v005-rationale.txt',
  [
    'Agent-mode rounds r003 (v3, 70.9) and r004 (v4) agree on what is left:',
    '1. too-small is the top remaining kind. v4 scoped the lone-subject rule to food/toy/animal/vehicle, so people, creatures, plants and buildings drawn alone (pirate, ghost, robot, monster, boy, girl, grandpa, princess, flower, cat on a bed) sat small in an empty page. v5 makes the rule cover any single thing and replaces the height buckets with scale = 300 / recipe height plus the top check; flying things get y=330.',
    '2. Frog failed twice (head merged into the body) and ghost twice (tiny, faint): both had no recipe. v5 adds short recipes with a separate head / a floating sheet with a wavy hem.',
    '3. Airplane failed in both rounds (hollow box wings; front view clipped off the page). v5 adds a side-view recipe with fan wings drawn after the body.',
    '4. The horse/unicorn mane slab read as a saddle; v5 draws it as a thick fringe line.',
    '5. Pirate hat covered the eyes; the hat now sits on the head top.',
    '6. v4 dropped star, heart, sun stamp, ball, table and the birthday beat to fit the cap; none are in the test set but real stories use them. v5 restores them in two compact lines and removes the blank lines the deletions left.',
  ].join('\n')
)
console.log('v005 draft written:', text.length, 'chars (v4 was', src.length + ')')
