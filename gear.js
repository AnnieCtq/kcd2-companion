/* Weapons, armour, foes and combat rules for the Chronicle of Bohemia companion.
 *
 * Everything the Armoury and Combat tabs calculate comes from this file, so the
 * balance can be tuned here without touching the app. The app re-reads it on load.
 *
 * Combat is two rolls per attack:
 *   1. Slash roll:  d20 + weapon "hit" - attacker's armour "hitPenalty"
 *                   hits if it reaches  rules.baseTarget + defender's armour "defence".
 *                   A natural rules.critOn always hits and rolls the damage dice twice;
 *                   a natural rules.fumbleOn always misses.
 *   2. Damage roll: the weapon's dice, e.g. "1d8+1",
 *                   minus the defender's armour "reduction" (less the weapon's "pierce"),
 *                   never below rules.minDamage. Damage comes off the defender's HP.
 * In a fight both sides attack once per exchange, the challenger first.
 */
window.GEAR = {
  rules: {
    hitDie: 20,             // the slash roll die
    baseTarget: 10,         // slash total needed against an unarmoured foe
    critOn: 20,             // natural roll that always hits and doubles the damage dice
    fumbleOn: 1,            // natural roll that always misses
    minDamage: 1,           // a hit always does at least this much
    hp: 20,                 // every player starts each fight with this much HP
    tournamentExchanges: 3, // a tournament bout ends at 0 HP or after this many exchanges
    fightExchanges: 0,      // 0 = a fight lasts until someone drops
    tournamentGlory: 2,     // Glory for winning a tournament bout
    merchantEvery: 3,       // the merchant opens on every 3rd round
    sellBack: 0.5,          // share of the price the merchant pays for your old gear
  },

  // What everyone starts with.
  starter: { weapon: "hunting-sword", armour: "gambeson" },

  weapons: [
    { id: "hunting-sword", name: "Hunting Sword", hit: 1, damage: "1d6", pierce: 0, price: 80,
      text: "A light blade every Bohemian traveller carries. Quick, but it struggles against mail." },
    { id: "kriegsmesser", name: "Kriegsmesser", hit: 1, damage: "1d8", pierce: 0, price: 180,
      text: "The long German war-knife. A soldier's weapon, forgiving and fast." },
    { id: "pernach", name: "Pernach", hit: 0, damage: "1d6+1", pierce: 2, price: 220,
      text: "A flanged mace that cracks plate. Armour stops less of its blows." },
    { id: "battle-axe", name: "Battle Axe", hit: -1, damage: "1d10", pierce: 1, price: 260,
      text: "Heavy and brutal. Harder to land, but it bites deep when it does." },
    { id: "bohemian-longsword", name: "Bohemian Longsword", hit: 2, damage: "1d8+1", pierce: 0, price: 320,
      text: "The knightly blade of the Kingdom. Balanced, precise and feared." },
    { id: "halberd", name: "Halberd", hit: -1, damage: "1d12", pierce: 1, price: 380,
      text: "Axe, spike and hook on a long haft. Slow to swing, terrible to meet." },
  ],

  armour: [
    { id: "gambeson", name: "Padded Gambeson", defence: 1, reduction: 0, hitPenalty: 0, price: 60,
      text: "Layers of quilted linen. Better than nothing, and nothing else is cheaper." },
    { id: "mail-hauberk", name: "Mail Hauberk", defence: 2, reduction: 1, hitPenalty: 0, price: 220,
      text: "Riveted rings to the knee. Turns the edge of most blades." },
    { id: "brigandine", name: "Brigandine", defence: 3, reduction: 2, hitPenalty: 0, price: 380,
      text: "Steel plates riveted inside cloth. The man-at-arms' favourite." },
    { id: "milanese-plate", name: "Milanese Plate Harness", defence: 4, reduction: 3, hitPenalty: 1, price: 650,
      text: "Italian plate fit for a lord. Nearly impenetrable, but it slows your swing." },
  ],

  // Foes for ordinary fights. Same numbers as a player: hit, damage, defence, reduction, HP.
  foes: [
    { id: "bandit", name: "Highway Bandit", hp: 12, hit: 0, damage: "1d6", pierce: 0, defence: 1, reduction: 0,
      text: "A desperate man with a rusty blade and nothing to lose." },
    { id: "cuman", name: "Cuman Raider", hp: 15, hit: 1, damage: "1d8", pierce: 0, defence: 2, reduction: 1,
      text: "A horseman from the steppe, quick with sabre and bow." },
    { id: "mercenary", name: "Sigismund's Mercenary", hp: 18, hit: 2, damage: "1d8+1", pierce: 1, defence: 3, reduction: 2,
      text: "A paid soldier in good mail, who has done this many times." },
    { id: "knight", name: "Armoured Knight", hp: 22, hit: 2, damage: "1d10", pierce: 1, defence: 4, reduction: 3,
      text: "Plate from head to toe. Only the best-armed should face him." },
  ],
};
