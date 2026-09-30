/*
 * All the written content in one place. An unofficial fan tribute: facts follow the comics and the films,
 * told in our own words (no quotations, no official artwork).
 */

export const PROFILE = [
  ['Name', 'Anthony Edward Stark'],
  ['First appearance', 'Tales of Suspense #39 (1963)'],
  ['Created by', 'Stan Lee, Larry Lieber, Don Heck, Jack Kirby'],
  ['Occupation', 'Inventor, industrialist, Avenger'],
];

/** The suit's systems, for the workshop's exploded view. `part` names a group of suit joints to highlight. */
export const SYSTEMS = [
  { key: 'helmet', part: ['head', 'neck'], name: 'Helmet & HUD', code: 'SYS-01', text: 'The helmet carries the heads-up display that the pilot sees: targeting, flight data and an onboard AI that reads the world back to him. The faceplate hinges up at the brow.', specs: [['Display', 'Full-field HUD'], ['Assistant', 'Onboard AI'], ['Faceplate', 'Hinged, sealed']] },
  { key: 'reactor', part: ['spine'], name: 'Arc Reactor', code: 'SYS-02', text: 'A palm-sized reactor in the chest powers everything. The first one, built from scrap in a cave, also kept shrapnel away from his heart. Later versions ran on an element he synthesized himself.', specs: [['Output', 'Gigawatt class'], ['Core', 'Synthesized element'], ['Mount', 'Sternum housing']] },
  { key: 'repulsors', part: ['wristL', 'wristR', 'elbowL', 'elbowR'], name: 'Repulsors', code: 'SYS-03', text: 'The palms fire repulsor blasts: focused beams of energy used as weapons and, pointed down, as stabilisers in flight. A light touch steers; a full blast punches through steel.', specs: [['Location', 'Palms'], ['Modes', 'Blast · stabilise'], ['Charge', 'From the reactor']] },
  { key: 'boots', part: ['ankleL', 'ankleR', 'kneeL', 'kneeR'], name: 'Boot Jets', code: 'SYS-04', text: 'Thrusters in the soles of the boots provide the main lift. Balanced by the palms and the flaps on the back, they let the suit hover, climb and fly faster than sound.', specs: [['Thrust', 'Main lift'], ['Top speed', 'Supersonic'], ['Control', 'Palms + flaps']] },
  { key: 'torso', part: ['hips'], name: 'Armor Shell', code: 'SYS-05', text: 'Overlapping plates of a gold-titanium alloy move with the body. The first grey suit iced up at altitude; switching alloys solved it and gave the suits their famous colours.', specs: [['Alloy', 'Gold-titanium'], ['Plates', 'Overlapping, articulated'], ['Seals', 'Pressurised']] },
  { key: 'shoulders', part: ['shoulderL', 'shoulderR'], name: 'Weapons Bays', code: 'SYS-06', text: 'Later suits hide micro-missiles and lasers in the shoulders and forearms, deployed on demand. The chest beam, fired straight from the reactor, is the most powerful weapon of all.', specs: [['Micro-missiles', 'Shoulders'], ['Chest beam', 'From the reactor'], ['Lasers', 'Forearms']] },
];

/**
 * The Hall of Armor: the real exhibits. `scheme` is the model key (see objects/RealSuit.js MODELS);
 * `display` is how it stands: 'suit' (a glass pod), 'big' (a taller, wider pod) or 'plinth' (a case at head height).
 */
export const ARMORS = [
  { scheme: 'mk1', display: 'suit', name: 'Mark I', year: 'Cave-built · 2008', text: 'Beaten out of scrap iron and missile parts by a prisoner with a toolbox and a deadline. Slow, crude and nearly bulletproof, it had one job: walk out of that cave. It did.', stats: [['Power', 35], ['Armor', 70], ['Speed', 15], ['Tech', 20]] },
  { scheme: 'reactor', display: 'plinth', name: 'Arc Reactor', year: 'The heart of it all', text: 'A palm-sized power source in the chest. The first one was built from scavenged parts to keep shrapnel from his heart; every suit since has drawn its power from one.', stats: [['Power', 92], ['Armor', 10], ['Speed', 0], ['Tech', 90]] },
  { scheme: 'classic', display: 'suit', name: 'Classic Armor', year: 'Marks III – VII', text: 'The red-and-gold design the world came to know. A new alloy cured the icing of the silver prototype; each Mark after it added speed, weapons and a smarter way to put it on.', stats: [['Power', 82], ['Armor', 74], ['Speed', 84], ['Tech', 80]] },
  { scheme: 'mk5', display: 'suit', name: 'Mark V', year: 'Suitcase armor · 2010', text: 'Folded into a briefcase and opened around its wearer in seconds: a lighter, thinner emergency suit carried for the day there is no time to reach the workshop.', stats: [['Power', 70], ['Armor', 55], ['Speed', 76], ['Tech', 84]] },
  { scheme: 'helmetA', display: 'plinth', name: 'Classic Helmet', year: 'Heads-up display', text: 'Where the pilot actually lives: a sealed shell carrying the heads-up display, the air supply and J.A.R.V.I.S., the onboard AI that talks him through every flight.', stats: [['Power', 40], ['Armor', 70], ['Speed', 50], ['Tech', 95]] },
  { scheme: 'heavy', display: 'big', name: 'Heavy Armor', year: 'Hulkbuster · 3.2 m', text: 'A walking fortress built to be worn over a regular suit, for the day brute strength had to be met head-on. Spare limbs could be dropped in from orbit mid-fight.', stats: [['Power', 98], ['Armor', 99], ['Speed', 30], ['Tech', 82]] },
  { scheme: 'helmetB', display: 'plinth', name: 'Battle-worn Helmet', year: 'Kept, not repaired', text: 'Scorched, scratched and dented: a helmet that came home from a fight it barely survived. He kept it as it was, as a reminder of what the suits are for.', stats: [['Power', 30], ['Armor', 55], ['Speed', 40], ['Tech', 85]] },
  { scheme: 'mk42', display: 'suit', name: 'Mark XLII', year: 'Autonomous prehensile · 2013', text: 'Gold and red, and built in pieces that fly to their wearer on their own, one at a time, from wherever they are. Clever, fragile and a little temperamental.', stats: [['Power', 80], ['Armor', 60], ['Speed', 86], ['Tech', 92]] },
  { scheme: 'nano', display: 'suit', name: 'Nano Suit', year: 'Mark 50 · Nanotech', text: 'Stored as nanites in a housing on the chest and grown over the body in seconds. Plates reshape into shields, blades or thrusters on demand: the most advanced armor he ever made.', stats: [['Power', 96], ['Armor', 90], ['Speed', 92], ['Tech', 100]] },
  { scheme: 'mk85', display: 'suit', name: 'Mark 85', year: 'The last suit', text: 'The final armor: nanotech refined with heavier, rounder plates in the classic red and gold, and a gauntlet strong enough to carry the power of the stones for one moment. It was the suit he wore at the end.', stats: [['Power', 99], ['Armor', 94], ['Speed', 92], ['Tech', 100]] },
  { scheme: 'spider', display: 'suit', name: 'Protégé Suit', year: 'For a hero from Queens', text: 'Not armor at all, but a high-tech suit he designed for a young hero he took under his wing: sensors, a training mode and far more features than its wearer first discovered.', stats: [['Power', 45], ['Armor', 40], ['Speed', 88], ['Tech', 90]] },
];

/** The timeline, in-universe (film continuity). */
export const TIMELINE = [
  { year: '1970', age: 0, title: 'Born', jp: 'ORIGIN', text: 'Born to industrialist and inventor Howard Stark and Maria Stark. Machines are his first language.' },
  { year: '1985', age: 15, title: 'MIT', jp: 'EDUCATION', text: 'Enters the Massachusetts Institute of Technology as a teenager and graduates near the top of his class.' },
  { year: '1991', age: 21, title: 'Loss', jp: 'LEGACY', text: 'His parents die in a car crash. Soon after, he takes over Stark Industries, then the world\'s leading weapons maker.' },
  { year: '2008', age: 38, title: 'The Cave', jp: 'MARK I', text: 'Captured after a weapons demonstration, he is ordered to build a missile. Instead, with a fellow captive, he builds a reactor and a suit — and escapes.' },
  { year: '2008', age: 38, title: 'A New Direction', jp: 'MARK III', text: 'Home again, he ends his company\'s weapons business, perfects the suit in his workshop and tells the world who is inside it.' },
  { year: '2010', age: 40, title: 'The New Element', jp: 'MARK VI', text: 'The reactor that keeps him alive is poisoning him. Using a design hidden in his father\'s notes, he synthesizes a new element to power it.' },
  { year: '2012', age: 42, title: 'The Avengers', jp: 'MARK VII', text: 'Joins a team of heroes to defend New York from an invasion, and flies a missile through a portal in space to end it.' },
  { year: '2013', age: 43, title: 'Rebuilding', jp: 'MARK XLII', text: 'Haunted by that battle, he builds suit after suit. When his home is destroyed he rebuilds from nothing, and finally has the shrapnel removed.' },
  { year: '2015', age: 45, title: 'A Mistake', jp: 'ULTRON', text: 'An artificial intelligence meant to protect the world turns against it. The team stops it, at a cost.' },
  { year: '2016', age: 46, title: 'Divided', jp: 'ACCORDS', text: 'Supports putting the heroes under oversight, which splits the team. He also mentors a young hero from Queens.' },
  { year: '2018', age: 48, title: 'Titan', jp: 'MARK L', text: 'Fights a warlord across the galaxy in his nanotech suit, and loses.' },
  { year: '2023', age: 53, title: 'The Last Stand', jp: 'MARK LXXXV', text: 'Five years on, he helps undo the loss. In the final battle he takes the power stones into his own gauntlet and gives his life to save everyone else.' },
];

export const QUIZ = [
  { q: 'In which comic book did Iron Man first appear?', options: ['Tales of Suspense #39', 'Amazing Fantasy #15', 'Journey into Mystery #83', 'The Avengers #1'], a: 0, explain: 'Tales of Suspense #39, cover-dated March 1963.' },
  { q: 'What powers the suit?', options: ['A lithium battery', 'An arc reactor', 'Solar panels', 'A fusion cell in the boots'], a: 1, explain: 'A compact arc reactor in the chest powers the armor (and, at first, kept shrapnel from his heart).' },
  { q: 'What problem did the first silver flight suit run into?', options: ['It overheated', 'It iced up at altitude', 'It was too heavy to fly', 'The helmet leaked'], a: 1, explain: 'The prototype froze up at high altitude; a gold-titanium alloy fixed it.' },
  { q: 'Where is the main lift of the suit produced?', options: ['The back', 'The shoulders', 'The boots', 'The helmet'], a: 2, explain: 'Thrusters in the boots give the main lift; palm repulsors and back flaps stabilise.' },
  { q: 'What did he build the very first suit from?', options: ['Scrap and missile parts', 'Titanium from his lab', 'A car chassis', 'Recycled armor plates'], a: 0, explain: 'The Mark I was hammered together from scrap and missile components in a cave.' },
  { q: 'What shape was the Mark VI\'s reactor?', options: ['Circle', 'Square', 'Triangle', 'Hexagon'], a: 2, explain: 'The new-element reactor in the Mark VI is triangular.' },
  { q: 'What was the old reactor core doing to him before the new element?', options: ['Draining his memory', 'Poisoning his blood', 'Freezing his heart', 'Nothing at all'], a: 1, explain: 'The old core was poisoning him; the synthesized element solved it.' },
  { q: 'What are the palm weapons called?', options: ['Blasters', 'Pulsars', 'Repulsors', 'Photon cannons'], a: 2, explain: 'Repulsors: beams of energy from the palms, also used to stabilise flight.' },
  { q: 'Which suit folds into a briefcase?', options: ['Mark II', 'Mark V', 'Mark VII', 'Mark I'], a: 1, explain: 'The Mark V is the portable "suitcase" armor.' },
  { q: 'What was his company\'s original main business?', options: ['Cars', 'Weapons', 'Phones', 'Space travel'], a: 1, explain: 'Stark Industries was a weapons maker — until he shut that business down.' },
  { q: 'The most advanced suit stores itself as…', options: ['A wristwatch', 'Nanites in the reactor housing', 'A backpack', 'A satellite'], a: 1, explain: 'The nanotech suit flows out of the housing on his chest.' },
  { q: 'Which city did he defend with the team during an alien invasion?', options: ['London', 'Tokyo', 'New York', 'Los Angeles'], a: 2, explain: 'The battle of New York, where he flew a missile through the portal.' },
];
