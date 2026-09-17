// The officer's ear: turns the captain's words into one intent. Deterministic, so the voice model never
// has to pick between tools; it hands the words over and speaks the line it gets back.
// Loaded before voice.js (inlined by the Bridge renderer and by scripts/build-demo.mjs); unit tests in scripts/router.test.mjs.
(() => {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
  const SHIP_WORDS = {
    "hyper-cv": ["hyper-cv", "hypercv", "hyper cv", "hyper c v", "next role", "nextrole", "cv"],
    "web3-capital": ["web3-capital", "web3 capital", "web 3 capital", "web3", "web 3", "web three", "crypto"],
    "mcp-maker": ["mcp-maker", "mcp maker", "mcp", "maker"],
    revela: ["revela", "reveal a", "revella", "reveala", "revelar"],
    intel: ["intel", "intelligence"],
  };
  const findShipWord = (t) => {
    for (const [ship, words] of Object.entries(SHIP_WORDS)) {
      if (words.some((w) => new RegExp(`(^| )${w.replace(/[-]/g, "[- ]?")}( |$)`).test(t))) return ship;
    }
    return "";
  };

  const RULES = [
    [/^(start over|from the top|open the watch|restart the watch)\b/, () => ({ intent: "open" })],
    [/^(why|how come|explain|what('s| is) the (evidence|reason)|because)\b/, () => ({ intent: "why" })],
    [/\b(brief(ing)?|summary|summar(ise|ize)|overview|what('s| is) on the agenda|the agenda)\b/, () => ({ intent: "brief" })],
    [/^(next|skip( it| that)?|move on|what else|go on|carry on)\b/, () => ({ intent: "next" })],
    [/^(yes|yeah|yep|do it|go ahead|approve(d)?|confirm(ed)?|ok(ay)?|sure|run( it)?|ship it|make it so|act( on it)?|go for it|let's go|hand it (over|to an agent)|build it)\b/, () => ({ intent: "decide", decision: "approve" })],
    [/^(no|nope|reject(ed)?|drop( it| that)?|don't|do not|kill it|leave it)\b/, () => ({ intent: "decide", decision: "reject" })],
    [/\b(park( it| that)?|defer|later|not now|not yet|hold( it| that)?|remind me|bring it back)\b/, () => ({ intent: "decide", decision: "defer" })],
    [/^(noted|acknowledged?|ack|understood|got it|thanks|thank you)\b/, () => ({ intent: "decide", decision: "acknowledge" })],
    [/\b(commands?|command palette|palette|shortcuts?)\b/, (t) => ({ intent: "navigate", target: t.includes("search") ? t : "commands" })],
    [/^(search( for)?|find|look up) (.+)/, (t, m) => ({ intent: "navigate", target: `search ${m[3]}` })],
    [/^(close|dismiss|back|go back|escape|exit|never mind|cancel)\b/, () => ({ intent: "navigate", target: "close" })],
    [/^(click|press|tap|expand|toggle)( on)?( the)? (.+)/, (t, m) => ({ intent: "navigate", target: m[4] })],
    [/\b(read|verdict|commander('s)? (view|read|call|say|says|think|thinks))\b/, (t) => { const ship = findShipWord(t); return ship ? { intent: "read", ship } : { intent: "brief" }; }],
    [/\b(show|open|focus( on)?|look at|pull up|bring up|how('s| is| are)( is)?|what about|status of|check( on)?|tell me about)\b/, (t) => { const ship = findShipWord(t); return ship ? { intent: "open_ship", ship } : null; }],
  ];

  function route(text) {
    const t = norm(text);
    if (!t) return { intent: "free", text: "" };
    for (const [re, make] of RULES) {
      const m = t.match(re);
      if (m) {
        const r = make(t, m);
        if (r) return { ...r, text };
      }
    }
    const ship = findShipWord(t);
    if (ship && t.split(" ").length <= 3) return { intent: "open_ship", ship, text };
    return { intent: "free", text };
  }

  // The officer's mouth: a line written for a screen, made sayable. Dates a person would say, no symbols to stumble on.
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function forEar(text, today = new Date()) {
    return String(text || "")
      .replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, (m, y, mo, d) => (MONTHS[mo - 1] ? `${Number(d)} ${MONTHS[mo - 1]}${Number(y) === today.getFullYear() ? "" : ` ${y}`}` : m))
      .replace(/\s*[·•|]\s*/g, ", ")
      .replace(/\s*(→|->|=>)\s*/g, " to ")
      .replace(/\((s|es)\)/g, "$1")
      .replace(/(\w)_(?=\w)/g, "$1 ")
      .replace(/[`*_#]+/g, "")
      .replace(/\s+([,.;:?!])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  globalThis.officerRoute = route;
  globalThis.officerForEar = forEar;
  globalThis.officerShipWord = findShipWord;
})();
