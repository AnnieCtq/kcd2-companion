# Chronicle of Bohemia

Digital companion for the KCD2-inspired RPG Monopoly campaign (2–4 players).

Open `index.html` in a browser. No install or build step; everything is saved in that browser's local storage, and you can save or load the whole game as a `.json` file from the footer.

## What it tracks

- **Campaign status (shared):** Chapter I, II, III, then Success or Unresolved.
- **Glory (personal):** each player's total, awarded for new clues (automatic), significant quest contributions, tournament wins and character achievements. Rent and property never earn Glory.
- **Clues (shared evidence):** who found each clue and in which chapter. At the finale each unspent clue can be spent once for +1 on the final check, with all bonuses capped at +2.
- **Armoury:** a round counter; every 3rd round the merchant opens and players trade up from the starter Hunting Sword and Padded Gambeson to KCD2 weapons and armour.
- **Combat:** tournament bouts and fights against foes, two rolls per swing (d20 slash, then weapon damage dice), with the odds, the maths for every roll and one-tap Glory for a tournament win.
- **Treasury:** starting and current balance per player, event money gained and lost, quest rewards, merchant purchases, gear sold back and other costs.
- **Finale:** the campaign result is announced first; the Champion of Bohemia (most Glory) is named only if the party succeeds. Copy a summary or download the ledger as CSV for the post-game review.

Every action is written to the Chronicle tab and can be undone.

## Tuning the game

- `gear.js`: weapons, armour, foes, the starter kit and every combat rule (dice, hit target, HP, crits, merchant frequency, sell-back share).
- `cards.js`: the scenario card deck.

`npm test` checks the scripts and runs the combat maths tests in `test/`.

## Hosting on GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.
