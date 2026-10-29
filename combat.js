/* Combat maths for the Chronicle of Bohemia companion.
 * Pure functions driven by the numbers in gear.js, so they also run under Node
 * for the tests in test/combat.test.js.
 *
 * A fighter is { name, hp, hit, hitPenalty, damage, pierce, defence, reduction }.
 */
(function (root) {
  "use strict";

  const DEFAULT_RULES = { hitDie: 20, baseTarget: 10, critOn: 20, fumbleOn: 1, minDamage: 1 };

  // "1d8+1" -> { count: 1, sides: 8, bonus: 1 }
  function parseDice(text) {
    const m = String(text || "").replace(/\s+/g, "").toLowerCase().match(/^(\d*)d(\d+)([+-]\d+)?$/);
    if (!m) {
      const flat = Number(text);
      return { count: 0, sides: 0, bonus: Number.isFinite(flat) ? flat : 0 };
    }
    return { count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]), bonus: m[3] ? Number(m[3]) : 0 };
  }

  const diceLabel = (d, times = 1) => {
    if (!d.count) return String(d.bonus);
    return `${d.count * times}d${d.sides}`;
  };

  // The roll needed and what it means, from the attacker's side.
  function slashTarget(att, def, rules) {
    const r = Object.assign({}, DEFAULT_RULES, rules);
    const mod = (att.hit || 0) - (att.hitPenalty || 0);
    const target = r.baseTarget + (def.defence || 0);
    return { mod, target, rules: r };
  }

  function resolveSlash(att, def, natural, rules) {
    const { mod, target, rules: r } = slashTarget(att, def, rules);
    const total = natural + mod;
    const crit = natural >= r.critOn;
    const fumble = natural <= r.fumbleOn;
    const hit = !fumble && (crit || total >= target);
    return { natural, mod, total, target, crit, fumble, hit };
  }

  function hitChance(att, def, rules) {
    const r = Object.assign({}, DEFAULT_RULES, rules);
    let hits = 0, crits = 0;
    for (let n = 1; n <= r.hitDie; n++) {
      const s = resolveSlash(att, def, n, r);
      if (s.hit) hits++;
      if (s.hit && s.crit) crits++;
    }
    return { hit: hits / r.hitDie, crit: crits / r.hitDie, rollNeeded: Math.max(1, Math.min(r.hitDie, slashTarget(att, def, r).target - slashTarget(att, def, r).mod)) };
  }

  function armourAfterPierce(att, def) {
    return Math.max(0, (def.reduction || 0) - (att.pierce || 0));
  }

  // diceSum is what the player rolled on the damage dice alone (bonus is added here).
  function resolveDamage(att, def, diceSum, rules) {
    const r = Object.assign({}, DEFAULT_RULES, rules);
    const d = parseDice(att.damage);
    const raw = diceSum + d.bonus;
    const blocked = armourAfterPierce(att, def);
    const damage = Math.max(r.minDamage, raw - blocked);
    return { diceSum, bonus: d.bonus, raw, blocked, damage };
  }

  // Probability of each dice total for `count` dice of `sides`.
  function diceDistribution(count, sides) {
    let dist = new Map([[0, 1]]);
    for (let i = 0; i < count; i++) {
      const next = new Map();
      for (const [sum, p] of dist) for (let f = 1; f <= sides; f++) next.set(sum + f, (next.get(sum + f) || 0) + p / sides);
      dist = next;
    }
    return dist;
  }

  function damageStats(att, def, crit, rules) {
    const d = parseDice(att.damage);
    const dist = diceDistribution(d.count * (crit ? 2 : 1), d.sides);
    let mean = 0, min = Infinity, max = -Infinity;
    for (const [sum, p] of dist) {
      const dmg = resolveDamage(att, def, sum, rules).damage;
      mean += dmg * p;
      min = Math.min(min, dmg);
      max = Math.max(max, dmg);
    }
    return { mean, min, max };
  }

  // Average damage one attack deals, counting misses and crits.
  function expectedDamage(att, def, rules) {
    const hc = hitChance(att, def, rules);
    const normal = damageStats(att, def, false, rules);
    const crit = damageStats(att, def, true, rules);
    return (hc.hit - hc.crit) * normal.mean + hc.crit * crit.mean;
  }

  function rollDie(sides, rng) { return 1 + Math.floor((rng || Math.random)() * sides); }

  function rollDamageDice(att, crit, rng) {
    const d = parseDice(att.damage);
    let sum = 0;
    for (let i = 0; i < d.count * (crit ? 2 : 1); i++) sum += rollDie(d.sides, rng);
    return sum;
  }

  /* Monte Carlo odds for the rest of a fight.
   * opts: { hpA, hpB, exchanges (0 = no limit), next: "a" | "b", n, rng } */
  function simulate(A, B, rules, opts = {}) {
    const r = Object.assign({}, DEFAULT_RULES, rules);
    const n = opts.n || 4000;
    const limit = opts.exchanges || 0;
    const rng = opts.rng || Math.random;
    let winsA = 0, winsB = 0, draws = 0, totalExchanges = 0;
    for (let i = 0; i < n; i++) {
      let hpA = opts.hpA != null ? opts.hpA : A.hp;
      let hpB = opts.hpB != null ? opts.hpB : B.hp;
      let turn = opts.next || "a";
      let attacks = 0;
      const maxAttacks = limit ? limit * 2 - (opts.attacksDone || 0) : 200;
      while (hpA > 0 && hpB > 0 && attacks < maxAttacks) {
        const [att, def] = turn === "a" ? [A, B] : [B, A];
        const s = resolveSlash(att, def, rollDie(r.hitDie, rng), r);
        if (s.hit) {
          const dmg = resolveDamage(att, def, rollDamageDice(att, s.crit, rng), r).damage;
          if (turn === "a") hpB -= dmg; else hpA -= dmg;
        }
        attacks++;
        turn = turn === "a" ? "b" : "a";
      }
      totalExchanges += attacks / 2;
      if (hpB <= 0 && hpA > 0) winsA++;
      else if (hpA <= 0 && hpB > 0) winsB++;
      else if (hpA > hpB) winsA++;
      else if (hpB > hpA) winsB++;
      else draws++;
    }
    return { a: winsA / n, b: winsB / n, draw: draws / n, exchanges: totalExchanges / n };
  }

  const api = { parseDice, diceLabel, slashTarget, resolveSlash, hitChance, resolveDamage, armourAfterPierce, damageStats, expectedDamage, rollDie, rollDamageDice, simulate };
  root.Combat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
