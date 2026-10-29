/* Live shared game for the Chronicle of Bohemia companion.
 *
 * One phone hosts the game and gets a short code; the others join with it.
 * Phones talk directly to each other over WebRTC using PeerJS, whose free public
 * broker only introduces the phones, so nothing needs setting up and no game data
 * is stored on a server. The host relays every change to everyone else, and the
 * last change wins, which suits a turn-based table.
 */
(function () {
  "use strict";

  const LIB = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
  const PREFIX = "kcd2-chronicle-";
  const SESSION_KEY = "kcd2-live";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let peer = null;
  let role = null; // "host" | "guest" | null
  let code = null;
  let status = "off"; // off | starting | hosting | connecting | joined | reconnecting | error
  let detail = "";
  let guests = [];
  let hostConn = null;
  let retryTimer = null;
  let hostRetries = 0;

  const app = () => window.KCD2;
  const notify = () => document.dispatchEvent(new CustomEvent("sync-status"));
  const setStatus = (s, d = "") => { status = s; detail = d; notify(); };

  function remember() {
    try {
      if (role) localStorage.setItem(SESSION_KEY, JSON.stringify({ role, code }));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  function loadLib() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the live-play library. Check this device's internet connection."));
      document.head.appendChild(s);
    });
  }

  const peerOptions = () => Object.assign({ debug: 0 }, window.KCD2_PEER_OPTIONS || {});
  const randomCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
  const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

  function friendlyError(err) {
    const t = err && err.type;
    if (t === "peer-unavailable") return `No game is open with the code ${code}. Check the code, and that the host's screen is still on.`;
    if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed") return "Lost contact with the live-play service. Check the internet connection.";
    if (t === "browser-incompatible") return "This browser cannot do live play. Try an up-to-date Chrome, Safari or Firefox.";
    return (err && err.message) || "Something went wrong with live play.";
  }

  function onData(data, from) {
    if (!data || data.type !== "state" || !data.state || !Array.isArray(data.state.players)) return;
    app().applyRemote(data.state);
    // the host passes each change on to every other phone
    if (role === "host") guests.forEach((c) => { if (c !== from && c.open) c.send(data); });
  }

  function destroyPeer() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } }
    peer = null;
    guests = [];
    hostConn = null;
  }

  async function host(existingCode) {
    destroyPeer();
    role = "host";
    code = cleanCode(existingCode) || randomCode();
    remember();
    setStatus("starting");
    try { await loadLib(); } catch (e) { return fail(e.message); }
    peer = new window.Peer(PREFIX + code, peerOptions());
    peer.on("open", () => { hostRetries = 0; setStatus("hosting"); });
    peer.on("connection", (conn) => {
      conn.on("open", () => {
        guests.push(conn);
        conn.send({ type: "state", state: app().getState() });
        notify();
      });
      conn.on("data", (d) => onData(d, conn));
      conn.on("close", () => { guests = guests.filter((c) => c !== conn); notify(); });
      conn.on("error", () => { guests = guests.filter((c) => c !== conn); notify(); });
    });
    peer.on("disconnected", () => { if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on("error", (err) => {
      // After a refresh the broker can hold the old code for a little while.
      if (err.type === "unavailable-id" && hostRetries < 12) {
        hostRetries++;
        setStatus("starting", "Reclaiming the game code…");
        destroyPeer();
        retryTimer = setTimeout(() => host(code), 5000);
        return;
      }
      if (err.type === "peer-unavailable") return; // a guest left mid-connect
      fail(friendlyError(err));
    });
  }

  async function join(joinCode) {
    destroyPeer();
    role = "guest";
    code = cleanCode(joinCode);
    if (!code) return fail("Enter the code shown on the host's screen.");
    remember();
    setStatus("connecting");
    try { await loadLib(); } catch (e) { return fail(e.message); }
    peer = new window.Peer(peerOptions());
    peer.on("open", connectToHost);
    peer.on("disconnected", () => { if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable" && status === "reconnecting") { retryTimer = setTimeout(connectToHost, 4000); return; }
      fail(friendlyError(err));
    });
  }

  function connectToHost() {
    if (role !== "guest" || !peer) return;
    hostConn = peer.connect(PREFIX + code, { reliable: true });
    hostConn.on("open", () => setStatus("joined"));
    hostConn.on("data", (d) => onData(d, hostConn));
    hostConn.on("close", () => {
      if (role !== "guest") return;
      setStatus("reconnecting");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectToHost, 3000);
    });
  }

  function fail(message) {
    destroyPeer();
    const wasRole = role;
    role = null;
    remember();
    setStatus("error", message);
    return wasRole;
  }

  function leave() {
    destroyPeer();
    role = null;
    code = null;
    remember();
    setStatus("off");
  }

  // Called by the app after every local change.
  function push(state) {
    const msg = { type: "state", state };
    if (role === "host") guests.forEach((c) => { if (c.open) c.send(msg); });
    else if (role === "guest" && hostConn && hostConn.open) hostConn.send(msg);
  }

  // Pick up where this device left off after a refresh.
  function resume() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { /* ignore */ }
    if (saved && saved.role === "host" && saved.code) host(saved.code);
    else if (saved && saved.role === "guest" && saved.code) join(saved.code);
  }

  window.Sync = {
    host, join, leave, push, resume,
    info: () => ({ role, code, status, detail, guests: guests.filter((c) => c.open).length }),
    joinLink: () => `${location.origin}${location.pathname}?join=${code}`,
  };
})();
