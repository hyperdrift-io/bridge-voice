// The watch: the conversation itself. State in, one short line out. No audio, no DOM, no network of its own
// (decisions go through the `decide` function it is given), so whole conversations run in scripts/watch.test.mjs for free.
// Written 2026-09-17 after the founder's verdict on the first version: "I can't have a conversation with it. It's not
// presenting me with options." So: the officer offers, the captain chooses. Short turns. Every line ends on a question.
(() => {
  const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const count = (n) => NUMBER_WORDS[n] || String(n);
  const list = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}`);
  const choices = (parts) => `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}?`; // the comma is the pause the voice needs
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  // What the captain can do with an item, in words they would say. The first verb of each pair is what router.js hears.
  const VERBS = {
    act: { offer: "go for it", done: "approve" }, approve: { offer: "hand it to an agent", done: "approve" }, run: { offer: "run it", done: "approve" },
    acknowledge: { offer: "note it", done: "acknowledge" }, reject: { offer: "drop it", done: "reject" }, defer: { offer: "park it", done: "defer" }, park: { offer: "park it", done: "defer" },
  };
  const GROUPED = { heal: (n) => `${count(n)} small fixes an agent can take`, read: (n) => `${count(n)} ships overdue a read`, alert: (n) => `${count(n)} alerts` };
  const KIND_WORDS = { contest: "contest contests hackathon hackathons deadline challenge", heal: "fix fixes finding findings heal agent repairs", read: "read reads ship ships commander overdue", alert: "alert alerts notification notifications" };
  const ORDINALS = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, fourth: 3, last: -1 };

  function create(agenda, { decide, hour = new Date().getHours() } = {}) {
    let items = [...agenda.items];
    let focus = null; // { topic, item } — item is null while a group is on the table
    let whyAt = 0;
    let pending = null; // a decision the officer proposed and the captain can confirm with "yes"
    let last = "";
    let decided = 0;
    let walking = false; // the captain asked to go through a set one by one

    const label = (it) => it.short || it.ship || it.headline.split(/[.:]/)[0];
    function topics() {
      const out = [];
      for (const it of items) {
        const group = GROUPED[it.kind] && items.filter((i) => i.kind === it.kind).length > 1;
        const found = group && out.find((t) => t.kind === it.kind && t.group);
        if (found) found.items.push(it);
        else out.push({ kind: it.kind, group: Boolean(group), items: [it] });
      }
      for (const t of out) {
        t.label = t.group ? GROUPED[t.kind](t.kind === "heal" ? t.items.reduce((n, i) => n + (i.keys || [i]).length, 0) : t.items.length) : label(t.items[0]);
        t.words = norm(`${t.label} ${KIND_WORDS[t.kind] || ""} ${t.items.map((i) => `${label(i)} ${i.ship || ""}`).join(" ")}`).split(" ");
      }
      return out;
    }
    const say = (text, ui) => { last = text; return { say: text, ui: ui || (focus && focus.item && focus.item.ui) || null }; };
    const allOf = (topic) => (VERBS[topic.items[0].default] || VERBS.approve).offer.replace(" it", " them all");
    const groupOffers = (topic) => (topic.kind === "read" ? choices([allOf(topic), "pick a ship", "park them"]) : choices([allOf(topic), "go through them", "park them"]));
    const onTable = (withWhy) => (focus.item ? offers(focus.item, withWhy) : groupOffers(focus.topic)); // the choices for whatever is in focus
    const offers = (it, withWhy = true) => choices([...it.options.map((o) => (VERBS[o] || { offer: o }).offer), ...(withWhy && it.why.length ? ["hear why"] : [])]);

    // ── Lines ────────────────────────────────────────────────────────────
    function menu(opening) {
      focus = null; pending = null; walking = false;
      const ts = topics();
      const hello = opening ? `${hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 18 ? "Afternoon" : "Evening"}, Captain. ` : "";
      if (!ts.length) return say(`${hello}${opening ? "The agenda is clear" : "That is everything decided"}. Ask me about a ship, or shall I close the watch?`);
      if (ts.length === 1) return say(`${hello}${opening ? "One thing today" : "One thing left"}: ${ts[0].label}. Shall we take it?`);
      const named = ts.slice(0, 3).map((t) => t.label);
      const more = ts.length > 3 ? `, and ${count(ts.length - 3)} more` : "";
      return say(`${hello}${cap(count(ts.length))} things ${opening ? "today" : "left"}: ${list(named)}${more}. Which one first?`);
    }
    function present(topic, item) {
      whyAt = 0; pending = null;
      focus = { topic, item: item || (topic.group ? null : topic.items[0]) };
      if (focus.item) return say(`${focus.item.headline.replace(/\s*Shall I[^?]*\?\s*$/, "")} ${cap(offers(focus.item))}`);
      const names = list(topic.items.map(label));
      return say(`${topic.kind === "read" ? `${cap(names)} ${topic.items.length > 1 ? "are" : "is"} overdue a Commander read.` : `${cap(topic.label)}: ${names}.`} ${cap(groupOffers(topic))}`, topic.items[0].ui);
    }
    function why() {
      const it = focus && focus.item;
      if (!it) return focus ? say(`${focus.topic.items[0].why[0] || "Nothing more is attached."} ${cap(groupOffers(focus.topic))}`) : menu();
      const line = it.why[whyAt];
      if (!line) return say(`That is all I have on it. ${cap(offers(it, false))}`);
      whyAt += 1;
      return say(`${line} ${it.why[whyAt] ? "Want more, or shall we decide?" : cap(offers(it, false))}`);
    }
    function recommend() {
      const it = focus && (focus.item || focus.topic.items[0]);
      if (!it) { const t = topics()[0]; if (!t) return menu(); pending = { pick: t }; return say(`I would start with ${t.label}. Shall we?`); }
      const verb = (VERBS[it.default] || { offer: it.default }).offer;
      pending = { decision: it.default };
      return say(`I would ${focus.item ? verb : verb.replace(" it", " them all")}. ${it.rationale || it.why[0] || ""} Shall I?`);
    }
    async function record(decision) {
      const targets = focus.item ? [focus.item] : focus.topic.items;
      const results = [];
      for (const it of targets) results.push(await decide(it.key, decision, `captain said: ${decision}`));
      items = items.filter((i) => !targets.includes(i));
      decided += targets.length;
      const done = targets.length > 1 ? `Done, ${targets.length === 2 ? "both" : `all ${count(targets.length)}`} logged.` : results[0].done || "Logged.";
      const left = focus.topic.group && focus.item ? items.filter((i) => i.kind === focus.topic.kind) : [];
      if (left.length) { // still inside a set: march on only if the captain asked to go through it; otherwise put the rest back on the table
        const topic = topics().find((t) => t.items.includes(left[0]));
        const next = walking || left.length === 1 ? present(topic, left[0]) : present(topic);
        return say(`${done} ${walking ? "Next in that set: " : `${cap(count(left.length))} left in that set. `}${next.say}`, next.ui);
      }
      const rest = menu();
      return say(`${done} ${rest.say}`, rest.ui);
    }
    function pick(text, route) {
      const ts = topics();
      const words = norm(text).split(" ");
      // A sentence that names a topic is a question about it, not a choice of it: "what is holding revela back?" goes to the brain.
      if (words.length > 5 || /^(is|are|what|how|should|can|could|do|does|will|would|when|where|who|why)\b/.test(norm(text))) return null;
      const pool = focus && !focus.item ? focus.topic.items.map((it) => ({ it, words: norm(`${label(it)} ${it.ship || ""}`).split(" ") })) : [];
      const inGroup = pool.find((p) => (route.ship && p.it.ship === route.ship) || p.words.some((w) => w.length > 3 && words.includes(w)));
      if (inGroup) return present(focus.topic, inGroup.it);
      const ordinal = words.map((w) => ORDINALS[w]).find((o) => o !== undefined);
      const byWord = ts.map((t) => ({ t, score: t.words.filter((w) => w.length > 3 && words.includes(w)).length })).sort((a, b) => b.score - a.score)[0];
      const topic = byWord && byWord.score ? byWord.t : ordinal !== undefined && /\b(one|first|second|third|fourth|last|1st|2nd|3rd)\b/.test(norm(text)) && words.length <= 4 ? ts[ordinal < 0 ? ts.length - 1 : ordinal] : null;
      return topic ? present(topic) : null;
    }

    // ── One captain utterance in, one line out. null means "not mine": a cockpit order or a real question. ─────────
    async function hear(route) {
      const r = route || { intent: "free", text: "" };
      if (pending && r.intent === "decide") {
        const p = pending; pending = null;
        if (r.decision === "approve") return p.pick ? present(p.pick) : record((VERBS[p.decision] || { done: p.decision }).done);
        return focus ? say(`Understood. ${cap(onTable(false))}`) : menu();
      }
      switch (r.intent) {
        case "open": case "menu": case "greet": return menu(r.intent !== "menu");
        case "brief": return menu();
        case "repeat": return say(last || menu(true).say);
        case "unclear": return say(`I did not catch an order in that. ${focus ? cap(onTable(true)) : menu().say}`);
        case "busy": return say(`Give me about ${r.seconds || 30} seconds before my next considered answer. Meanwhile: ${focus ? onTable(true) : menu().say}`);
        case "thanks": return say(`Any time. ${focus ? cap(onTable(false)) : menu().say}`);
        case "close_watch": return { ...say(`Watch closed. ${decided ? `${cap(count(decided))} decision${decided === 1 ? "" : "s"} logged.` : "Nothing decided, nothing lost."} Fair winds, Captain.`), close: true };
        case "why": case "more": return focus ? why() : menu();
        case "recommend": return recommend();
        case "next": { const ts = topics(); const at = focus ? ts.findIndex((t) => t.kind === focus.topic.kind && t.label === focus.topic.label) : -1; return ts.length ? present(ts[(at + 1) % ts.length]) : menu(); }
        case "each": if (!focus || focus.item) return null; walking = true; return present(focus.topic, focus.topic.items[0]);
        case "decide":
          if (!focus) { const ts = topics(); return r.decision === "approve" && ts.length ? present(ts[0]) : menu(); }
          return record(r.decision);
        default: return pick(r.text, r);
      }
    }

    // The order of the whole turn, in one place, because two callers must agree on it word for word: the island in the
    // browser and the officer-as-LLM endpoint (api/voice/llm.js) that replays the same utterances. `proposal` says the
    // officer's last line ended on a proposal from the brain; it lives for exactly one reply ("yes" takes it, anything else
    // lets it go; left hanging it once swallowed "hand them all over" meant for the fixes on the table).
    async function converse(words, { proposal = false } = {}) {
      const r = globalThis.officerRoute(words);
      if (r.intent === "open") return { kind: "watch", ...menu(true) };
      if (proposal && r.intent === "decide") {
        if (r.decision === "approve") return { kind: "proposal-yes" };
        const again = await hear({ intent: "thanks" });
        return { kind: "watch", ...again, say: again.say.replace(/^Any time\./, "Understood.") };
      }
      // A bare ship name while a set of ships is on the table is a choice, not a cockpit order.
      const bare = words.trim().split(/\s+/).length <= 2;
      const shipsOnTable = focus && !focus.item && focus.topic.kind === "read";
      const cockpit = ["open_ship", "read", "navigate"].includes(r.intent) && !(r.intent === "open_ship" && bare && shipsOnTable);
      if (!cockpit) {
        const heard = await hear(r.intent === "open_ship" ? { ...r, intent: "free" } : r);
        if (heard) return { kind: "watch", ...heard };
      }
      if (["open_ship", "read", "navigate"].includes(r.intent)) return { kind: "cockpit", route: r };
      // The brain is for real questions. A few stray words get the choices again, at once, instead of a slow guess.
      const question = /\?\s*$/.test(words) || /^(is|are|what|how|should|can|could|do|does|did|will|would|when|where|who|why|which|tell me|explain)\b/i.test(words.trim()) || words.trim().split(/\s+/).length >= 5;
      return question ? { kind: "question", words, ship: globalThis.officerShipWord(norm(words)) } : { kind: "watch", ...(await hear({ intent: "unclear" })) };
    }

    return { open: () => menu(true), hear, converse, state: () => ({ focus: focus && (focus.item ? focus.item.headline : focus.topic.label), options: focus ? (focus.item || focus.topic.items[0]).options : topics().map((t) => t.label), last, remaining: items.length }) };
  }

  // What the officer says about a ship, from the cockpit's own facts (the island reads them off the page; the LLM endpoint gets them handed over).
  const RANKS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const shipLine = (f) => {
    const rank = RANKS[Number(String(f.position || "").replace("#", "")) - 1];
    return `${f.ship} ${rank ? `is ranked ${rank}` : "is unranked"}, at the ${f.stage} stage${f.visitors ? `, with ${f.visitors} visitors` : ""}.${f.constraint ? ` What holds it back is ${f.constraint}.` : ""} ${f.read_line || ""}`.trim();
  };
  const readLine = (f) => `${f.ship}: ${f.read_line || ""} ${f.last_read ? `Last read ${f.last_read.date}: ${f.last_read.verdict}. ${f.last_read.pragmatic}` : "No recorded read yet."}`;

  // Does this line end on the brain's proposal ("Shall I run the read now?")? Both sides of the own-LLM path ask the same way.
  const proposes = (line) => /^(shall i|should i|want me to|do you want me to)\b/i.test(((String(line).match(/[^.?!]+[.?!]+\s*$/) || [""])[0]).trim());

  globalThis.officerWatch = { create, shipLine, readLine, proposes };
})();
