/* Chronicle of Bohemia: digital companion for the KCD2 RPG Monopoly campaign.
 * Plain browser JS, no build step. All state lives in localStorage.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "kcd2-companion-v1";
  const GUIDE_SEEN_KEY = "kcd2-companion-guide-seen";
  const DEFAULT_START_CASH = 1000;
  const BONUS_CAP = 2; // normal cap on bonuses to the final check
  const COLORS = ["#7a1f1a", "#2f5d8a", "#3f6a35", "#a87b1e"];

  const STATUSES = [
    { id: "ch1", label: "Chapter I" },
    { id: "ch2", label: "Chapter II" },
    { id: "ch3", label: "Chapter III" },
    { id: "success", label: "Success" },
    { id: "unresolved", label: "Unresolved" },
  ];
  const CHAPTER_IDS = ["ch1", "ch2", "ch3"];

  const GLORY_CATEGORIES = [
    { id: "clue", label: "New clue discovered", amount: 1, manual: false },
    { id: "quest", label: "Significant quest contribution", amount: 1, manual: true },
    { id: "tournament", label: "Tournament win", amount: 2, manual: true },
    { id: "achievement", label: "Character achievement", amount: 1, manual: true },
    { id: "correction", label: "Correction", amount: -1, manual: true },
  ];

  const TXN_TYPES = [
    { id: "event_gain", label: "Event money gained", sign: 1 },
    { id: "event_loss", label: "Event money lost", sign: -1 },
    { id: "quest_reward", label: "Quest reward", sign: 1 },
    { id: "purchase", label: "Merchant purchase", sign: -1 },
    { id: "sale", label: "Gear sold to merchant", sign: 1 },
    // Properties and rent were replaced by the merchant; kept so older saved games still add up.
    { id: "rent", label: "Rent paid", sign: -1, needsPayee: true, legacy: true },
    { id: "other_gain", label: "Other income", sign: 1 },
    { id: "other_loss", label: "Other cost", sign: -1 },
  ];

  const TABS = [
    { id: "campaign", label: "Campaign" },
    { id: "cards", label: "Scenario cards" },
    { id: "armoury", label: "Armoury" },
    { id: "combat", label: "Combat" },
    { id: "glory", label: "Glory" },
    { id: "clues", label: "Clues" },
    { id: "treasury", label: "Treasury" },
    { id: "finale", label: "Finale" },
    { id: "report", label: "Report" },
    { id: "chronicle", label: "Chronicle" },
  ];

  // ---------- state ----------

  function blankState() {
    return {
      version: 1,
      createdAt: Date.now(),
      status: "ch1",
      players: [],
      clues: [],
      glory: [],
      txns: [],
      finale: { otherBonus: 0, roll: "", target: "" },
      deck: { pile: [], removed: [] }, // card ids still to draw; clue cards removed once drawn
      draws: [],
      report: { answers: {}, notes: {} },
      round: 1,
      kit: {},      // playerId -> { weapon, armour } ids from gear.js
      combat: null, // the fight in progress, shared with every phone
      log: [],
    };
  }

  let state = load();
  let ui = { tab: "campaign", selectedClues: new Set() };
  const undoStack = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(blankState(), JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt; start fresh */ }
    return blankState();
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // Every local change is saved and, during live play, sent to the other phones.
  function save() {
    saveLocal();
    if (window.Sync) window.Sync.push(state);
  }

  // Wraps every mutation so it can be undone and is logged to the chronicle.
  function commit(text, mutate) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 50) undoStack.shift();
    mutate(state);
    if (text) state.log.unshift({ ts: Date.now(), chapter: state.status, text });
    save();
    render();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    state = JSON.parse(prev);
    ui.selectedClues.clear();
    save();
    render();
    toast("Last action undone");
  }

  // ---------- helpers ----------

  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-GB");
  const gr = (n) => `${fmt(n)} gr`;
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
  const player = (id) => state.players.find((p) => p.id === id);
  const pname = (id) => (player(id) ? player(id).name : "Unknown");
  const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || {}).label || id;
  const gloryCat = (id) => GLORY_CATEGORIES.find((c) => c.id === id);
  const txnType = (id) => TXN_TYPES.find((t) => t.id === id);
  const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isEnded = () => state.status === "success" || state.status === "unresolved";

  function gloryOf(pid) {
    return state.glory.filter((g) => g.playerId === pid).reduce((a, g) => a + g.amount, 0);
  }

  function standings() {
    return state.players
      .map((p) => ({ p, glory: gloryOf(p.id) }))
      .sort((a, b) => b.glory - a.glory);
  }

  function gloryLeaders() {
    const s = standings();
    if (!s.length) return [];
    const top = s[0].glory;
    return s.filter((x) => x.glory === top).map((x) => x.p);
  }

  function economy(pid) {
    const p = player(pid);
    const e = { start: p.startCash, rentPaid: 0, rentReceived: 0, eventGain: 0, eventLoss: 0, quest: 0, purchase: 0, sold: 0, otherGain: 0, otherLoss: 0 };
    for (const t of state.txns) {
      if (t.playerId === pid) {
        if (t.type === "rent") e.rentPaid += t.amount;
        else if (t.type === "event_gain") e.eventGain += t.amount;
        else if (t.type === "event_loss") e.eventLoss += t.amount;
        else if (t.type === "quest_reward") e.quest += t.amount;
        else if (t.type === "purchase") e.purchase += t.amount;
        else if (t.type === "sale") e.sold += t.amount;
        else if (t.type === "other_gain") e.otherGain += t.amount;
        else if (t.type === "other_loss") e.otherLoss += t.amount;
      }
      if (t.type === "rent" && t.payeeId === pid) e.rentReceived += t.amount;
    }
    e.balance = e.start - e.rentPaid + e.rentReceived + e.eventGain - e.eventLoss + e.quest - e.purchase + e.sold + e.otherGain - e.otherLoss;
    return e;
  }

  const sfx = (name, delay) => { if (window.SFX) window.SFX.play(name, delay); };

  function toast(msg) {
    const old = $(".toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function playerOptions(selected, { exclude } = {}) {
    return state.players
      .filter((p) => p.id !== exclude)
      .map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`)
      .join("");
  }

  // ---------- render ----------

  function render() {
    const app = $("#app");
    if (!state.players.length) { app.innerHTML = renderSetup(); return; }
    app.innerHTML = renderBanner() + renderTabs() + `<section class="panel" role="tabpanel">${renderPanel()}</section>`;
  }

  function renderSetup() {
    const rows = [0, 1, 2, 3].map((i) => `
      <div class="player-row">
        <input type="color" name="color${i}" value="${COLORS[i]}" aria-label="Player ${i + 1} colour">
        <input name="name${i}" placeholder="${i < 2 ? "Player " + (i + 1) : "Player " + (i + 1) + " (optional)"}" ${i < 2 ? "required" : ""} maxlength="30">
        <input type="number" name="cash${i}" value="${DEFAULT_START_CASH}" min="0" step="10" aria-label="Starting Groschen">
        <span class="muted">gr</span>
      </div>`).join("");
    return `
      <div class="card" style="margin:20px auto;max-width:640px">
        <h2>Gather the party</h2>
        <p class="note">Two to four players. Everyone starts with ${fmt(DEFAULT_START_CASH)} Groschen unless you change it.</p>
        <form data-form="setup">
          ${rows}
          <div class="row" style="justify-content:flex-end;margin-top:12px">
            <button class="btn" type="submit">Begin Chapter I</button>
          </div>
        </form>
      </div>`;
  }

  function renderBanner() {
    const idx = STATUSES.findIndex((s) => s.id === state.status);
    const chapters = STATUSES.map((s, i) => {
      const cls = ["chapter", s.id];
      if (s.id === state.status) cls.push("current");
      else if (i < idx && i < 3) cls.push("done");
      return `<button type="button" class="${cls.join(" ")}" data-action="set-status" data-status="${s.id}" aria-pressed="${s.id === state.status}">${s.label}</button>`;
    }).join("");

    const clueCount = state.clues.length;
    const unspent = state.clues.filter((c) => !c.spent).length;
    const leaders = gloryLeaders();
    const board = standings().map(({ p, glory }) => `
      <li>
        <span class="dot" style="background:${esc(p.color)}"></span>
        <span class="name">${esc(p.name)}${leaders.length === 1 && leaders[0].id === p.id && glory > 0 ? ' <span class="crown" title="Glory leader">♛</span>' : ""}</span>
        <span class="pts">${glory}</span>
      </li>`).join("");

    return `
      <div class="banner">
        <div class="card">
          <div class="kicker">Shared · Campaign status</div>
          <div class="chapters">${chapters}</div>
          <p class="note" style="margin-bottom:0">Party evidence: <strong>${clueCount}</strong> clue${clueCount === 1 ? "" : "s"} found, <strong>${unspent}</strong> unspent.</p>
          <div class="round-line"><span>Round <strong>${state.round}</strong> · ${merchantLine()}</span><button type="button" class="btn small ghost" data-action="next-round">Next round</button></div>
        </div>
        <div class="card">
          <div class="kicker">Personal · Glory</div>
          <ul class="glory-board">${board}</ul>
        </div>
      </div>`;
  }

  function renderTabs() {
    return `<nav class="tabs" role="tablist">${TABS.map((t) => `
      <button type="button" class="tab" role="tab" aria-selected="${ui.tab === t.id}" data-action="tab" data-tab="${t.id}">${t.label}</button>`).join("")}
      <span style="flex:1"></span>
      <button type="button" class="tab" data-action="undo" ${undoStack.length ? "" : "disabled"} title="Undo last action">↶ Undo</button>
    </nav>`;
  }

  function renderPanel() {
    switch (ui.tab) {
      case "cards": return renderCards();
      case "armoury": return renderArmoury();
      case "combat": return renderCombat();
      case "glory": return renderGlory();
      case "clues": return renderClues();
      case "treasury": return renderTreasury();
      case "finale": return renderFinale();
      case "report": return renderReport();
      case "chronicle": return renderChronicle();
      default: return renderCampaign();
    }
  }

  function renderCampaign() {
    const recent = state.log.slice(0, 6).map((l) => `<li><span class="muted">${time(l.ts)}</span> ${esc(l.text)}</li>`).join("");
    return `
      <div class="grid-2">
        <div class="card">
          <h2>Quick actions</h2>
          ${renderClueForm()}
          <hr style="border:0;border-top:1px dotted var(--rule);margin:14px 0">
          ${renderGloryForm()}
        </div>
        <div class="card">
          <h2>How victory works</h2>
          <p><strong>Together:</strong> the party advances through Chapters I to III and either succeeds or leaves the story unresolved. Clues are shared evidence and can be spent by anyone at the finale.</p>
          <p><strong>Alone:</strong> each player earns Glory for new clues, significant quest contributions, tournament wins and character achievements. Money and gear never earn Glory.</p>
          <p><strong>At the end:</strong> announce the campaign result first. Only if the party succeeds is the player with the most Glory named Champion of Bohemia.</p>
          <h3>Latest in the chronicle</h3>
          ${recent ? `<ul style="margin:0;padding-left:1.1rem">${recent}</ul>` : '<div class="empty">Nothing recorded yet.</div>'}
        </div>
      </div>`;
  }

  // ---------- scenario cards ----------

  const CARD_KINDS = { road: "On the road", social: "Social", crime: "Crime", quest: "Quest lead", tournament: "Contest" };
  const allCards = () => window.SCENARIO_CARDS || [];
  const cardById = (id) => allCards().find((c) => c.id === id);

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Cards still in the draw pile, reshuffling everything not removed when it runs out.
  function currentPile() {
    const removed = new Set(state.deck.removed);
    const pile = state.deck.pile.filter((id) => cardById(id) && !removed.has(id));
    return pile.length ? pile : shuffle(allCards().filter((c) => !removed.has(c.id)).map((c) => c.id));
  }

  const rollRange = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

  function drawCard(pid) {
    if (!player(pid) || isEnded()) return;
    const pile = currentPile();
    if (!pile.length) { toast("The deck is empty"); return; }
    const card = cardById(pile[pile.length - 1]);
    const cash = card.cash ? rollRange(card.cash) : 0;
    const drawId = uid();
    const name = pname(pid);
    ui.flipId = drawId;
    const parts = [];
    if (cash) parts.push(`${cash > 0 ? "+" : "−"}${gr(Math.abs(cash))}`);
    if (card.glory) parts.push(`+${card.glory.amount} Glory`);
    if (card.clue) parts.push("a new clue");

    commit(`${name} draws "${card.title}"${parts.length ? `: ${parts.join(", ")}` : ""}`, (st) => {
      const now = Date.now();
      st.deck.pile = pile.slice(0, -1);
      const draw = { id: drawId, ts: now, chapter: st.status, cardId: card.id, playerId: pid, cash, glory: card.glory ? card.glory.amount : 0, clueId: null };
      if (cash) {
        st.txns.push({ id: uid(), ts: now, chapter: st.status, type: cash > 0 ? "event_gain" : "event_loss", playerId: pid, payeeId: null, amount: Math.abs(cash), note: `Card: ${card.title}`, drawId });
      }
      if (card.glory) {
        st.glory.push({ id: uid(), ts: now, chapter: st.status, playerId: pid, category: card.glory.category, amount: card.glory.amount, note: `Card: ${card.title}`, drawId });
      }
      if (card.clue) {
        const clueId = uid();
        const chapter = CHAPTER_IDS.includes(st.status) ? st.status : "ch3";
        st.clues.push({ id: clueId, ts: now, title: card.clue, discovererId: pid, chapter, glory: 1, spent: false, drawId });
        st.glory.push({ id: uid(), ts: now, chapter, playerId: pid, category: "clue", amount: 1, note: card.clue, clueId });
        st.deck.removed.push(card.id);
        draw.clueId = clueId;
      }
      st.draws.unshift(draw);
    });
    ui.flipId = null; // animate the flip only on the render that revealed it
    sfx("flip");
    const outcome = [cash > 0 && "coins", cash < 0 && "loss", card.glory && "glory", card.clue && "clue"].filter(Boolean);
    outcome.forEach((name, i) => sfx(name, 550 + i * 380));
  }

  function drawOutcome(d) {
    const card = cardById(d.cardId);
    const lines = [];
    if (d.cash) lines.push(`<span class="${d.cash > 0 ? "pos" : "neg"}">${d.cash > 0 ? "+" : "−"}${gr(Math.abs(d.cash))}</span> ${d.cash > 0 ? "to" : "from"} ${esc(pname(d.playerId))}`);
    if (d.glory && card && card.glory) lines.push(`<span class="pos">+${d.glory} Glory</span> for ${esc(pname(d.playerId))} (${esc((gloryCat(card.glory.category) || {}).label || "")})`);
    if (d.clueId) {
      const clue = state.clues.find((c) => c.id === d.clueId);
      lines.push(`New clue for the party: <strong>${esc(clue ? clue.title : card && card.clue)}</strong> (+1 Glory to ${esc(pname(d.playerId))})`);
    }
    return lines.length ? lines.join("<br>") : '<span class="muted">No effect.</span>';
  }

  function renderCards() {
    const ended = isEnded();
    const buttons = state.players.map((p) => `
      <button type="button" class="draw-btn" data-action="draw-card" data-player="${p.id}" style="--pc:${esc(p.color)}" ${ended ? "disabled" : ""}>
        <span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)} draws
      </button>`).join("");

    const last = state.draws[0];
    const lastCard = last && cardById(last.cardId);
    const shown = lastCard ? `
      <div class="card-flip ${last.id === ui.flipId ? "flipping" : ""}">
        <article class="scenario-card card-front kind-${lastCard.kind}" aria-live="polite">
          <div class="kicker">${esc(CARD_KINDS[lastCard.kind] || lastCard.kind)} · drawn by ${esc(pname(last.playerId))}</div>
          <h3 class="scenario-title">${esc(lastCard.title)}</h3>
          <p class="scenario-text">${esc(lastCard.text)}</p>
          <div class="scenario-result">${drawOutcome(last)}</div>
        </article>
        <div class="card-back" aria-hidden="true"><span class="card-back-emblem"></span></div>
      </div>` : `<div class="scenario-card empty-card"><p class="empty">Choose who is drawing, and a card will be turned over and applied to them.</p></div>`;

    const pileLeft = state.deck.pile.filter((id) => cardById(id) && !state.deck.removed.includes(id)).length;
    const questLeft = allCards().filter((c) => c.clue && !state.deck.removed.includes(c.id)).length;
    const recent = state.draws.slice(1, 9).map((d) => {
      const c = cardById(d.cardId);
      return `<tr><td class="muted">${time(d.ts)}</td><td>${esc(pname(d.playerId))}</td><td>${esc(c ? c.title : d.cardId)}</td><td>${drawOutcome(d)}</td></tr>`;
    }).join("");

    return `
      <div class="grid-2">
        <div class="card">
          <h2>Draw a scenario</h2>
          <p class="note">The player whose turn it is presses their own name. The card's money, Glory or clue is applied to them at once. Use ↶ Undo if the wrong name was pressed.</p>
          <div class="draw-buttons">${buttons}</div>
          ${ended ? '<p class="note">The campaign is over, so no more cards can be drawn.</p>' : ""}
          <p class="muted" style="font-size:.9rem;margin-bottom:0">${pileLeft ? `${pileLeft} card${pileLeft === 1 ? "" : "s"} left before the deck is reshuffled` : "A fresh shuffle awaits"} · ${questLeft} quest lead${questLeft === 1 ? "" : "s"} still hidden in the deck</p>
        </div>
        ${shown}
      </div>
      ${recent ? `<div class="card" style="margin-top:14px"><h2>Earlier draws</h2><div class="table-scroll"><table><tbody>${recent}</tbody></table></div></div>` : ""}`;
  }

  function renderGloryForm() {
    const cats = GLORY_CATEGORIES.filter((c) => c.manual)
      .map((c) => `<option value="${c.id}" data-amount="${c.amount}">${c.label}</option>`).join("");
    return `
      <h3>Award Glory</h3>
      <form class="row" data-form="glory">
        <label class="field">Player<select name="playerId">${playerOptions()}</select></label>
        <label class="field">For<select name="category" data-sync-amount>${cats}</select></label>
        <label class="field" style="flex:0 1 80px">Glory<input type="number" name="amount" value="1" step="1" required></label>
        <label class="field" style="flex:2 1 200px">Note<input name="note" maxlength="120" placeholder="e.g. Talked down the bandit chief"></label>
        <button class="btn" type="submit">Award</button>
      </form>
      <p class="note">Glory for clues is awarded automatically when a clue is recorded. Never award Glory for money or buying gear.</p>`;
  }

  function renderClueForm() {
    const chapterOpts = CHAPTER_IDS.map((c) => `<option value="${c}" ${c === state.status ? "selected" : ""}>${statusLabel(c)}</option>`).join("");
    return `
      <h3>Record a clue</h3>
      <form class="row" data-form="clue">
        <label class="field" style="flex:2 1 220px">Clue<input name="title" required maxlength="80" placeholder="e.g. Torn letter bearing the Kuttenberg seal"></label>
        <label class="field">Found by<select name="discovererId">${playerOptions()}</select></label>
        <label class="field" style="flex:0 1 130px">Chapter<select name="chapter">${chapterOpts}</select></label>
        <label class="field" style="flex:0 1 80px">Glory<input type="number" name="glory" value="1" min="0" step="1"></label>
        <button class="btn" type="submit">Record</button>
      </form>`;
  }

  function renderGlory() {
    const leaders = gloryLeaders();
    const cards = standings().map(({ p, glory }) => {
      const entries = state.glory.filter((g) => g.playerId === p.id);
      const byCat = GLORY_CATEGORIES.map((c) => {
        const sum = entries.filter((g) => g.category === c.id).reduce((a, g) => a + g.amount, 0);
        return sum ? `<span class="badge">${c.label}: ${signed(sum)}</span>` : "";
      }).join(" ");
      return `
        <div class="card">
          <div class="row" style="align-items:center">
            <span class="dot" style="background:${esc(p.color)}"></span>
            <strong style="flex:1">${esc(p.name)}</strong>
            ${leaders.length === 1 && leaders[0].id === p.id && glory > 0 ? '<span class="badge gold">Leading</span>' : ""}
            <span class="check-total" style="font-size:1.6rem">${glory}</span>
          </div>
          <div style="margin:6px 0">${byCat || '<span class="muted">No Glory yet.</span>'}</div>
          ${entries.length ? `<div class="table-scroll"><table><tbody>${entries.slice().reverse().map((g) => `
            <tr><td>${esc((gloryCat(g.category) || {}).label || g.category)}${g.note ? `<br><span class="muted">${esc(g.note)}</span>` : ""}</td>
            <td class="muted">${statusLabel(g.chapter)}</td>
            <td class="num ${g.amount < 0 ? "neg" : "pos"}">${signed(g.amount)}</td>
            <td class="num">${g.clueId ? '<span class="muted" title="Remove the clue to remove this">clue</span>' : `<button class="link danger" data-action="del-glory" data-id="${g.id}" aria-label="Remove">✕</button>`}</td></tr>`).join("")}
          </tbody></table></div>` : ""}
        </div>`;
    }).join("");
    return `<div class="card" style="margin-bottom:14px">${renderGloryForm()}</div><div class="grid-2">${cards}</div>`;
  }

  function renderClues() {
    const total = state.clues.length;
    const spent = state.clues.filter((c) => c.spent).length;
    const items = state.clues.map((c, i) => `
      <li class="clue ${c.spent ? "spent" : ""}">
        <span class="seal">${i + 1}</span>
        <div class="body">
          <div class="title">${esc(c.title)}</div>
          <div class="muted" style="font-size:.9rem">Found by <strong>${esc(pname(c.discovererId))}</strong> in ${statusLabel(c.chapter)}${c.glory ? ` · +${c.glory} Glory` : ""}</div>
          <div style="margin-top:4px">${c.spent ? `<span class="badge">Spent at finale</span>` : `<span class="badge gold">Unspent · worth +1 at the finale</span>`}</div>
        </div>
        <button class="link danger" data-action="del-clue" data-id="${c.id}" aria-label="Remove clue">✕</button>
      </li>`).join("");
    const perPlayer = state.players.map((p) => {
      const n = state.clues.filter((c) => c.discovererId === p.id).length;
      return `<span class="badge"><span class="dot" style="display:inline-block;vertical-align:-1px;background:${esc(p.color)}"></span> ${esc(p.name)}: ${n}</span>`;
    }).join(" ");
    return `
      <div class="card" style="margin-bottom:14px">${renderClueForm()}</div>
      <div class="card">
        <h2>Party evidence</h2>
        <p class="note">Clues belong to the whole party. The discoverer is recorded for their personal Glory. Each clue can be spent once at the finale for +1 to the final check.</p>
        <div class="row" style="gap:6px;margin-bottom:8px">${perPlayer}</div>
        <div class="muted">${total} found · ${total - spent} unspent · ${spent} spent</div>
        <div class="progress" aria-hidden="true"><span style="width:${total ? ((total - spent) / total) * 100 : 0}%"></span></div>
        ${total ? `<ul class="clue-list">${items}</ul>` : '<div class="empty">No clues yet. Quest leads should reward progress with a clue.</div>'}
      </div>`;
  }

  const hasLegacyRent = () => state.txns.some((t) => t.type === "rent");

  function ledgerColumns() {
    const n = (v) => fmt(v);
    return [
      { label: "Start", value: (e) => e.start, show: n },
      ...(hasLegacyRent() ? [
        { label: "Rent paid", value: (e) => e.rentPaid, show: n, cls: "neg" },
        { label: "Rent recv.", value: (e) => e.rentReceived, show: n, cls: "pos" },
      ] : []),
      { label: "Event +", value: (e) => e.eventGain, show: n, cls: "pos" },
      { label: "Event −", value: (e) => e.eventLoss, show: n, cls: "neg" },
      { label: "Quest", value: (e) => e.quest, show: n, cls: "pos" },
      { label: "Merchant", value: (e) => e.purchase, show: n, cls: "neg" },
      { label: "Sold", value: (e) => e.sold, show: n, cls: "pos" },
      { label: "Other", value: (e) => e.otherGain - e.otherLoss, show: signed },
      { label: "Balance", value: (e) => e.balance, show: (v) => `<strong>${fmt(v)}</strong>` },
    ];
  }

  function renderTreasury() {
    const typeOpts = TXN_TYPES.filter((t) => !t.legacy).map((t) => `<option value="${t.id}">${t.label}</option>`).join("");
    const cols = ledgerColumns();
    const rows = state.players.map((p) => {
      const e = economy(p.id);
      return `<tr>
        <td><span class="dot" style="display:inline-block;background:${esc(p.color)}"></span> ${esc(p.name)}</td>
        ${cols.map((c) => `<td class="num ${c.cls || ""}">${c.show(c.value(e))}</td>`).join("")}
      </tr>`;
    }).join("");
    const all = state.players.map((p) => economy(p.id));
    const total = (c) => all.reduce((a, e) => a + c.value(e), 0);
    const ledger = state.txns.slice().reverse().map((t) => {
      const tt = txnType(t.type);
      const who = t.type === "rent" ? `${esc(pname(t.playerId))} → ${esc(pname(t.payeeId))}` : esc(pname(t.playerId));
      return `<tr>
        <td class="muted">${time(t.ts)}</td>
        <td>${tt ? tt.label : t.type}${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ""}</td>
        <td>${who}</td>
        <td class="muted">${statusLabel(t.chapter)}</td>
        <td class="num ${tt && tt.sign < 0 ? "neg" : "pos"}">${gr(t.amount)}</td>
        <td class="num"><button class="link danger" data-action="del-txn" data-id="${t.id}" aria-label="Remove">✕</button></td>
      </tr>`;
    }).join("");
    return `
      <div class="card" style="margin-bottom:14px">
        <h2>Record money</h2>
        <form class="row" data-form="txn">
          <label class="field">Type<select name="type" data-txn-type>${typeOpts}</select></label>
          <label class="field">Player<select name="playerId">${playerOptions()}</select></label>
          <label class="field" data-payee>Paid to<select name="payeeId">${playerOptions(state.players[1] && state.players[1].id)}</select></label>
          <label class="field" style="flex:0 1 110px">Groschen<input type="number" name="amount" min="1" step="1" required></label>
          <label class="field" style="flex:2 1 180px">Note<input name="note" maxlength="120" placeholder="e.g. Rattay tavern"></label>
          <button class="btn" type="submit">Record</button>
        </form>
        <p class="note">For ordinary events, prefer the lower end of the reward range while money is plentiful. Merchant purchases are recorded automatically from the Armoury. Money never earns Glory.</p>
      </div>
      <div class="card" style="margin-bottom:14px">
        <h2>Ledger by player</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Player</th>${cols.map((c) => `<th class="num">${c.label}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th>All</th>${cols.map((c) => `<th class="num">${c.show(total(c))}</th>`).join("")}</tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <h2>Transactions</h2>
        ${ledger ? `<div class="table-scroll"><table><thead><tr><th>Time</th><th>What</th><th>Who</th><th>When</th><th class="num">Amount</th><th></th></tr></thead><tbody>${ledger}</tbody></table></div>` : '<div class="empty">No money has changed hands yet.</div>'}
      </div>`;
  }

  function renderFinale() {
    const unspent = state.clues.filter((c) => !c.spent);
    const spentCount = state.clues.filter((c) => c.spent).length;
    const other = Math.max(0, Number(state.finale.otherBonus) || 0);
    const room = Math.max(0, BONUS_CAP - other - spentCount);
    // drop any selection that no longer exists
    for (const id of ui.selectedClues) if (!unspent.some((c) => c.id === id)) ui.selectedClues.delete(id);
    const selected = ui.selectedClues.size;
    const clueBonus = Math.min(spentCount + selected, Math.max(0, BONUS_CAP - other));
    const totalBonus = Math.min(BONUS_CAP, other + spentCount + selected);
    const roll = state.finale.roll === "" ? null : Number(state.finale.roll);
    const target = state.finale.target === "" ? null : Number(state.finale.target);
    const total = roll == null ? null : roll + totalBonus;

    const clueChecks = unspent.map((c) => {
      const checked = ui.selectedClues.has(c.id);
      const disabled = !checked && selected >= room;
      return `<label class="clue" style="cursor:${disabled ? "not-allowed" : "pointer"}">
        <input type="checkbox" data-action="pick-clue" data-id="${c.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} style="width:auto;margin-top:4px">
        <div class="body"><div class="title">${esc(c.title)}</div><div class="muted" style="font-size:.9rem">Found by ${esc(pname(c.discovererId))}</div></div>
      </label>`;
    }).join("");

    // Step 3 is hidden until the campaign has a result, so the shared outcome is always announced first.
    let verdict;
    if (!isEnded()) {
      verdict = `<p class="note">Resolve the campaign first. The Champion is named only after the party's fate is announced.</p>
        <div class="row">
          <button class="btn" data-action="set-status" data-status="success">The party succeeds</button>
          <button class="btn ghost" data-action="set-status" data-status="unresolved">The story is unresolved</button>
        </div>`;
    } else if (state.status === "success") {
      const leaders = gloryLeaders();
      const top = leaders.length ? gloryOf(leaders[0].id) : 0;
      verdict = `<div class="verdict">
        <div class="kicker">Campaign result</div>
        <div class="big pos">The party has succeeded</div>
        <div class="kicker" style="margin-top:14px">${leaders.length > 1 ? "Champions of Bohemia (tied)" : "Champion of Bohemia"}</div>
        <div class="big" style="color:var(--gold)">♛ ${leaders.map((p) => esc(p.name)).join(" & ")}</div>
        <div class="muted">${top} Glory</div>
      </div>`;
    } else {
      verdict = `<div class="verdict">
        <div class="kicker">Campaign result</div>
        <div class="big neg">The story remains unresolved</div>
        <p class="muted">The party did not succeed, so no Champion of Bohemia is named. Glory totals are kept for the record.</p>
      </div>`;
    }

    return `
      <div class="grid-2">
        <div class="card">
          <h2><span class="step-num">1</span>The final check</h2>
          <p class="note">Spend shared clues for +1 each. All bonuses together are capped at +${BONUS_CAP}, and each clue is spent only once.</p>
          <div class="row">
            <label class="field" style="flex:0 1 140px">Other bonuses<input type="number" min="0" max="${BONUS_CAP}" step="1" value="${other}" data-finale="otherBonus"></label>
            <label class="field" style="flex:0 1 120px">Roll<input type="number" step="1" value="${esc(state.finale.roll)}" data-finale="roll"></label>
            <label class="field" style="flex:0 1 120px">Target<input type="number" step="1" value="${esc(state.finale.target)}" data-finale="target"></label>
          </div>
          <h3>Clues to spend (${unspent.length} available${spentCount ? `, ${spentCount} already spent` : ""})</h3>
          ${unspent.length ? `<div class="clue-list">${clueChecks}</div>` : '<div class="empty">No unspent clues.</div>'}
          <div class="row" style="margin-top:12px;align-items:center">
            <div style="flex:1">
              <div class="muted">Bonus: ${other ? `+${Math.min(other, BONUS_CAP)} other, ` : ""}+${clueBonus} from clues = <strong>+${totalBonus}</strong> of +${BONUS_CAP}</div>
              ${total != null ? `<div class="check-total">${total}${target != null ? ` <span style="font-size:1rem" class="${total >= target ? "pos" : "neg"}">${total >= target ? "meets" : "misses"} ${target}</span>` : ""}</div>` : ""}
            </div>
            <button class="btn" data-action="spend-clues" ${selected ? "" : "disabled"}>Spend ${selected || ""} clue${selected === 1 ? "" : "s"}</button>
          </div>
        </div>
        <div class="card">
          <h2><span class="step-num">2</span>The party's fate</h2>
          ${verdict}
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2><span class="step-num">3</span>Records for the next playtest</h2>
        ${renderReportTable()}
        <div class="row" style="margin-top:10px">
          <button class="btn" data-action="tab" data-tab="report">Open the post-game report</button>
        </div>
      </div>`;
  }

  function renderReportTable() {
    const rows = standings().map(({ p, glory }) => {
      const e = economy(p.id);
      const clues = state.clues.filter((c) => c.discovererId === p.id).length;
      return `<tr><td>${esc(p.name)}</td><td class="num">${glory}</td><td class="num">${clues}</td><td class="num">${fmt(e.start)}</td><td class="num">${fmt(e.balance)}</td><td class="num">${fmt(e.purchase)}</td><td class="num">${signed(e.eventGain - e.eventLoss)}</td><td class="num">${fmt(e.quest)}</td></tr>`;
    }).join("");
    return `<div class="table-scroll"><table>
      <thead><tr><th>Player</th><th class="num">Glory</th><th class="num">Clues</th><th class="num">Start</th><th class="num">End</th><th class="num">Merchant</th><th class="num">Event net</th><th class="num">Quest rewards</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function renderChronicle() {
    const items = state.log.map((l) => `<tr><td class="muted">${time(l.ts)}</td><td class="muted">${statusLabel(l.chapter)}</td><td>${esc(l.text)}</td></tr>`).join("");
    return `<div class="card"><h2>The chronicle</h2>${items ? `<div class="table-scroll"><table><tbody>${items}</tbody></table></div>` : '<div class="empty">Nothing recorded yet.</div>'}</div>`;
  }

  // ---------- reports ----------

  // ---------- armoury ----------

  const GEARDATA = () => window.GEAR || { rules: {}, starter: {}, weapons: [], armour: [], foes: [] };
  const RULES = () => GEARDATA().rules;
  const weaponById = (id) => GEARDATA().weapons.find((w) => w.id === id);
  const armourById = (id) => GEARDATA().armour.find((a) => a.id === id);
  const foeById = (id) => GEARDATA().foes.find((f) => f.id === id);

  function kitOf(pid) {
    const k = state.kit[pid] || {};
    const starter = GEARDATA().starter;
    return { weapon: k.weapon || starter.weapon, armour: k.armour || starter.armour };
  }

  function kitItems(pid) {
    const k = kitOf(pid);
    return { weapon: weaponById(k.weapon), armour: armourById(k.armour) };
  }

  function playerFighter(pid) {
    const { weapon, armour } = kitItems(pid);
    return {
      name: pname(pid), hp: RULES().hp || 20,
      hit: weapon ? weapon.hit : 0, damage: weapon ? weapon.damage : "1d4", pierce: weapon ? weapon.pierce || 0 : 0,
      defence: armour ? armour.defence : 0, reduction: armour ? armour.reduction : 0, hitPenalty: armour ? armour.hitPenalty || 0 : 0,
    };
  }

  function foeFighter(id) {
    const f = foeById(id);
    return { name: f.name, hp: f.hp, hit: f.hit, damage: f.damage, pierce: f.pierce || 0, defence: f.defence, reduction: f.reduction, hitPenalty: 0 };
  }

  const merchantEvery = () => Math.max(1, RULES().merchantEvery || 3);
  const merchantOpen = () => state.round % merchantEvery() === 0;
  const roundsToMerchant = () => (merchantEvery() - (state.round % merchantEvery())) % merchantEvery();
  const tradeIn = (item) => (item ? Math.floor(item.price * (RULES().sellBack || 0)) : 0);

  const weaponStats = (w) => `slash ${w.hit >= 0 ? "+" : ""}${w.hit} · damage ${esc(w.damage)}${w.pierce ? ` · pierces ${w.pierce}` : ""}`;
  const armourStats = (a) => `defence ${a.defence} · blocks ${a.reduction}${a.hitPenalty ? ` · slash −${a.hitPenalty}` : ""}`;

  function merchantLine() {
    return merchantOpen()
      ? `<strong class="pos">The merchant is open this round.</strong>`
      : `Merchant opens in ${roundsToMerchant()} round${roundsToMerchant() === 1 ? "" : "s"} (round ${state.round + roundsToMerchant()}).`;
  }

  function renderArmoury() {
    const kits = state.players.map((p) => {
      const { weapon, armour } = kitItems(p.id);
      const f = playerFighter(p.id);
      return `
        <div class="card kit-card">
          <div class="row" style="align-items:center"><span class="dot" style="background:${esc(p.color)}"></span><strong style="flex:1">${esc(p.name)}</strong><span class="muted">${gr(economy(p.id).balance)}</span></div>
          <div class="kit-line"><span class="kit-icon" aria-hidden="true">⚔</span><div><strong>${esc(weapon ? weapon.name : "None")}</strong><div class="muted">${weapon ? weaponStats(weapon) : ""}</div></div></div>
          <div class="kit-line"><span class="kit-icon" aria-hidden="true">⛨</span><div><strong>${esc(armour ? armour.name : "None")}</strong><div class="muted">${armour ? armourStats(armour) : ""}</div></div></div>
          <p class="note" style="margin-bottom:0">In a fight: d20 ${f.hit - f.hitPenalty >= 0 ? "+" : "−"} ${Math.abs(f.hit - f.hitPenalty)} to slash, foes need ${(RULES().baseTarget || 10) + f.defence} to hit them.</p>
        </div>`;
    }).join("");

    const open = merchantOpen();
    const buyer = ui.buyer && player(ui.buyer) ? ui.buyer : state.players[0].id;
    const buyerKit = kitItems(buyer);
    const balance = economy(buyer).balance;
    const row = (item, slot) => {
      const owned = buyerKit[slot];
      const credit = tradeIn(owned);
      const cost = item.price - credit;
      const has = owned && owned.id === item.id;
      const afford = balance >= cost;
      return `<tr>
        <td><strong>${esc(item.name)}</strong><div class="muted" style="font-size:.85rem">${esc(item.text || "")}</div></td>
        <td>${slot === "weapon" ? weaponStats(item) : armourStats(item)}</td>
        <td class="num">${gr(item.price)}</td>
        <td class="num">${has ? '<span class="badge">Owned</span>' : open
          ? `<button class="btn small" data-action="buy-item" data-slot="${slot}" data-id="${item.id}" ${afford ? "" : "disabled"} title="${credit ? `Pays ${gr(cost)} after ${gr(credit)} for the old ${esc(owned.name)}` : ""}">${cost < 0 ? `Swap (get ${gr(-cost)})` : `Buy${credit ? ` (${gr(cost)})` : ""}`}</button>`
          : ""}</td>
      </tr>`;
    };

    return `
      <div class="card" style="margin-bottom:14px">
        <div class="row" style="align-items:center">
          <div style="flex:1;min-width:200px"><h2 style="margin-bottom:.2rem">Round ${state.round}</h2><div>${merchantLine()}</div></div>
          <button class="btn" data-action="next-round">Next round</button>
        </div>
        <p class="note" style="margin-bottom:0">Press <strong>Next round</strong> once every player has taken a turn. The merchant opens every ${merchantEvery()} rounds. Everyone starts with the same kit.</p>
      </div>
      <div class="grid-2">${kits}</div>
      <div class="card" style="margin-top:14px">
        <h2>The merchant's wares</h2>
        ${open ? `<div class="row" style="align-items:flex-end;margin-bottom:8px">
          <label class="field" style="flex:0 1 220px">Buying for<select data-buyer>${playerOptions(buyer)}</select></label>
          <p class="note" style="flex:1;margin:0">${esc(pname(buyer))} has ${gr(balance)}. Old gear is sold back for ${Math.round((RULES().sellBack || 0) * 100)}% of its price.</p>
        </div>` : `<p class="note">You can look, but nothing can be bought until the merchant opens on round ${state.round + roundsToMerchant()}.</p>`}
        <h3>Weapons</h3>
        <div class="table-scroll"><table><thead><tr><th>Weapon</th><th>Stats</th><th class="num">Price</th><th></th></tr></thead><tbody>${GEARDATA().weapons.map((w) => row(w, "weapon")).join("")}</tbody></table></div>
        <h3>Armour</h3>
        <div class="table-scroll"><table><thead><tr><th>Armour</th><th>Stats</th><th class="num">Price</th><th></th></tr></thead><tbody>${GEARDATA().armour.map((a) => row(a, "armour")).join("")}</tbody></table></div>
        <p class="note">Slash: d20 + weapon bonus must reach ${RULES().baseTarget} + the target's defence. Damage: the weapon's dice, minus what the target's armour blocks (less any pierce), at least ${RULES().minDamage}. All of these numbers live in <code>gear.js</code>.</p>
      </div>`;
  }

  function buyItem(slot, id) {
    const pid = ui.buyer && player(ui.buyer) ? ui.buyer : state.players[0].id;
    const item = slot === "weapon" ? weaponById(id) : armourById(id);
    if (!item || !merchantOpen()) return;
    const old = kitItems(pid)[slot];
    const credit = tradeIn(old);
    if (economy(pid).balance < item.price - credit) { toast("Not enough Groschen"); return; }
    commit(`${pname(pid)} buys ${item.name} for ${gr(item.price)}${credit ? ` and sells the ${old.name} for ${gr(credit)}` : ""}`, (st) => {
      const now = Date.now();
      st.txns.push({ id: uid(), ts: now, chapter: st.status, type: "purchase", playerId: pid, payeeId: null, amount: item.price, note: item.name });
      if (credit) st.txns.push({ id: uid(), ts: now, chapter: st.status, type: "sale", playerId: pid, payeeId: null, amount: credit, note: old.name });
      st.kit[pid] = Object.assign({}, kitOf(pid), { [slot]: item.id });
    });
    sfx("coins");
  }

  // ---------- combat ----------

  const pct = (x) => `${Math.round(x * 100)}%`;

  function combatantOptions(selected, { foes }) {
    const ps = state.players.map((p) => `<option value="p:${p.id}" ${selected === "p:" + p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const fs = foes ? `<optgroup label="Foes">${GEARDATA().foes.map((f) => `<option value="f:${f.id}" ${selected === "f:" + f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</optgroup>` : "";
    return foes ? `<optgroup label="Players">${ps}</optgroup>${fs}` : ps;
  }

  function fighterFromRef(ref) {
    const [kind, id] = String(ref).split(":");
    if (kind === "p" && player(id)) return playerFighter(id);
    if (kind === "f" && foeById(id)) return foeFighter(id);
    return null;
  }

  function oddsTable(A, B, rules, opts) {
    const side = (att, def) => {
      const hc = Combat.hitChance(att, def, rules);
      const dmg = Combat.damageStats(att, def, false, rules);
      const { mod, target } = Combat.slashTarget(att, def, rules);
      const need = Math.min(Math.max(target - mod, (rules.fumbleOn || 1) + 1), rules.critOn || 20);
      return { hc, dmg, mod, target, need, exp: Combat.expectedDamage(att, def, rules), blocked: Combat.armourAfterPierce(att, def) };
    };
    const a = side(A, B), b = side(B, A);
    const sim = Combat.simulate(A, B, rules, Object.assign({ n: 3000 }, opts));
    const col = (x, att, def) => `
      <td>
        <div><strong>${pct(x.hc.hit)}</strong> to hit <span class="muted">(roll ${x.need}+ on the d20: d20 ${x.mod >= 0 ? "+" : "−"} ${Math.abs(x.mod)} vs ${x.target})</span></div>
        <div>Damage <strong>${x.dmg.min}–${x.dmg.max}</strong> <span class="muted">(${esc(att.damage)} − ${x.blocked} blocked, min ${rules.minDamage})</span></div>
        <div>About <strong>${x.exp.toFixed(1)}</strong> damage per swing</div>
      </td>`;
    return `
      <div class="table-scroll"><table class="odds">
        <thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead>
        <tbody>
          <tr><th>Attacking</th>${col(a, A, B)}${col(b, B, A)}</tr>
          <tr><th>Chance to win</th><td><strong class="big-pct">${pct(sim.a)}</strong></td><td><strong class="big-pct">${pct(sim.b)}</strong></td></tr>
        </tbody>
      </table></div>
      <p class="note">${sim.draw >= 0.005 ? `Draw ${pct(sim.draw)}. ` : ""}Expected length: about ${sim.exchanges.toFixed(1)} exchange${sim.exchanges >= 1.5 ? "s" : ""}. Odds come from 3,000 simulated fights.</p>`;
  }

  function renderCombat() {
    if (typeof Combat === "undefined") return '<div class="card"><p class="empty">Combat maths failed to load.</p></div>';
    const rules = RULES();
    const c = state.combat;
    if (!c) {
      const mode = ui.combatMode || "tournament";
      const aRef = ui.combatA || `p:${state.players[0].id}`;
      const bDefault = mode === "tournament" ? `p:${(state.players[1] || state.players[0]).id}` : `f:${(GEARDATA().foes[0] || {}).id}`;
      let bRef = ui.combatB || bDefault;
      if (mode === "tournament" && !bRef.startsWith("p:")) bRef = bDefault;
      const A = fighterFromRef(aRef), B = fighterFromRef(bRef);
      const limit = mode === "tournament" ? rules.tournamentExchanges : rules.fightExchanges;
      return `
        <div class="card">
          <h2>Start a fight</h2>
          <form class="row" data-form="combat-start">
            <label class="field">Kind<select name="mode" data-combat="mode">
              <option value="tournament" ${mode === "tournament" ? "selected" : ""}>Tournament bout</option>
              <option value="fight" ${mode === "fight" ? "selected" : ""}>Fight</option>
            </select></label>
            <label class="field">Challenger<select name="a" data-combat="a">${combatantOptions(aRef, { foes: false })}</select></label>
            <label class="field">Opponent<select name="b" data-combat="b">${combatantOptions(bRef, { foes: mode === "fight" })}</select></label>
            <button class="btn" type="submit" ${aRef === bRef ? "disabled" : ""}>Begin</button>
          </form>
          <p class="note">${mode === "tournament"
            ? `A bout lasts until someone reaches 0 HP or ${limit} exchanges pass, then the most HP left wins. The winner earns ${rules.tournamentGlory} Glory.`
            : `${limit ? `A fight lasts up to ${limit} exchanges.` : "A fight lasts until someone drops."} Everyone starts at ${rules.hp} HP, and foes have their own HP.`}
            Each exchange, the challenger swings first, then the opponent.</p>
        </div>
        ${A && B && aRef !== bRef ? `<div class="card" style="margin-top:14px"><h2>The odds</h2>${oddsTable(A, B, rules, { exchanges: limit || 0 })}</div>` : ""}`;
    }

    const A = c.A, B = c.B;
    const limit = c.mode === "tournament" ? rules.tournamentExchanges : rules.fightExchanges;
    const exchange = Math.floor(c.attacks / 2) + 1;
    const [att, def] = c.next === "a" ? [A, B] : [B, A];
    const { mod, target } = Combat.slashTarget(att, def, rules);
    const dice = Combat.parseDice(att.damage);
    const hpBar = (f, hp) => `
      <div class="hp">
        <div class="row" style="align-items:baseline"><strong style="flex:1">${esc(f.name)}</strong><span>${Math.max(0, hp)} / ${f.hp} HP</span></div>
        <div class="hp-track"><span class="hp-fill" style="width:${Math.max(0, hp) / f.hp * 100}%"></span></div>
      </div>`;

    let step;
    if (c.over) {
      const winner = c.result === "a" ? A : c.result === "b" ? B : null;
      const winnerRef = c.result === "a" ? c.aRef : c.result === "b" ? c.bRef : null;
      const canAward = c.mode === "tournament" && winnerRef && winnerRef.startsWith("p:") && !c.awarded;
      step = `
        <div class="verdict">
          <div class="kicker">${c.mode === "tournament" ? "The bout is decided" : "The fight is over"}</div>
          <div class="big">${winner ? `${esc(winner.name)} wins` : "A draw"}</div>
          <p class="muted">${esc(c.endReason || "")}</p>
          <div class="row" style="justify-content:center">
            ${canAward ? `<button class="btn" data-action="combat-award">Award ${rules.tournamentGlory} Glory to ${esc(winner.name)}</button>` : ""}
            ${c.awarded ? '<span class="badge gold">Glory awarded</span>' : ""}
            <button class="btn ghost" data-action="combat-close">Close the fight</button>
          </div>
        </div>`;
    } else if (!c.pending) {
      step = `
        <h3>Roll 1 of 2 · ${esc(att.name)} slashes at ${esc(def.name)}</h3>
        <p>Roll a d20. It hits on <strong>${Math.min(Math.max(target - mod, (rules.fumbleOn || 1) + 1), rules.critOn)}+</strong> <span class="muted">(d20 ${mod >= 0 ? "+" : "−"} ${Math.abs(mod)} must reach ${target}; ${rules.critOn} always hits and doubles the damage dice, ${rules.fumbleOn} always misses)</span>.</p>
        <form class="row" data-form="combat-slash">
          <label class="field" style="flex:0 1 120px">d20 roll<input type="number" name="roll" min="1" max="${rules.hitDie}" required inputmode="numeric"></label>
          <button class="btn" type="submit">Resolve</button>
          <button class="btn ghost" type="button" data-action="combat-auto">Roll for me</button>
        </form>`;
    } else {
      const n = dice.count * (c.pending.crit ? 2 : 1);
      step = `
        <h3>Roll 2 of 2 · damage from ${esc(att.name)}</h3>
        <p>${c.pending.crit ? "<strong>Critical!</strong> " : ""}The slash hit. Roll <strong>${n}d${dice.sides}</strong> and enter the total. ${dice.bonus ? `${dice.bonus > 0 ? "+" : "−"}${Math.abs(dice.bonus)} is added, ` : ""}${Combat.armourAfterPierce(att, def)} is blocked by ${esc(def.name)}'s armour.</p>
        <form class="row" data-form="combat-damage">
          <label class="field" style="flex:0 1 120px">Dice total<input type="number" name="roll" min="${n}" max="${n * dice.sides}" required inputmode="numeric"></label>
          <button class="btn" type="submit">Resolve</button>
          <button class="btn ghost" type="button" data-action="combat-auto">Roll for me</button>
        </form>`;
    }

    const log = c.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("");
    const attacksDone = c.attacks;
    return `
      <div class="grid-2">
        <div class="card">
          <h2>${c.mode === "tournament" ? "Tournament bout" : "Fight"} · exchange ${Math.min(exchange, limit || exchange)}${limit ? ` of ${limit}` : ""}</h2>
          ${hpBar(A, c.hpA)}${hpBar(B, c.hpB)}
          <div class="combat-step">${step}</div>
          ${!c.over ? '<p class="note"><button class="link" data-action="combat-close">Abandon this fight</button></p>' : ""}
        </div>
        <div class="card">
          <h2>The maths</h2>
          ${log ? `<ol class="combat-log" reversed>${log}</ol>` : '<p class="muted">Each roll and its calculation will appear here.</p>'}
          ${!c.over ? `<h3>Odds from here</h3>${oddsTable(A, B, rules, { hpA: c.hpA, hpB: c.hpB, next: c.next, exchanges: limit || 0, attacksDone })}` : ""}
        </div>
      </div>`;
  }

  function startCombat(mode, aRef, bRef) {
    const A = fighterFromRef(aRef), B = fighterFromRef(bRef);
    if (!A || !B || aRef === bRef) return;
    commit(`${mode === "tournament" ? "Tournament bout" : "Fight"}: ${A.name} against ${B.name}`, (st) => {
      st.combat = { id: uid(), mode, aRef, bRef, A, B, hpA: A.hp, hpB: B.hp, attacks: 0, next: "a", pending: null, log: [], over: false, result: null, awarded: false };
    });
    sfx("bell");
  }

  function finishIfDone(c) {
    const rules = RULES();
    const limit = c.mode === "tournament" ? rules.tournamentExchanges : rules.fightExchanges;
    if (c.hpA <= 0 || c.hpB <= 0) {
      c.over = true;
      c.result = c.hpA > 0 ? "a" : c.hpB > 0 ? "b" : "draw";
      c.endReason = `${c.hpA <= 0 ? c.A.name : c.B.name} has been beaten down.`;
    } else if (limit && c.attacks >= limit * 2) {
      c.over = true;
      c.result = c.hpA > c.hpB ? "a" : c.hpB > c.hpA ? "b" : "draw";
      c.endReason = `${limit} exchanges done: ${c.A.name} ${c.hpA} HP, ${c.B.name} ${c.hpB} HP.`;
    }
  }

  function combatSlash(natural) {
    const c = state.combat;
    const rules = RULES();
    if (!c || c.over || c.pending || !(natural >= 1 && natural <= rules.hitDie)) { toast(`Enter a d20 roll from 1 to ${rules.hitDie}`); return false; }
    const [att, def] = c.next === "a" ? [c.A, c.B] : [c.B, c.A];
    const s = Combat.resolveSlash(att, def, natural, rules);
    const maths = `${att.name} slashes: ${natural} ${s.mod >= 0 ? "+" : "−"} ${Math.abs(s.mod)} = ${s.total} vs ${s.target}`;
    const verdict = s.fumble ? "a natural 1, a clean miss" : s.crit ? "a natural 20, a critical hit" : s.hit ? "hit" : "miss";
    commit(`${maths}: ${verdict}`, (st) => {
      const cc = st.combat;
      cc.log.push(`${maths} → ${verdict}.`);
      if (s.hit) cc.pending = { crit: s.crit };
      else { cc.attacks++; cc.next = cc.next === "a" ? "b" : "a"; finishIfDone(cc); }
    });
    sfx(s.hit ? (s.crit ? "glory" : "flip") : "undo");
    if (state.combat.over) sfx(state.combat.result === "draw" ? "bell" : "triumph", 400);
    return true;
  }

  function combatDamage(diceSum) {
    const c = state.combat;
    if (!c || c.over || !c.pending) return false;
    const rules = RULES();
    const [att, def] = c.next === "a" ? [c.A, c.B] : [c.B, c.A];
    const dice = Combat.parseDice(att.damage);
    const n = dice.count * (c.pending.crit ? 2 : 1);
    if (!(diceSum >= n && diceSum <= n * dice.sides)) { toast(`Enter a total from ${n} to ${n * dice.sides}`); return false; }
    const d = Combat.resolveDamage(att, def, diceSum, rules);
    const hpLeft = (c.next === "a" ? c.hpB : c.hpA) - d.damage;
    const maths = `damage ${diceSum}${d.bonus ? ` ${d.bonus > 0 ? "+" : "−"} ${Math.abs(d.bonus)}` : ""} − ${d.blocked} blocked = ${d.damage}${d.damage === rules.minDamage && d.raw - d.blocked < rules.minDamage ? " (minimum)" : ""}`;
    commit(`${att.name} wounds ${def.name}: ${maths}, ${Math.max(0, hpLeft)} HP left`, (st) => {
      const cc = st.combat;
      if (cc.next === "a") cc.hpB -= d.damage; else cc.hpA -= d.damage;
      cc.log.push(`${att.name} ${maths} → ${def.name} has ${Math.max(0, hpLeft)} HP.`);
      cc.pending = null;
      cc.attacks++;
      cc.next = cc.next === "a" ? "b" : "a";
      finishIfDone(cc);
    });
    sfx("loss");
    if (state.combat.over) sfx(state.combat.result === "draw" ? "bell" : "triumph", 400);
    return true;
  }

  function combatAuto() {
    const c = state.combat;
    if (!c || c.over) return;
    const rules = RULES();
    if (!c.pending) combatSlash(Combat.rollDie(rules.hitDie));
    else {
      const att = c.next === "a" ? c.A : c.B;
      combatDamage(Combat.rollDamageDice(att, c.pending.crit));
    }
  }

  // ---------- post-game report ----------

  const ANSWER_OPTIONS = ["", "Yes", "Partly", "No", "Not sure"];

  const REVIEW_QUESTIONS = [
    { id: "q1", text: "Did players choose quest actions even when shopping or money-making options were available?",
      evidence: (d) => `${d.gloryCount.quest} significant quest contribution${d.gloryCount.quest === 1 ? "" : "s"} and ${d.clueCount} clue${d.clueCount === 1 ? "" : "s"} recorded, against ${d.purchaseCount} merchant purchase${d.purchaseCount === 1 ? "" : "s"}.` },
    { id: "q2", text: "Did spending clues in the finale feel valuable?",
      evidence: (d) => `${d.spentCount} of ${d.clueCount} clues spent on the final check${d.finalCheck ? `; ${d.finalCheck}` : ""}.` },
    { id: "q3", text: "Did any player become so wealthy that money stopped being a meaningful decision?",
      evidence: (d) => d.richest ? `${d.richest.name} finished richest with ${gr(d.richest.balance)} (${d.richest.ratio}× their start). Gap to the poorest player: ${gr(d.wealthGap)}. ${gr(d.merchantSpend)} was spent at the merchant.` : "No players." },
    { id: "q4", text: "Did the Glory leader reflect meaningful RPG contribution, rather than luck or wealth?",
      evidence: (d) => !d.leaders.length ? "No Glory was awarded."
        : `${d.leaders.length > 1 ? "Tied leaders: " : ""}${d.leaders.map((l) => `${l.name} led with ${l.glory} Glory (${l.breakdown || "no entries"}) and finished ${l.wealthRank} in wealth`).join("; ")}.` },
    { id: "q5", text: "Were ordinary encounters consistently resolved within a few minutes?",
      evidence: (d) => d.drawGapMedian != null ? `${d.drawCount} scenario cards drawn; a median of ${d.drawGapMedian} min between draws over a ${d.sessionMinutes}-minute session.` : `${d.drawCount} scenario card${d.drawCount === 1 ? "" : "s"} drawn over a ${d.sessionMinutes}-minute session. Draw cards in the app to measure encounter pace.` },
  ];

  const ordinal = (n) => n + ({ 1: "st", 2: "nd", 3: "rd" }[n] || "th"); // at most four players
  const median = (xs) => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  function reportData() {
    const econ = state.players.map((p) => ({ p, e: economy(p.id), glory: gloryOf(p.id) }));
    const sum = (k) => econ.reduce((a, x) => a + x.e[k], 0);
    const totals = { rent: sum("rentPaid"), eventGain: sum("eventGain"), eventLoss: sum("eventLoss"), quest: sum("quest"), purchase: sum("purchase"), sold: sum("sold"), otherGain: sum("otherGain") };
    const income = [
      ...(totals.rent ? [{ id: "rent", label: "Rent", value: totals.rent, advice: "Rent is driving wealth. Consider lowering rent before touching other prices." }] : []),
      { id: "events", label: "Event money", value: totals.eventGain, advice: "Events are paying out the most. Use the lower end of event reward ranges." },
      { id: "quest", label: "Quest rewards", value: totals.quest, advice: "Quest rewards are the biggest earner. Keep them noticeable but smaller." },
      { id: "sold", label: "Gear sold", value: totals.sold, advice: "Selling old gear is paying well. Consider a lower sell-back share in gear.js." },
      { id: "other", label: "Other income", value: totals.otherGain, advice: "Unlisted income is the biggest earner. Check what was recorded as other." },
    ];
    const incomeTotal = income.reduce((a, x) => a + x.value, 0);
    const top = incomeTotal ? income.slice().sort((a, b) => b.value - a.value)[0] : null;

    const gloryCount = {}, glorySum = {};
    for (const c of GLORY_CATEGORIES) { gloryCount[c.id] = 0; glorySum[c.id] = 0; }
    for (const g of state.glory) { gloryCount[g.category] = (gloryCount[g.category] || 0) + 1; glorySum[g.category] = (glorySum[g.category] || 0) + g.amount; }

    const byWealth = econ.slice().sort((a, b) => b.e.balance - a.e.balance);
    const richestX = byWealth[0];
    const leaders = gloryLeaders();
    const leaderXs = leaders.length && gloryOf(leaders[0].id) > 0 ? leaders.map((l) => econ.find((x) => x.p.id === l.id)) : [];

    const f = state.finale || {};
    const spentCount = state.clues.filter((c) => c.spent).length;
    const bonus = Math.min(BONUS_CAP, (Number(f.otherBonus) || 0) + spentCount);
    let finalCheck = "";
    if (f.roll !== "" && f.roll != null) {
      const total = Number(f.roll) + bonus;
      finalCheck = `final check ${f.roll} + ${bonus} = ${total}${f.target !== "" && f.target != null ? ` against ${f.target} (${total >= Number(f.target) ? "passed" : "failed"})` : ""}`;
    }

    const drawTimes = state.draws.map((d) => d.ts).sort((a, b) => a - b);
    const gaps = drawTimes.slice(1).map((t, i) => (t - drawTimes[i]) / 60000);
    const gapMedian = median(gaps);
    const lastTs = state.log.length ? state.log[0].ts : state.createdAt;

    return {
      econ, totals, income, incomeTotal, top, gloryCount, glorySum,
      clueCount: state.clues.length, spentCount, finalCheck,
      purchaseCount: state.txns.filter((t) => t.type === "purchase").length,
      merchantSpend: totals.purchase,
      richest: richestX ? { name: richestX.p.name, balance: richestX.e.balance, ratio: richestX.e.start ? (richestX.e.balance / richestX.e.start).toFixed(1) : "–" } : null,
      wealthGap: byWealth.length ? byWealth[0].e.balance - byWealth[byWealth.length - 1].e.balance : 0,
      leaders: leaderXs.map((lx) => ({
        name: lx.p.name,
        glory: lx.glory,
        breakdown: GLORY_CATEGORIES.map((c) => {
          const n = state.glory.filter((g) => g.playerId === lx.p.id && g.category === c.id).reduce((a, g) => a + g.amount, 0);
          return n ? `${n} from ${c.label.toLowerCase()}` : "";
        }).filter(Boolean).join(", "),
        wealthRank: ordinal(byWealth.findIndex((x) => x.p.id === lx.p.id) + 1),
      })),
      drawCount: state.draws.length,
      drawGapMedian: gapMedian == null ? null : Math.round(gapMedian * 10) / 10,
      sessionMinutes: Math.max(0, Math.round((lastTs - state.createdAt) / 60000)),
    };
  }

  function renderReport() {
    const d = reportData();
    const answers = (state.report && state.report.answers) || {};
    const notes = (state.report && state.report.notes) || {};
    const champion = state.status === "success" ? gloryLeaders().map((p) => esc(p.name)).join(" & ") : "";
    const tile = (label, value, cls = "") => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div></div>`;

    const bars = d.income.map((x) => {
      const pct = d.incomeTotal ? Math.round((x.value / d.incomeTotal) * 100) : 0;
      return `<div class="bar-row"><span class="bar-label">${x.label}</span><span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-value">${gr(x.value)} · ${pct}%</span></div>`;
    }).join("");

    const gloryRow = GLORY_CATEGORIES.filter((c) => d.glorySum[c.id]).map((c) => `<span class="badge">${c.label}: ${signed(d.glorySum[c.id])}</span>`).join(" ");

    const questions = REVIEW_QUESTIONS.map((q, i) => `
      <div class="question">
        <div class="question-head"><span class="step-num">${i + 1}</span><strong>${q.text}</strong></div>
        <p class="note">From the records: ${esc(q.evidence(d))}</p>
        <div class="row">
          <label class="field" style="flex:0 1 140px">Answer
            <select data-report="answers:${q.id}">${ANSWER_OPTIONS.map((o) => `<option value="${o}" ${answers[q.id] === o ? "selected" : ""}>${o || "Choose…"}</option>`).join("")}</select>
          </label>
          <label class="field" style="flex:3 1 240px">Notes<textarea rows="2" data-report="notes:${q.id}" placeholder="What did the table say?">${esc(notes[q.id] || "")}</textarea></label>
        </div>
      </div>`).join("");

    return `
      <div class="card report-head">
        <div class="kicker">Post-game report</div>
        <div class="big ${state.status === "success" ? "pos" : state.status === "unresolved" ? "neg" : ""}">${isEnded() ? (state.status === "success" ? "The party succeeded" : "The story remains unresolved") : `Still in ${statusLabel(state.status)}`}</div>
        ${champion ? `<div>Champion of Bohemia: <strong style="color:var(--gold)">♛ ${champion}</strong></div>` : ""}
        <div class="muted">${state.players.length} players · ${d.sessionMinutes} minutes recorded · ${d.clueCount} clues · ${d.drawCount} scenario cards</div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Money records</h2>
        <div class="stats">
          ${tile("Spent at the merchant", gr(d.totals.purchase))}
          ${tile("Event money gained", gr(d.totals.eventGain), "pos")}
          ${tile("Event money lost", gr(d.totals.eventLoss), "neg")}
          ${tile("Quest rewards", gr(d.totals.quest), "pos")}
          ${d.totals.rent ? tile("Rent paid", gr(d.totals.rent)) : tile("Gear sold back", gr(d.totals.sold), "pos")}
        </div>
        <h3>Where players' income came from</h3>
        ${d.incomeTotal ? `<div class="bars">${bars}</div><p class="note">Largest source: <strong>${d.top.label}</strong>. ${d.top.advice}</p>` : '<div class="empty">No income recorded yet.</div>'}
        <h3>Starting and ending balances</h3>
        ${renderReportTable()}
        <h3>Glory by source</h3>
        <div>${gloryRow || '<span class="muted">No Glory awarded.</span>'}</div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>The review's five questions</h2>
        <p class="note">Each question shows what the app recorded. Add the table's answer and any notes, then export the report.</p>
        ${questions}
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Export</h2>
        <div class="row">
          <button class="btn" data-action="export-report">Download report (.md)</button>
          <button class="btn ghost" data-action="copy-full-report">Copy report</button>
          <button class="btn ghost" data-action="export-csv">Download ledger (.csv)</button>
          <button class="btn ghost" data-action="export-json">Save chronicle (.json)</button>
        </div>
      </div>`;
  }

  function reportMarkdown() {
    const d = reportData();
    const answers = (state.report && state.report.answers) || {};
    const notes = (state.report && state.report.notes) || {};
    const L = [];
    L.push(`# KCD2 RPG Monopoly: post-game report`, "");
    L.push(`**Date:** ${new Date(state.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}  `);
    L.push(`**Players:** ${state.players.map((p) => p.name).join(", ")}  `);
    L.push(`**Campaign:** ${statusLabel(state.status)}  `);
    if (state.status === "success") L.push(`**Champion of Bohemia:** ${gloryLeaders().map((p) => p.name).join(" & ")}  `);
    L.push(`**Session recorded:** ${d.sessionMinutes} minutes, ${d.clueCount} clues (${d.spentCount} spent), ${d.drawCount} scenario cards`, "");
    L.push(`## Money records`, "");
    L.push(`| Spent at merchant | Gear sold back | Event money gained | Event money lost | Quest rewards |${d.totals.rent ? " Rent paid |" : ""}`);
    L.push(`|---:|---:|---:|---:|---:|${d.totals.rent ? "---:|" : ""}`);
    L.push(`| ${d.totals.purchase} | ${d.totals.sold} | ${d.totals.eventGain} | ${d.totals.eventLoss} | ${d.totals.quest} |${d.totals.rent ? ` ${d.totals.rent} |` : ""}`, "");
    if (d.incomeTotal) {
      L.push(`**Where income came from:** ${d.income.map((x) => `${x.label} ${Math.round((x.value / d.incomeTotal) * 100)}%`).join(", ")}  `);
      L.push(`**Largest source:** ${d.top.label}. ${d.top.advice}`, "");
    }
    L.push(`| Player | Glory | Clues | Weapon | Armour | Start | End | Merchant | Sold | Event net | Quest rewards |`);
    L.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
    for (const { p, e, glory } of d.econ.slice().sort((a, b) => b.glory - a.glory)) {
      const clues = state.clues.filter((c) => c.discovererId === p.id).length;
      const k = kitItems(p.id);
      L.push(`| ${p.name} | ${glory} | ${clues} | ${k.weapon ? k.weapon.name : "–"} | ${k.armour ? k.armour.name : "–"} | ${e.start} | ${e.balance} | ${e.purchase} | ${e.sold} | ${e.eventGain - e.eventLoss} | ${e.quest} |`);
    }
    L.push("", `## The review's five questions`, "");
    REVIEW_QUESTIONS.forEach((q, i) => {
      L.push(`${i + 1}. **${q.text}**  `);
      L.push(`   Answer: ${answers[q.id] || "_not answered_"}  `);
      L.push(`   Records: ${q.evidence(d)}  `);
      if (notes[q.id]) L.push(`   Notes: ${notes[q.id].replace(/\n+/g, " ")}`);
      L.push("");
    });
    return L.join("\n");
  }

  function summaryText() {
    const lines = [];
    lines.push("KCD2 RPG Monopoly: session record");
    lines.push(`Campaign: ${statusLabel(state.status)}`);
    if (state.status === "success") lines.push(`Champion of Bohemia: ${gloryLeaders().map((p) => p.name).join(" & ")}`);
    lines.push(`Clues: ${state.clues.length} found, ${state.clues.filter((c) => c.spent).length} spent at finale`);
    lines.push("");
    for (const { p, glory } of standings()) {
      const e = economy(p.id);
      lines.push(`${p.name}: Glory ${glory}; start ${e.start} gr, end ${e.balance} gr; merchant ${e.purchase}, sold ${e.sold}; events +${e.eventGain}/−${e.eventLoss}; quest rewards ${e.quest}`);
    }
    return lines.join("\n");
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function csv() {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const out = [["time", "chapter", "type", "player", "paid_to", "amount_gr", "note"].join(",")];
    for (const t of state.txns) {
      out.push([new Date(t.ts).toISOString(), statusLabel(t.chapter), (txnType(t.type) || {}).label || t.type, pname(t.playerId), t.payeeId ? pname(t.payeeId) : "", t.amount, t.note].map(q).join(","));
    }
    return out.join("\n");
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- events ----------

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;

    if (a === "open-guide") { openGuide(); return; }
    if (a === "open-live") { openLive(); return; }
    if (a === "close-live") { $("#live").close(); return; }
    if (a === "live-host") { window.Sync.host(); return; }
    if (a === "live-leave") { window.Sync.leave(); return; }
    if (a === "live-share") {
      const link = window.Sync.joinLink();
      if (navigator.share) navigator.share({ title: "Join our Chronicle of Bohemia game", text: `Join code ${window.Sync.info().code}`, url: link }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Join link copied"), () => toast(link));
      else toast(link);
      return;
    }
    if (a === "close-guide") { $("#guide").close(); return; }
    if (a === "draw-card") { drawCard(el.dataset.player); return; }
    if (a === "next-round") {
      const next = state.round + 1;
      const opens = next % merchantEvery() === 0;
      commit(`Round ${next} begins${opens ? ". The merchant is open" : ""}`, (st) => { st.round = next; });
      sfx(opens ? "coins" : "bell");
      if (opens) toast("The merchant is open this round");
      return;
    }
    if (a === "buy-item") { buyItem(el.dataset.slot, el.dataset.id); return; }
    if (a === "combat-auto") { combatAuto(); return; }
    if (a === "combat-close") {
      if (state.combat && !state.combat.over && !confirm("Abandon this fight? Nothing more will be recorded for it.")) return;
      commit(state.combat && !state.combat.over ? "Fight abandoned" : "", (st) => { st.combat = null; });
      return;
    }
    if (a === "combat-award") {
      const c = state.combat;
      if (!c || !c.over || c.awarded || c.mode !== "tournament") return;
      const ref = c.result === "a" ? c.aRef : c.result === "b" ? c.bRef : "";
      const pid = ref.startsWith("p:") ? ref.slice(2) : null;
      if (!pid || !player(pid)) return;
      const amount = RULES().tournamentGlory || 2;
      const loser = c.result === "a" ? c.B.name : c.A.name;
      commit(`${pname(pid)} wins the tournament bout against ${loser} (+${amount} Glory)`, (st) => {
        st.glory.push({ id: uid(), ts: Date.now(), chapter: st.status, playerId: pid, category: "tournament", amount, note: `Bout against ${loser}` });
        st.combat.awarded = true;
      });
      sfx("glory");
      return;
    }
    if (a === "tab") { ui.tab = el.dataset.tab; render(); return; }
    if (a === "undo") { if (undoStack.length) sfx("undo"); undo(); return; }
    if (a === "toggle-sound") {
      if (window.SFX) { window.SFX.setMuted(!window.SFX.isMuted()); syncSoundToggle(); sfx("coins"); }
      return;
    }

    if (a === "set-status") {
      const s = el.dataset.status;
      if (s === state.status) return;
      if ((s === "success" || s === "unresolved") && !confirm(`Declare the campaign ${s === "success" ? "a success" : "unresolved"}?`)) return;
      commit(`Campaign status set to ${statusLabel(s)}`, (st) => { st.status = s; });
      sfx(s === "success" ? "triumph" : s === "unresolved" ? "lament" : "bell");
      if (s === "success" || s === "unresolved") { ui.tab = "finale"; render(); }
      return;
    }

    if (a === "del-glory") {
      const g = state.glory.find((x) => x.id === id);
      if (!g) return;
      commit(`Removed ${signed(g.amount)} Glory from ${pname(g.playerId)}`, (st) => { st.glory = st.glory.filter((x) => x.id !== id); });
      return;
    }

    if (a === "del-clue") {
      const c = state.clues.find((x) => x.id === id);
      if (!c || !confirm(`Remove the clue "${c.title}" and its Glory?`)) return;
      commit(`Removed clue "${c.title}"`, (st) => {
        st.clues = st.clues.filter((x) => x.id !== id);
        st.glory = st.glory.filter((g) => g.clueId !== id);
      });
      return;
    }

    if (a === "del-txn") {
      const t = state.txns.find((x) => x.id === id);
      if (!t) return;
      commit(`Removed ${(txnType(t.type) || {}).label || t.type} of ${gr(t.amount)} (${pname(t.playerId)})`, (st) => { st.txns = st.txns.filter((x) => x.id !== id); });
      return;
    }

    if (a === "pick-clue") {
      if (el.checked) ui.selectedClues.add(id); else ui.selectedClues.delete(id);
      render();
      return;
    }

    if (a === "spend-clues") {
      const ids = [...ui.selectedClues];
      if (!ids.length) return;
      const names = state.clues.filter((c) => ids.includes(c.id)).map((c) => c.title);
      commit(`Spent ${ids.length} clue${ids.length === 1 ? "" : "s"} on the final check: ${names.join("; ")}`, (st) => {
        for (const c of st.clues) if (ids.includes(c.id)) { c.spent = true; c.spentAt = Date.now(); }
      });
      ui.selectedClues.clear();
      render();
      sfx("clue");
      return;
    }

    if (a === "copy-report") {
      const text = summaryText();
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast("Summary copied"))
        .catch(() => download(`kcd2-summary-${stamp()}.txt`, text, "text/plain"));
      return;
    }
    if (a === "copy-full-report") {
      const text = reportMarkdown();
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast("Report copied"))
        .catch(() => download(`kcd2-report-${stamp()}.md`, text, "text/markdown"));
      return;
    }
    if (a === "export-report") { download(`kcd2-report-${stamp()}.md`, reportMarkdown(), "text/markdown"); return; }
    if (a === "export-csv") { download(`kcd2-ledger-${stamp()}.csv`, csv(), "text/csv"); return; }
    if (a === "export-json") { download(`kcd2-chronicle-${stamp()}.json`, JSON.stringify(state, null, 2), "application/json"); return; }

    if (a === "new-game") {
      if (!confirm("Begin a new game? The current chronicle will be cleared from this browser. Save it first if you want to keep it.")) return;
      undoStack.length = 0;
      state = blankState();
      ui = { tab: "campaign", selectedClues: new Set() };
      save();
      render();
    }
  });

  document.addEventListener("submit", (ev) => {
    const form = ev.target;
    const kind = form.dataset.form;
    if (!kind) return;
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());

    if (kind === "combat-start") { startCombat(f.mode, f.a, f.b); return; }
    if (kind === "combat-slash") { combatSlash(Math.trunc(Number(f.roll))); return; }
    if (kind === "combat-damage") { combatDamage(Math.trunc(Number(f.roll))); return; }

    if (kind === "live-join") {
      if (state.players.length && !confirm("Joining replaces the game on this phone with the host's game. Continue?")) return;
      ui.joinCode = "";
      window.Sync.join(f.code);
      return;
    }

    if (kind === "setup") {
      const players = [0, 1, 2, 3]
        .map((i) => ({ id: uid(), name: (f["name" + i] || "").trim(), color: f["color" + i], startCash: Math.max(0, Number(f["cash" + i]) || 0) }))
        .filter((p) => p.name);
      if (players.length < 2) { toast("At least two players are needed"); return; }
      commit(`The party gathers: ${players.map((p) => p.name).join(", ")}`, (st) => { st.players = players; st.createdAt = Date.now(); });
      return;
    }

    if (kind === "glory") {
      const amount = Math.trunc(Number(f.amount));
      if (!amount) { toast("Enter a Glory amount"); return; }
      const cat = gloryCat(f.category);
      commit(`${pname(f.playerId)} ${amount > 0 ? "earns" : "loses"} ${Math.abs(amount)} Glory: ${cat.label}${f.note ? ` (${f.note.trim()})` : ""}`, (st) => {
        st.glory.push({ id: uid(), ts: Date.now(), chapter: st.status, playerId: f.playerId, category: f.category, amount, note: (f.note || "").trim() });
      });
      sfx(amount > 0 ? "glory" : "loss");
      toast(`${signed(amount)} Glory to ${pname(f.playerId)}`);
      return;
    }

    if (kind === "clue") {
      const title = (f.title || "").trim();
      if (!title) return;
      const glory = Math.max(0, Math.trunc(Number(f.glory) || 0));
      const clueId = uid();
      commit(`${pname(f.discovererId)} discovers a clue: ${title}${glory ? ` (+${glory} Glory)` : ""}`, (st) => {
        st.clues.push({ id: clueId, ts: Date.now(), title, discovererId: f.discovererId, chapter: f.chapter, glory, spent: false });
        if (glory) st.glory.push({ id: uid(), ts: Date.now(), chapter: f.chapter, playerId: f.discovererId, category: "clue", amount: glory, note: title, clueId });
      });
      sfx("clue");
      toast("Clue added to the party's evidence");
      return;
    }

    if (kind === "txn") {
      const amount = Math.trunc(Number(f.amount));
      if (!(amount > 0)) { toast("Enter an amount in Groschen"); return; }
      const tt = txnType(f.type);
      if (tt.needsPayee && f.payeeId === f.playerId) { toast("A player cannot pay rent to themselves"); return; }
      const who = tt.needsPayee ? `${pname(f.playerId)} pays ${pname(f.payeeId)}` : pname(f.playerId);
      commit(`${tt.label}: ${who}, ${gr(amount)}${f.note ? ` (${f.note.trim()})` : ""}`, (st) => {
        st.txns.push({ id: uid(), ts: Date.now(), chapter: st.status, type: f.type, playerId: f.playerId, payeeId: tt.needsPayee ? f.payeeId : null, amount, note: (f.note || "").trim() });
      });
      sfx(tt.sign > 0 || tt.needsPayee ? "coins" : "loss");
      toast("Recorded in the ledger");
    }
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.matches("[data-sync-amount]")) {
      const opt = el.selectedOptions[0];
      const amt = el.form.querySelector('[name="amount"]');
      if (opt && amt) amt.value = opt.dataset.amount;
    }
    if (el.matches("[data-txn-type]")) syncPayee(el.form);
    if (el.matches("[data-buyer]")) { ui.buyer = el.value; render(); return; }
    if (el.matches("[data-combat]")) {
      const key = el.dataset.combat;
      if (key === "mode") { ui.combatMode = el.value; ui.combatB = null; }
      else ui["combat" + key.toUpperCase()] = el.value;
      render();
      return;
    }
    if (el.matches("[data-report]")) {
      const [kind, q] = el.dataset.report.split(":");
      state.report = state.report || { answers: {}, notes: {} };
      state.report[kind][q] = el.value;
      save();
      if (kind === "answers") render();
      return;
    }
    if (el.matches("[data-finale]")) {
      const key = el.dataset.finale;
      let v = el.value;
      if (key === "otherBonus") v = Math.min(BONUS_CAP, Math.max(0, Math.trunc(Number(v) || 0)));
      state.finale[key] = v;
      save();
      render();
    }
    if (el.id === "import-file" && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.players)) throw new Error("bad file");
          undoStack.push(JSON.stringify(state));
          state = Object.assign(blankState(), data);
          save();
          render();
          toast("Chronicle loaded");
        } catch (e) { toast("That file is not a chronicle"); }
        el.value = "";
      };
      reader.readAsText(el.files[0]);
    }
  });

  function syncPayee(form) {
    if (!form) return;
    const type = form.querySelector("[data-txn-type]");
    const payee = form.querySelector("[data-payee]");
    if (type && payee) payee.hidden = !txnType(type.value).needsPayee;
  }

  // Keep the rent "paid to" field in step with the selected type after each render.
  const observer = new MutationObserver(() => syncPayee(document.querySelector('form[data-form="txn"]')));
  observer.observe(document.getElementById("app"), { childList: true });

  // ---------- live play ----------

  let pendingRender = false;
  const editingInApp = () => {
    const el = document.activeElement;
    return el && $("#app").contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  };

  // Hooks for sync.js: hand over the game, and take in a change from another phone.
  window.KCD2 = {
    getState: () => state,
    applyRemote(incoming) {
      const prevDraw = state.draws && state.draws[0] && state.draws[0].id;
      state = Object.assign(blankState(), incoming);
      undoStack.length = 0; // undo only covers this device's own steps since the last shared change
      ui.selectedClues.clear();
      saveLocal();
      const draw = state.draws[0];
      if (draw && draw.id !== prevDraw) { ui.flipId = draw.id; sfx("flip"); }
      // Don't wipe out something a player is typing; redraw when they leave the field.
      if (editingInApp()) pendingRender = true; else render();
      ui.flipId = null;
      renderLiveIndicator();
    },
  };

  document.addEventListener("focusout", () => {
    if (!pendingRender) return;
    setTimeout(() => { if (pendingRender && !editingInApp()) { pendingRender = false; render(); } }, 0);
  });

  const LIVE_TEXT = {
    starting: "Opening the game for other phones…",
    hosting: "Your game is open. Other phones can join with this code.",
    connecting: "Connecting to the host…",
    joined: "Connected. Changes on any phone appear on every phone.",
    reconnecting: "Lost the host for a moment. Reconnecting…",
  };

  function renderLive() {
    const body = $("#live-body");
    if (!body || !window.Sync) return;
    const info = window.Sync.info();
    let html;
    if (!info.role) {
      html = `
        ${info.status === "error" ? `<p class="live-error">${esc(info.detail)}</p>` : ""}
        <p>Everyone can follow and update the same game on their own phone. One phone hosts, and the others join with its code.</p>
        <div class="live-options">
          <div class="live-option">
            <h3>Host this game</h3>
            <p class="note">Shares the game on this device${state.players.length ? ` (${state.players.map((p) => esc(p.name)).join(", ")})` : ""}. Keep this screen open while you play.</p>
            <button class="btn" data-action="live-host">Host this game</button>
          </div>
          <div class="live-option">
            <h3>Join a game</h3>
            <form class="row" data-form="live-join">
              <label class="field">Code from the host<input name="code" class="live-code-input" maxlength="8" autocomplete="off" autocapitalize="characters" value="${esc(ui.joinCode || "")}" required></label>
              <button class="btn" type="submit">Join</button>
            </form>
            ${state.players.length ? '<p class="note">Joining replaces the game on this phone with the host\'s game.</p>' : ""}
          </div>
        </div>
        <p class="note">Phones connect directly to each other through a free public service, with nothing to set up. Your game isn't stored online.</p>`;
    } else if (info.role === "host") {
      const link = window.Sync.joinLink();
      html = `
        <p>${esc(info.detail || LIVE_TEXT[info.status] || "")}</p>
        <div class="live-code">${esc(info.code)}</div>
        <p class="muted" style="text-align:center">${info.guests} other phone${info.guests === 1 ? "" : "s"} connected</p>
        <div class="row" style="justify-content:center">
          <button class="btn" data-action="live-share">${navigator.share ? "Send the join link" : "Copy the join link"}</button>
          <button class="btn ghost" data-action="live-leave">Stop sharing</button>
        </div>
        <p class="note" style="text-align:center;overflow-wrap:anywhere">${esc(link)}</p>`;
    } else {
      html = `
        <p>${esc(LIVE_TEXT[info.status] || "")}</p>
        <div class="live-code">${esc(info.code)}</div>
        <div class="row" style="justify-content:center"><button class="btn ghost" data-action="live-leave">Leave the live game</button></div>
        <p class="note">After leaving, this phone keeps a copy of the game as it was.</p>`;
    }
    body.innerHTML = html;
  }

  function renderLiveIndicator() {
    const pill = $(".live-pill");
    if (!pill || !window.Sync) return;
    const info = window.Sync.info();
    pill.hidden = !info.role;
    if (!info.role) return;
    const ok = info.status === "hosting" || info.status === "joined";
    pill.classList.toggle("warn", !ok);
    pill.querySelector(".live-pill-text").textContent = info.role === "host"
      ? `Live · ${info.code} · ${info.guests + 1} phone${info.guests ? "s" : ""}`
      : ok ? `Live · ${info.code}` : "Reconnecting…";
  }

  function openLive() {
    renderLive();
    const dlg = $("#live");
    if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  }

  document.addEventListener("sync-status", () => { renderLive(); renderLiveIndicator(); });
  $("#live").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

  // ---------- sound toggle ----------

  function syncSoundToggle() {
    const btn = $(".sound-toggle");
    if (!btn || !window.SFX) return;
    const muted = window.SFX.isMuted();
    btn.setAttribute("aria-pressed", String(!muted));
    btn.title = muted ? "Sound is off" : "Sound is on";
    btn.querySelector(".sound-label").textContent = muted ? "Sound off" : "Sound on";
    btn.querySelector(".sound-icon").textContent = muted ? "🔇" : "🔔";
  }
  syncSoundToggle();

  // ---------- user guide ----------

  function openGuide() {
    const dlg = $("#guide");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $(".guide-fab").classList.remove("unseen");
    try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch (e) { /* ignore */ }
  }

  // Clicking the dimmed backdrop closes the guide.
  $("#guide").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

  // Pulse the guide button until a new visitor has opened it once.
  try { if (!localStorage.getItem(GUIDE_SEEN_KEY)) $(".guide-fab").classList.add("unseen"); } catch (e) { /* ignore */ }

  render();

  // Resume live play after a refresh, or offer to join from a shared link.
  if (window.Sync) {
    const joinParam = new URLSearchParams(location.search).get("join");
    if (joinParam) {
      history.replaceState(null, "", location.pathname);
      const info = window.Sync.info();
      if (!(info.role === "guest" && info.code === joinParam.toUpperCase())) { ui.joinCode = joinParam.toUpperCase(); openLive(); }
    } else {
      window.Sync.resume();
    }
    renderLiveIndicator();
  }
})();
