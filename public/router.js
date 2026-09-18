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

  const few = (t, n) => t.split(" ").length <= n;
  const RULES = [
    [/^(start over|from the top|open the watch|restart the watch)\b/, () => ({ intent: "open" })],
    [/\b(close the watch|end the watch|stop the watch|that's all|that is all|that will be all|we're done|we are done|goodbye|bye|good night|enough for (today|now|tonight)|that'll do|i'm done|i am done)\b/, () => ({ intent: "close_watch" })],
    [/^(hello|hi|hey|good (morning|afternoon|evening))\b/, (t) => (few(t, 4) ? { intent: "greet" } : null)],
    [/^(repeat|say (that|it) again|again|sorry|pardon|come again|what did you say|what was that)\b/, () => ({ intent: "repeat" })],
    [/^(thanks|thank you|cheers)\b/, (t) => (few(t, 3) ? { intent: "thanks" } : null)],
    [/\b(you choose|you pick|you decide|your call|what do you (recommend|suggest|think)|what would you do|what should (i|we) do|your (recommendation|advice|opinion|view)|which (one|way) would you|what's your (take|view|call))\b/, (t) => (few(t, 6) ? { intent: "recommend" } : null)],
    [/^(more|go on|tell me more|continue|keep going|details?|and then|carry on|what('s| is) (that|it|this)( all)? about|tell me about (it|that)|what do you mean|meaning|such as)\b/, () => ({ intent: "more" })],
    [/\b(back to the agenda|menu|what are (my|the) (options|choices)|what('s| is) left|what else is there|what else (do|have) (we|you) (have|got)|back to the (agenda|list|menu)|the list|the other (ones|things))\b/, () => ({ intent: "menu" })],
    [/\b(one by one|go through them|one at a time|walk me through( them)?|each of them)\b/, () => ({ intent: "each" })],
    [/^(why|how come|explain|what('s| is) the (evidence|reason)|because)\b/, () => ({ intent: "why" })],
    [/\b(brief(ing)?|summary|summar(ise|ize)|overview|what('s| is) on the agenda|the agenda)\b/, () => ({ intent: "brief" })],
    [/^(next|skip( it| that)?|move on|what else)\b/, () => ({ intent: "next" })],
    [/^(yes|yeah|yep|yup|sure|fine|alright|all right|sounds good|why not|do it|go ahead|approve(d)?|confirm(ed)?|ok(ay)?|sure|run( it)?|ship it|make it so|act( on it)?|go for it|let's go|let's do it|hand (it|them)( all)?( over| to an agent)?|build it|take (it|them)( all)?|all of them|do them all)\b/, () => ({ intent: "decide", decision: "approve" })],
    [/\b(park( it| that| them)?|defer|later|not now|not yet|hold( it| that)?|remind me|bring it back|for now|another (day|time)|leave (it|that|them|that one)|let's not|come back to (it|that))\b/, () => ({ intent: "decide", decision: "defer" })],
    [/^(no|nope|nah|reject(ed)?|drop( it| that| them)?|don't|do not|kill it|forget (it|that))\b/, () => ({ intent: "decide", decision: "reject" })],
    [/^(noted?|note it|acknowledged?|ack|understood|got it)\b/, () => ({ intent: "decide", decision: "acknowledge" })],
    [/\b(commands?|command palette|palette|shortcuts?)\b/, (t) => ({ intent: "navigate", target: t.includes("search") ? t : "commands" })],
    [/^(search( for)?|find|look up) (.+)/, (t, m) => ({ intent: "navigate", target: `search ${m[3]}` })],
    [/^(close|dismiss|back|go back|escape|exit|never mind|cancel)\b/, () => ({ intent: "navigate", target: "close" })],
    [/^(click|press|tap|expand|toggle)( on)?( the)? (.+)/, (t, m) => ({ intent: "navigate", target: m[4] })],
    [/\b(read|verdict|commander('s)? (view|read|call|say|says|think|thinks))\b/, (t) => { const ship = findShipWord(t); return ship ? { intent: "read", ship } : { intent: "brief" }; }],
    [/\b(show|open|focus( on)?|look at|pull up|bring up|how('s| is| are)( is)?|what about|status of|check( on)?|tell me about)\b/, (t) => { const ship = findShipWord(t); return ship ? { intent: "open_ship", ship } : null; }],
  ];

  function route(text) {
    const t = norm(text).replace(/^((hmm+|um+|uh+|er+|erm|well|so|oh|and)\s+)+/, ""); // thinking aloud is not part of the order
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
