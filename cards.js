/* Scenario card deck for the Chronicle of Bohemia companion.
 *
 * Reward discipline from the first playtest: everyday cash is modest, social and
 * crime cards lean on fines and Glory rather than payouts, and quest leads pay
 * in clues rather than money. Edit freely: the app reads this list on load.
 *
 * Effects (all optional, applied to the player who draws the card):
 *   cash:  [min, max]  Groschen gained (positive) or lost (negative), rolled in range
 *   glory: { amount, category }  category is "quest", "tournament" or "achievement"
 *   clue:  "title"     adds a shared clue found by the drawer (+1 Glory for discovery)
 * Clue cards leave the deck once drawn, so each clue can only be found once.
 */
window.SCENARIO_CARDS = [
  // Road and everyday: small gains and losses
  { id: "unwanted-armour", kind: "road", title: "Unwanted Armour", text: "You strip a dented cuirass from a fallen bandit and sell it to the armourer in Rattay.", cash: [20, 40] },
  { id: "herb-gathering", kind: "road", title: "Herb Gathering", text: "Nettle, sage and belladonna by the river. The apothecary pays a fair price.", cash: [10, 20] },
  { id: "lost-purse", kind: "road", title: "A Lost Purse", text: "A purse lies in the mud by the crossroads. Nobody comes looking for it.", cash: [15, 30] },
  { id: "merchant-escort", kind: "road", title: "Merchant's Escort", text: "A nervous cloth merchant pays you to ride beside his cart to Sasau.", cash: [20, 35] },
  { id: "broken-wheel", kind: "road", title: "Broken Wheel", text: "Your cart cracks a wheel in a rut. The wheelwright knows you have no choice.", cash: [-25, -10] },
  { id: "toll-bridge", kind: "road", title: "Toll Bridge", text: "The lord's men stand on the bridge with their hands out.", cash: [-15, -5] },
  { id: "rainstorm", kind: "road", title: "Rainstorm", text: "Soaked to the bone, you pay for a dry bed and a hot meal at the inn.", cash: [-20, -10] },
  { id: "thrown-shoe", kind: "road", title: "Thrown Shoe", text: "Your horse throws a shoe. The smith takes his time and your coin.", cash: [-20, -10] },
  { id: "tavern-dice", kind: "road", title: "Dice at the Tavern", text: "A friendly game of dice with the miller's sons. Fortune decides.", cash: [-25, 25] },
  { id: "quiet-day", kind: "road", title: "A Quiet Day", text: "You sleep under an oak and wake to birdsong. Nothing happens, and that is a blessing." },

  // Social: Glory and choices over cash
  { id: "village-dispute", kind: "social", title: "Village Dispute", text: "Two farmers fight over a boundary stone. Your fair judgement settles it.", glory: { amount: 1, category: "quest" } },
  { id: "bards-song", kind: "social", title: "The Bard's Song", text: "A wandering bard has made a song of your deeds. The tavern sings along.", glory: { amount: 1, category: "achievement" } },
  { id: "pilgrims-bread", kind: "social", title: "Bread for Pilgrims", text: "You share your coin and bread with hungry pilgrims bound for Sázava.", cash: [-10, -10], glory: { amount: 1, category: "achievement" } },
  { id: "drinking-contest", kind: "social", title: "Drinking Contest", text: "You outlast the whole table at the Pribyslavitz inn and stand at the end.", glory: { amount: 1, category: "tournament" } },
  { id: "archery-contest", kind: "social", title: "Archery Contest", text: "Three arrows, three hits. The prize is small but the crowd remembers.", cash: [10, 20], glory: { amount: 1, category: "tournament" } },
  { id: "insulted-noble", kind: "social", title: "A Careless Word", text: "You insult a nobleman's horse within earshot of his steward. The fine is swift.", cash: [-30, -20] },

  // Crime: fines and risks
  { id: "pickpocket", kind: "crime", title: "Pickpocketed", text: "In the Kuttenberg crowds a light hand finds your purse.", cash: [-30, -15] },
  { id: "caught-lockpicking", kind: "crime", title: "Caught at the Lock", text: "The bailiff catches you kneeling at a merchant's chest. You pay to avoid the stocks.", cash: [-50, -30] },
  { id: "poached-deer", kind: "crime", title: "The Lord's Deer", text: "A gamekeeper finds venison in your pack. Poaching carries a fine.", cash: [-40, -20] },
  { id: "bandit-camp", kind: "crime", title: "Bandit Camp", text: "You drive off a handful of cutthroats and take what they stole.", cash: [20, 40], glory: { amount: 1, category: "achievement" } },

  // Quest leads: progress through clues, not coin
  { id: "torn-letter", kind: "quest", title: "Torn Letter", text: "A half-burnt letter in a dead courier's satchel bears a familiar seal.", clue: "Half-burnt letter bearing a familiar seal" },
  { id: "bloodied-cloak", kind: "quest", title: "Bloodied Cloak", text: "Snagged on a thorn bush: a cloak in the colours of a missing retinue.", clue: "Bloodied cloak of the missing retinue" },
  { id: "mill-witness", kind: "quest", title: "Witness at the Mill", text: "The miller's wife saw riders cross the ford at night, heading east.", clue: "Riders seen crossing the ford by night" },
  { id: "bribed-guard", kind: "quest", title: "A Loose Tongue", text: "A few coins and a jug of wine, and the gate guard lets a name slip.", cash: [-20, -10], clue: "A name let slip by the gate guard" },
  { id: "hidden-ledger", kind: "quest", title: "Hidden Ledger", text: "Behind a loose stone in the chapel wall: a ledger of payments no honest man would keep.", clue: "Hidden ledger of secret payments" },
  { id: "hermit-riddle", kind: "quest", title: "The Hermit's Riddle", text: "An old hermit answers your question with a riddle, and the riddle points to a place.", clue: "The hermit's riddle about a hidden place" },
  { id: "bathhouse-rumour", kind: "quest", title: "Bathhouse Rumour", text: "Between the steam and the gossip, the bath maids speak of strangers asking questions.", clue: "Rumour of strangers asking questions" },

  // Achievements and tournaments
  { id: "sparring-master", kind: "tournament", title: "Bout with the Master", text: "You land a clean strike on the sword master in front of his pupils.", glory: { amount: 1, category: "achievement" } },
  { id: "drowning-child", kind: "social", title: "Into the River", text: "You pull a child from the millrace before the wheel takes her.", glory: { amount: 1, category: "achievement" } },
  { id: "tourney-win", kind: "tournament", title: "Tourney Victory", text: "Lance shattered, opponent unhorsed: the lists are yours today.", cash: [20, 30], glory: { amount: 2, category: "tournament" } },
];
