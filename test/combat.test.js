const test = require("node:test");
const assert = require("node:assert");
const Combat = require("../combat.js");

const rules = { hitDie: 20, baseTarget: 10, critOn: 20, fumbleOn: 1, minDamage: 1 };
const sword = { name: "A", hp: 20, hit: 2, hitPenalty: 0, damage: "1d8+1", pierce: 0, defence: 3, reduction: 2 };
const mace = { name: "B", hp: 20, hit: 0, hitPenalty: 1, damage: "1d6+1", pierce: 2, defence: 4, reduction: 3 };

test("parses dice notation", () => {
  assert.deepStrictEqual(Combat.parseDice("1d8+1"), { count: 1, sides: 8, bonus: 1 });
  assert.deepStrictEqual(Combat.parseDice("2d4-1"), { count: 2, sides: 4, bonus: -1 });
  assert.deepStrictEqual(Combat.parseDice("d6"), { count: 1, sides: 6, bonus: 0 });
  assert.deepStrictEqual(Combat.parseDice("3"), { count: 0, sides: 0, bonus: 3 });
});

test("slash roll: hits on target, natural 20 always hits, natural 1 always misses", () => {
  // sword +2 against defence 4 needs 14 total, i.e. a natural 12
  assert.strictEqual(Combat.resolveSlash(sword, mace, 12, rules).hit, true);
  assert.strictEqual(Combat.resolveSlash(sword, mace, 11, rules).hit, false);
  assert.strictEqual(Combat.resolveSlash(mace, { defence: 30 }, 20, rules).hit, true);
  assert.strictEqual(Combat.resolveSlash({ hit: 50 }, mace, 1, rules).hit, false);
});

test("hit chance counts the faces that hit", () => {
  assert.strictEqual(Combat.hitChance(sword, mace, rules).hit, 9 / 20); // 12..20
  // mace +0 -1 penalty against defence 3 needs 13 total = natural 14..20
  assert.strictEqual(Combat.hitChance(mace, sword, rules).hit, 7 / 20);
});

test("damage: armour reduction, pierce and the minimum", () => {
  assert.strictEqual(Combat.resolveDamage(sword, mace, 5, rules).damage, 3); // 5+1-3
  assert.strictEqual(Combat.resolveDamage(mace, sword, 4, rules).damage, 5); // 4+1-(2-2)
  assert.strictEqual(Combat.resolveDamage(sword, mace, 1, rules).damage, 1); // 1+1-3 -> minimum 1
});

test("damage stats match a hand count", () => {
  const s = Combat.damageStats(sword, mace, false, rules); // d8+1-3, min 1: 1,1,1,2,3,4,5,6
  assert.strictEqual(s.min, 1);
  assert.strictEqual(s.max, 6);
  assert.strictEqual(s.mean, 23 / 8);
});

test("simulation favours the stronger fighter and respects the exchange limit", () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strong = { ...sword, hit: 5, damage: "1d12+3" };
  const odds = Combat.simulate(strong, mace, rules, { n: 2000, rng });
  assert.ok(odds.a > 0.8, `expected strong side to win most fights, got ${odds.a}`);
  const capped = Combat.simulate(sword, mace, rules, { n: 500, exchanges: 3, rng });
  assert.ok(capped.exchanges <= 3);
  assert.ok(Math.abs(capped.a + capped.b + capped.draw - 1) < 1e-9);
});

test("the shipped gear file is well formed", () => {
  global.window = {};
  require("../gear.js");
  const G = global.window.GEAR;
  const ids = new Set();
  for (const w of G.weapons) { assert.ok(Combat.parseDice(w.damage).count > 0, w.id); assert.ok(!ids.has(w.id)); ids.add(w.id); }
  for (const a of G.armour) { assert.ok(a.defence >= 0 && a.reduction >= 0, a.id); assert.ok(!ids.has(a.id)); ids.add(a.id); }
  for (const f of G.foes) assert.ok(f.hp > 0 && Combat.parseDice(f.damage).count > 0, f.id);
  assert.ok(G.weapons.some((w) => w.id === G.starter.weapon));
  assert.ok(G.armour.some((a) => a.id === G.starter.armour));
});
