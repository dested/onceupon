/**
 * The default test set. Subjects are the bare word a child would type (Sal's "horse"); actions are
 * two-thing phrases. `expect` tells the judge what a recognizable crayon drawing must have: physical,
 * checkable, from a 4-year-old's picture-book point of view. Seeded into lab/cases.json on first
 * load; edit the file (or the Cases tab) after that.
 */
import type { LabCase } from './types'

const s = (id: string, category: string, expect: string[], phrase = id): LabCase => ({
  id,
  phrase,
  tier: 'subject',
  category,
  expect,
})
const a = (id: string, phrase: string, category: string, expect: string[]): LabCase => ({
  id,
  phrase,
  tier: 'action',
  category,
  expect,
})

export const DEFAULT_CASES: LabCase[] = [
  // animals, four legs
  s('horse', 'animal-4legs', [
    'long body with four legs reaching the ground',
    'head on a neck at the front, longer than it is tall (a snout)',
    'two small pointed ears on top of the head',
    'mane along the neck and a tail hanging from the rear end',
  ]),
  s('cat', 'animal-4legs', [
    'round head with two pointed triangle ears on top',
    'body with four legs and a long curved tail from the rear',
    'whiskers on the face',
  ]),
  s('dog', 'animal-4legs', [
    'body with four legs on the ground',
    'head with floppy ears hanging at the sides of the head',
    'tail from the rear, snout at the front',
  ]),
  s('elephant', 'animal-4legs', [
    'big round gray body with thick legs',
    'a long trunk hanging from the front of the head',
    'two huge ears on the sides of the head',
  ]),
  s('giraffe', 'animal-4legs', [
    'very long neck rising from the body to a small head high up',
    'four long legs, yellow with brown spots',
    'two small horns on the head',
  ]),
  s('pig', 'animal-4legs', [
    'pink round body with short legs',
    'a round snout with two nostrils at the front of the head',
    'a curly tail at the rear',
  ]),
  s('cow', 'animal-4legs', [
    'white body with black patches, four legs',
    'head with two small horns and ears',
    'a pink udder under the belly',
  ]),
  s('bear', 'animal-4legs', [
    'big round brown body and round head',
    'two small round ears on top of the head',
    'four thick legs or sitting with legs in front',
  ]),
  // animals, other
  s('bunny', 'animal-small', [
    'round body and head',
    'two tall ears standing up from the top of the head',
    'a little round tail at the back or big feet at the bottom',
  ]),
  s('chicken', 'animal-bird', [
    'round body with a small head, a pointed beak',
    'a red comb on top of the head and a red wattle under the beak',
    'two thin legs with feet on the ground',
  ]),
  s('bird', 'animal-bird', [
    'small oval body with a round head and a pointed beak',
    'a wing on the body and a tail at the back',
    'either two thin legs on a perch/ground or wings spread in the air',
  ]),
  s('owl', 'animal-bird', [
    'upright oval body with two big round eyes on the front',
    'two ear tufts on top of the head, a small beak between the eyes',
    'sitting on a branch or the ground',
  ]),
  s('fish', 'animal-water', [
    'oval body with a triangle tail at the back',
    'an eye near the front and a fin on top',
    'in water (blue area or bubbles), not standing on grass',
  ]),
  s('frog', 'animal-small', [
    'green round body, wide mouth',
    'two bulging eyes on top of the head',
    'bent legs at the sides, sitting low',
  ]),
  s('turtle', 'animal-small', [
    'a domed shell on top with a pattern',
    'a small head sticking out the front and four short legs under the shell',
  ]),
  s('snake', 'animal-small', [
    'one long wavy body along the ground, no legs',
    'a head at one end with an eye and a forked tongue',
  ]),
  s('monkey', 'animal-other', [
    'brown body with long arms and legs',
    'round face with big round ears at the sides',
    'a long curling tail',
  ]),
  s('lion', 'animal-4legs', [
    'four-legged cat-like body, yellow-tan',
    'a big round shaggy mane all around the face',
    'a tail with a tuft at the end',
  ]),
  // people
  s('girl', 'person', [
    'round head with hair (longer, or pigtails/bow)',
    'body or dress, two arms, two legs with feet on the ground',
    'a face with two eyes and a smile, head on top of the body',
  ]),
  s('boy', 'person', [
    'round head with short hair',
    'shirt and pants, two arms, two legs on the ground',
    'a face; head sits on top of the body, not floating',
  ]),
  s('grandpa', 'person', [
    'a person with white or gray hair and/or a beard',
    'glasses or a cane or a hat that says old',
    'arms, legs, head on the body',
  ]),
  s('princess', 'person', [
    'a person in a big triangle dress',
    'a crown or tiara on top of the head',
    'long hair, a smiling face',
  ]),
  s('pirate', 'person', [
    'a person with a hat (pirate hat or bandana)',
    'an eye patch or a hook or a sword',
    'striped shirt or a beard',
  ]),
  s('astronaut', 'person', [
    'a person in a bulky white suit',
    'a round helmet around the head',
    'a backpack or standing on the moon / near a rocket',
  ]),
  // fantasy
  s('dragon', 'fantasy', [
    'big body with a long tail and a head with a snout',
    'wings on the back',
    'spikes, horns or fire from the mouth; green or red',
  ]),
  s('unicorn', 'fantasy', [
    'a horse body with four legs, mane and tail',
    'one single horn on the forehead, pointing up and forward',
    'white or pastel; rainbow mane is a bonus',
  ]),
  s('monster', 'fantasy', [
    'a big goofy body in a bright color',
    'horns or spikes, big eyes (one or several), a big toothy mouth',
    'friendly, not scary',
  ]),
  s('robot', 'fantasy', [
    'boxy body and boxy head, gray or metallic',
    'an antenna on top of the head, square eyes',
    'jointed arms and legs',
  ]),
  s('ghost', 'fantasy', [
    'a white sheet shape rounded on top with a wavy bottom edge',
    'two dark eyes and maybe an O mouth',
    'floating above the ground',
  ]),
  // vehicles
  s('car', 'vehicle', [
    'a body with a raised cabin and windows',
    'two round wheels touching the ground under the body',
  ]),
  s('truck', 'vehicle', [
    'a cab at the front with a window and a big box or flat bed behind it',
    'wheels under both parts, on the ground',
  ]),
  s('train', 'vehicle', [
    'an engine with a chimney and at least one car behind it',
    'several wheels along the bottom, on a track or the ground',
    'smoke from the chimney',
  ]),
  s('boat', 'vehicle', [
    'a hull (wide at the top, narrower at the bottom) sitting on water',
    'a mast with a sail, or a cabin',
    'water drawn under it, not grass',
  ]),
  s('airplane', 'vehicle', [
    'a long body with a pointed nose',
    'wings sticking out from the sides and a tail fin at the back',
    'in the sky, not standing on the ground',
  ]),
  s('rocket', 'vehicle', [
    'a tall body with a pointed nose cone',
    'fins at the bottom and fire or smoke coming out the bottom',
    'pointing up',
  ]),
  // places and nature
  s('house', 'place', [
    'a wall with a triangle roof on top',
    'a door reaching the ground and at least one window',
    'a chimney is a bonus',
  ]),
  s('castle', 'place', [
    'a wide wall with towers at the sides that rise above it',
    'pointed roofs or battlements on the towers, a gate, a flag',
  ]),
  s('tree', 'nature', [
    'a brown trunk standing on the ground',
    'a big round green crown on top of the trunk',
  ]),
  s('flower', 'nature', [
    'a stem from the ground with a leaf',
    'petals in a ring around a round center at the top of the stem',
  ]),
  s('mountain', 'nature', [
    'one or more big triangles rising from the ground',
    'snow on the peaks or a sun/cloud nearby',
  ]),
  s('rainbow', 'nature', [
    'an arch of several colored bands, red outside',
    'both ends reaching down toward the ground',
  ]),
  // props and food
  s('ice-cream', 'food', ['a triangle cone pointing down', 'one or more round scoops on top of the cone'], 'ice cream'),
  s('cake', 'food', [
    'a wide layered cake with frosting',
    'candles with flames on top',
  ]),
  s('apple', 'food', ['a round red fruit', 'a short stem on top with a leaf', 'sitting on the ground or a table']),
  s('balloon', 'prop', ['a round or oval bright shape', 'a string hanging down from it', 'up in the air']),
  s('umbrella', 'prop', [
    'a dome or half circle on top',
    'a straight handle down from the center with a hook at the bottom',
  ]),

  // actions: two things and a relation
  a('horse-eats-apple', 'a horse eating an apple', 'action', [
    'a recognizable horse',
    'an apple at the horse head/mouth height and touching or right next to the mouth',
  ]),
  a('dog-jumps-fence', 'a dog jumping over a fence', 'action', [
    'a fence standing on the ground',
    'a dog in the air above the fence, not standing on the ground',
  ]),
  a('girl-flies-kite', 'a girl flying a kite', 'action', [
    'a girl standing on the ground',
    'a kite (diamond with a tail) high in the sky',
    'a string from the girl hand to the kite',
  ]),
  a('cat-sleeps-bed', 'a cat sleeping on a bed', 'action', [
    'a bed with a pillow and blanket',
    'a cat lying on top of the bed, eyes closed',
  ]),
  a('boy-rides-bike', 'a boy riding a bicycle', 'action', [
    'a bicycle with two wheels on the ground',
    'a boy sitting on it with hands on the handlebar',
  ]),
  a('dragon-fire-castle', 'a dragon breathing fire at a castle', 'action', [
    'a dragon facing a castle',
    'fire coming from the dragon mouth toward the castle',
  ]),
  a('bunny-hides-tree', 'a bunny hiding behind a tree', 'action', [
    'a tree in front',
    'a bunny partly hidden by the trunk, ears or half body showing',
  ]),
  a('bird-nest-tree', 'a bird sitting in a nest on a tree', 'action', [
    'a tree',
    'a nest (bowl) on a branch or in the crown',
    'a bird inside the nest',
  ]),
  a('fish-swims-pond', 'a fish swimming in a pond', 'action', [
    'a pond (blue oval on the ground)',
    'the fish inside the water, not above it',
  ]),
  a('monkey-hangs-tree', 'a monkey hanging from a tree', 'action', [
    'a tree with a branch',
    'a monkey holding the branch with hands or tail, body below the branch',
  ]),
  a('princess-balloon', 'a princess holding a balloon', 'action', [
    'a princess',
    'a balloon above her with a string down to her hand',
  ]),
  a('bear-in-boat', 'a bear sitting in a boat', 'action', [
    'a boat on water',
    'a bear inside the boat, lower body hidden by the hull',
  ]),
  a('snowman-hat-house', 'a snowman wearing a hat next to a house', 'action', [
    'a snowman of stacked circles with a hat on the top circle',
    'a house beside it, both on the ground',
  ]),
  a('pig-in-mud', 'a pig rolling in the mud', 'action', [
    'a brown mud puddle on the ground',
    'a pig lying in or on the mud, maybe upside down',
  ]),
  a('elephant-sprays-water', 'an elephant spraying water from its trunk', 'action', [
    'an elephant with a trunk',
    'water (blue drops or a spray) coming from the trunk tip',
  ]),
]
