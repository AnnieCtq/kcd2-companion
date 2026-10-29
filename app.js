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
    { id: "rent", label: "Rent paid", sign: -1, needsPayee: true },
    { id: "event_gain", label: "Event money gained", sign: 1 },
    { id: "event_loss", label: "Event money lost", sign: -1 },
    { id: "quest_reward", label: "Quest reward", sign: 1 },
    { id: "purchase", label: "Property purchase", sign: -1 },
    { id: "other_gain", label: "Other income", sign: 1 },
    { id: "other_loss", label: "Other cost", sign: -1 },
  ];

  const TABS = [
    { id: "campaign", label: "Campaign" },
    { id: "cards", label: "Scenario cards" },
    { id: "glory", label: "Glory" },
    { id: "clues", label: "Clues" },
    { id: "treasury", label: "Treasury" },
    { id: "finale", label: "Finale" },
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

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
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
    const e = { start: p.startCash, rentPaid: 0, rentReceived: 0, eventGain: 0, eventLoss: 0, quest: 0, purchase: 0, otherGain: 0, otherLoss: 0 };
    for (const t of state.txns) {
      if (t.playerId === pid) {
        if (t.type === "rent") e.rentPaid += t.amount;
        else if (t.type === "event_gain") e.eventGain += t.amount;
        else if (t.type === "event_loss") e.eventLoss += t.amount;
        else if (t.type === "quest_reward") e.quest += t.amount;
        else if (t.type === "purchase") e.purchase += t.amount;
        else if (t.type === "other_gain") e.otherGain += t.amount;
        else if (t.type === "other_loss") e.otherLoss += t.amount;
      }
      if (t.type === "rent" && t.payeeId === pid) e.rentReceived += t.amount;
    }
    e.balance = e.start - e.rentPaid + e.rentReceived + e.eventGain - e.eventLoss + e.quest - e.purchase + e.otherGain - e.otherLoss;
    return e;
  }

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
      case "glory": return renderGlory();
      case "clues": return renderClues();
      case "treasury": return renderTreasury();
      case "finale": return renderFinale();
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
          <p><strong>Alone:</strong> each player earns Glory for new clues, significant quest contributions, tournament wins and character achievements. Rent and property never earn Glory.</p>
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
      <article class="scenario-card kind-${lastCard.kind}" aria-live="polite">
        <div class="kicker">${esc(CARD_KINDS[lastCard.kind] || lastCard.kind)} · drawn by ${esc(pname(last.playerId))}</div>
        <h3 class="scenario-title">${esc(lastCard.title)}</h3>
        <p class="scenario-text">${esc(lastCard.text)}</p>
        <div class="scenario-result">${drawOutcome(last)}</div>
      </article>` : `<div class="scenario-card empty-card"><p class="empty">Choose who is drawing, and a card will be turned over and applied to them.</p></div>`;

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
      <p class="note">Glory for clues is awarded automatically when a clue is recorded. Never award Glory for rent or property purchases.</p>`;
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

  function renderTreasury() {
    const typeOpts = TXN_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");
    const rows = state.players.map((p) => {
      const e = economy(p.id);
      return `<tr>
        <td><span class="dot" style="display:inline-block;background:${esc(p.color)}"></span> ${esc(p.name)}</td>
        <td class="num">${fmt(e.start)}</td>
        <td class="num neg">${fmt(e.rentPaid)}</td>
        <td class="num pos">${fmt(e.rentReceived)}</td>
        <td class="num pos">${fmt(e.eventGain)}</td>
        <td class="num neg">${fmt(e.eventLoss)}</td>
        <td class="num pos">${fmt(e.quest)}</td>
        <td class="num neg">${fmt(e.purchase)}</td>
        <td class="num">${signed(e.otherGain - e.otherLoss)}</td>
        <td class="num"><strong>${fmt(e.balance)}</strong></td>
      </tr>`;
    }).join("");
    const all = state.players.map((p) => economy(p.id));
    const sum = (k) => all.reduce((a, e) => a + e[k], 0);
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
        <p class="note">For ordinary events, prefer the lower end of the reward range while money is plentiful. Money never earns Glory.</p>
      </div>
      <div class="card" style="margin-bottom:14px">
        <h2>Ledger by player</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Player</th><th class="num">Start</th><th class="num">Rent paid</th><th class="num">Rent recv.</th><th class="num">Event +</th><th class="num">Event −</th><th class="num">Quest</th><th class="num">Bought</th><th class="num">Other</th><th class="num">Balance</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th>All</th><th class="num">${fmt(sum("start"))}</th><th class="num">${fmt(sum("rentPaid"))}</th><th class="num">${fmt(sum("rentReceived"))}</th><th class="num">${fmt(sum("eventGain"))}</th><th class="num">${fmt(sum("eventLoss"))}</th><th class="num">${fmt(sum("quest"))}</th><th class="num">${fmt(sum("purchase"))}</th><th class="num">${signed(sum("otherGain") - sum("otherLoss"))}</th><th class="num">${fmt(sum("balance"))}</th></tr></tfoot>
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
          <button class="btn ghost" data-action="copy-report">Copy summary</button>
          <button class="btn ghost" data-action="export-csv">Download ledger (.csv)</button>
          <button class="btn ghost" data-action="export-json">Save chronicle (.json)</button>
        </div>
      </div>`;
  }

  function renderReportTable() {
    const rows = standings().map(({ p, glory }) => {
      const e = economy(p.id);
      const clues = state.clues.filter((c) => c.discovererId === p.id).length;
      return `<tr><td>${esc(p.name)}</td><td class="num">${glory}</td><td class="num">${clues}</td><td class="num">${fmt(e.start)}</td><td class="num">${fmt(e.balance)}</td><td class="num">${fmt(e.rentPaid)}</td><td class="num">${signed(e.eventGain - e.eventLoss)}</td><td class="num">${fmt(e.quest)}</td></tr>`;
    }).join("");
    return `<div class="table-scroll"><table>
      <thead><tr><th>Player</th><th class="num">Glory</th><th class="num">Clues</th><th class="num">Start</th><th class="num">End</th><th class="num">Rent paid</th><th class="num">Event net</th><th class="num">Quest rewards</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function renderChronicle() {
    const items = state.log.map((l) => `<tr><td class="muted">${time(l.ts)}</td><td class="muted">${statusLabel(l.chapter)}</td><td>${esc(l.text)}</td></tr>`).join("");
    return `<div class="card"><h2>The chronicle</h2>${items ? `<div class="table-scroll"><table><tbody>${items}</tbody></table></div>` : '<div class="empty">Nothing recorded yet.</div>'}</div>`;
  }

  // ---------- reports ----------

  function summaryText() {
    const lines = [];
    lines.push("KCD2 RPG Monopoly: session record");
    lines.push(`Campaign: ${statusLabel(state.status)}`);
    if (state.status === "success") lines.push(`Champion of Bohemia: ${gloryLeaders().map((p) => p.name).join(" & ")}`);
    lines.push(`Clues: ${state.clues.length} found, ${state.clues.filter((c) => c.spent).length} spent at finale`);
    lines.push("");
    for (const { p, glory } of standings()) {
      const e = economy(p.id);
      lines.push(`${p.name}: Glory ${glory}; start ${e.start} gr, end ${e.balance} gr; rent paid ${e.rentPaid}, rent received ${e.rentReceived}; events +${e.eventGain}/−${e.eventLoss}; quest rewards ${e.quest}; purchases ${e.purchase}`);
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
    if (a === "close-guide") { $("#guide").close(); return; }
    if (a === "draw-card") { drawCard(el.dataset.player); return; }
    if (a === "tab") { ui.tab = el.dataset.tab; render(); return; }
    if (a === "undo") { undo(); return; }

    if (a === "set-status") {
      const s = el.dataset.status;
      if (s === state.status) return;
      if ((s === "success" || s === "unresolved") && !confirm(`Declare the campaign ${s === "success" ? "a success" : "unresolved"}?`)) return;
      commit(`Campaign status set to ${statusLabel(s)}`, (st) => { st.status = s; });
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
      return;
    }

    if (a === "copy-report") {
      const text = summaryText();
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast("Summary copied"))
        .catch(() => download(`kcd2-summary-${stamp()}.txt`, text, "text/plain"));
      return;
    }
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
})();
