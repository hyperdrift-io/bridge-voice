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
    restore: { offer: "bring it online", done: "approve" }, acknowledge: { offer: "note it", done: "acknowledge" }, reject: { offer: "drop it", done: "reject" }, defer: { offer: "park it", done: "defer" }, park: { offer: "park it", done: "defer" },
  };
  const GROUPED = { heal: (n) => `${count(n)} small fixes an agent can take`, read: (n, its) => (its.every((i) => i.fresh) ? `${count(n)} fresh reads` : `${count(n)} ships overdue a read`), alert: (n) => `${count(n)} alerts` };
  const KIND_WORDS = { signal: "signal signals", incident: "incident outage down offline stopped answering", contest: "contest contests hackathon hackathons deadline challenge", heal: "fix fixes finding findings heal agent repairs", read: "read reads ship ships commander overdue", alert: "alert alerts notification notifications" };
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
        t.label = t.group ? GROUPED[t.kind](t.kind === "heal" ? t.items.reduce((n, i) => n + (i.keys || [i]).length, 0) : t.items.length, t.items) : label(t.items[0]);
        t.words = norm(`${t.label} ${KIND_WORDS[t.kind] || ""} ${t.items.map((i) => `${label(i)} ${i.ship || ""}`).join(" ")}`).split(" ");
      }
      return out;
    }
    // Every line carries the view: what is on the table right now. The cockpit (public/cockpit.js) shows it and moves the
    // Bridge to match, so the screen always answers the last thing said (founder, 2026-09-18).
    function view() {
      if (!focus) return { kind: "menu", label: items.length ? "On the agenda" : "The agenda is clear", lines: topics().map((t) => t.label), options: [], ships: items.map((i) => i.ship).filter(Boolean) };
      if (!focus.item) return { kind: focus.topic.kind, label: focus.topic.label, lines: focus.topic.items.map(label), options: [allOf(focus.topic), focus.topic.kind === "read" ? "pick a ship" : "go through them", "park them"], ships: focus.topic.items.map((i) => i.ship).filter(Boolean), ui: focus.topic.items[0].ui || null };
      const it = focus.item;
      return { kind: it.kind, label: label(it), headline: it.headline, lines: it.why.slice(0, whyAt), options: it.options.map((o) => (VERBS[o] || { offer: o }).offer), ships: [it.ship].filter(Boolean), ui: it.ui || null };
    }
    const say = (text, ui) => { last = text; return { say: text, ui: ui || (focus && focus.item && focus.item.ui) || null, view: view() }; };
    const allOf = (topic) => (VERBS[topic.items[0].default] || VERBS.approve).offer.replace(" it", " them all");
    const groupOffers = (topic) => (topic.kind === "read" ? choices([allOf(topic), "pick a ship", "park them"]) : choices([allOf(topic), "go through them", "park them"]));
    const onTable = (withWhy) => (focus.item ? offers(focus.item, withWhy) : groupOffers(focus.topic)); // the choices for whatever is in focus
    const offers = (it, withWhy = true) => choices([...it.options.map((o) => (VERBS[o] || { offer: o }).offer), ...(withWhy && it.why.length ? ["hear why"] : [])]);

    // ── Lines ────────────────────────────────────────────────────────────
    function menuLine(opening) {
      const ts = topics();
      const hello = opening ? `${hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 18 ? "Afternoon" : "Evening"}, Captain. ` : "";
      if (!ts.length) return `${hello}${opening ? "The agenda is clear" : "That is everything decided"}. Ask me about a ship, or shall I close the watch?`;
      if (ts.length === 1) return `${hello}${opening ? "One thing today" : "One thing left"}: ${ts[0].label}. Shall we take it?`;
      const named = ts.slice(0, 3).map((t) => t.label);
      const all = ts.length > 3 ? `${named.join(", ")}, and ${count(ts.length - 3)} more` : list(named);
      return `${hello}${cap(count(ts.length))} ${opening ? "things today" : "left"}: ${all}. Which one first?`;
    }
    function menu(opening) {
      focus = null; pending = null; walking = false;
      return say(menuLine(opening));
    }
    // After a decision the officer leads: with more than two topics left it names the next one and asks, instead of
    // reading the whole list again (the founder, 2026-09-29: lines too long, blanks too many). "Menu" still lists them all.
    const restLine = () => { const ts = topics(); return ts.length > 2 ? `${cap(count(ts.length))} left. Next: ${ts[0].label}. Shall we?` : menuLine(); };
    function rest() {
      focus = null; walking = false;
      const ts = topics();
      pending = ts.length > 2 ? { pick: ts[0] } : null;
      return say(restLine());
    }
    // An order on a ship itself (the sandbox ship here; the production ships take theirs from the live Bridge). The officer
    // acknowledges in one breath and hands the order on; whoever carries it out (the island) reports back through report().
    const operable = agenda.operable || [];
    function order(r) {
      const on = focus && focus.item && focus.item.order ? focus.item : items.find((i) => i.order && (!r.ship || i.ship === r.ship));
      const ship = r.ship || (on && on.ship) || (operable.length === 1 ? operable[0] : "");
      const mode = r.mode || (on && on.order.mode) || "online";
      if (!operable.includes(ship)) return say(`${ship ? cap(ship) : "That ship"} takes its orders from the live Bridge. From here I can switch ${list(operable.map(cap)) || "nothing"}. ${focus ? cap(onTable(false)) : menuLine()}`);
      if (on && on.order.mode === mode) { items = items.filter((i) => i !== on); decided += 1; }
      focus = null; pending = null; walking = false;
      const line = mode === "online" ? `On it. Helm is bringing ${cap(ship)} back online.` : `${cap(ship)} is the sandbox ship, so that is safe. Helm is taking it offline.`;
      last = line;
      return { say: line, hold: true, order: { ship, mode }, ui: null, view: { kind: "order", label: cap(ship), headline: mode === "online" ? "Helm is bringing it back online" : "Helm is taking it offline", lines: [], options: [], ships: [ship] } };
    }
    // What the officer says once the order is carried out and checked. It moves nothing: the endpoint that replays this
    // conversation never hears it, so the watch must stand exactly where the captain's own words left it.
    function report({ ship, mode, ok, checks = 2, ms = 0, seconds = 0 }) {
      const back = focus ? cap(onTable(false)) : restLine();
      const proof = `Checked ${checks === 2 ? "twice" : `${count(checks)} times`}${ms ? `, ${ms} milliseconds` : ""}.`;
      const line = !ok ? `Captain, ${cap(ship)} has not ${mode === "online" ? "answered" : "gone quiet"} after ${count(Math.round(seconds))} seconds. The order stands with Helm. Shall I try again?`
        : mode === "online" ? `Captain, ${cap(ship)} answers again. ${proof} ${back}` : `Captain, ${cap(ship)} is offline. ${proof} Say bring it online when you want it back.`;
      last = line;
      return { say: line, view: { kind: "order", label: cap(ship), headline: !ok ? "No answer yet" : mode === "online" ? "Answering again" : "Offline, as ordered", lines: [], options: ok && mode !== "online" ? ["bring it online"] : [], ships: [ship] } };
    }
    function present(topic, item) {
      whyAt = 0; pending = null;
      focus = { topic, item: item || (topic.group ? null : topic.items[0]) };
      if (focus.item) return say(`${focus.item.headline.replace(/\s*Shall I[^?]*\?\s*$/, "")} ${cap(offers(focus.item))}`);
      const names = list(topic.items.map(label));
      return say(`${topic.kind === "read" ? (topic.items.every((i) => i.fresh) ? `${cap(names)} ${topic.items.length > 1 ? "each have" : "has"} a fresh read from the Commander.` : `${cap(names)} ${topic.items.length > 1 ? "are" : "is"} overdue a Commander read.`) : `${cap(topic.label)}: ${names}.`} ${cap(groupOffers(topic))}`, topic.items[0].ui);
    }
    function why() {
      const it = focus && focus.item;
      // "Why?" with nothing on the table yet (the captain's first word after the opening) is a fair question about the
      // agenda itself, not a dead end: answer with the officer's own order of business.
      if (!focus) { const t = topics()[0]; if (!t) return menu(); pending = { pick: t }; return say(`Nothing is on the table yet. ${cap(t.label)} is the most pressing, because ${reason(t)}. Shall we take it?`); }
      if (!it) return say(`${focus.topic.items[0].why[0] || "Nothing more is attached."} ${cap(groupOffers(focus.topic))}`);
      const line = it.why[whyAt];
      if (!line) return say(`That is all I have on it. ${cap(offers(it, false))}`);
      whyAt += 1;
      return say(`${line} ${it.why[whyAt] ? "Want more, or shall we decide?" : cap(offers(it, false))}`);
    }
    const reason = (t) => { const r = (t.items[0].rationale || t.items[0].why[0] || "it is first on the agenda").replace(/\.$/, ""); return r.charAt(0).toLowerCase() + r.slice(1); };
    function recommend() {
      const it = focus && (focus.item || focus.topic.items[0]);
      if (!it) { const t = topics()[0]; if (!t) return menu(); pending = { pick: t }; return say(`I would start with ${t.label}. Shall we?`); }
      const verb = (VERBS[it.default] || { offer: it.default }).offer;
      pending = { decision: it.default };
      return say(`I would ${focus.item ? verb : verb.replace(" it", " them all")}. ${it.rationale || it.why[0] || ""} Shall I?`);
    }
    async function record(decision) {
      if (focus.item && focus.item.order && decision === "approve") return order({ ship: focus.item.ship, mode: focus.item.order.mode });
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
      const after = rest();
      return say(`${done} ${after.say}`, after.ui);
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
      // "Bring it back", said of a ship that stopped answering, is the order itself, not "bring it back to me later".
      if (r.intent === "decide" && r.decision === "defer" && focus && focus.item && focus.item.order && /\bbring\b/.test(norm(r.text))) return order({ ship: focus.item.ship });
      switch (r.intent) {
        case "control": return order(r);
        case "open": case "menu": case "greet": return menu(r.intent !== "menu");
        case "brief": return menu();
        case "repeat": return say(last || menu(true).say);
        case "unclear": return say(`I did not catch an order in that. ${focus ? cap(onTable(true)) : menu().say}`);
        case "busy": return say(`Give me about ${r.seconds || 30} seconds before my next considered answer. Meanwhile: ${focus ? onTable(true) : menu().say}`);
        case "thanks": return say(`Any time. ${focus ? cap(onTable(false)) : menu().say}`);
        case "close_watch": return { ...say(`Watch closed. ${decided ? `${cap(count(decided))} decision${decided === 1 ? "" : "s"} logged.` : "Nothing decided, nothing lost."} Fair winds, Captain.`), close: true };
        case "why": return why();
        case "more": return focus ? why() : menu();
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
      const ownItem = topics().some((t) => !t.group && t.items[0].ship === r.ship); // a ship with a topic of its own (a signal, an order waiting) is that topic
      const cockpit = ["open_ship", "read", "navigate"].includes(r.intent) && !(r.intent === "open_ship" && bare && (shipsOnTable || ownItem));
      if (!cockpit) {
        const heard = await hear(r.intent === "open_ship" ? { ...r, intent: "free" } : r);
        if (heard) return { kind: "watch", ...heard };
      }
      if (["open_ship", "read", "navigate"].includes(r.intent)) return { kind: "cockpit", route: r };
      // The brain is for real questions. A few stray words get the choices again, at once, instead of a slow guess.
      const question = /\?\s*$/.test(words) || /^(is|are|what|how|should|can|could|do|does|did|will|would|when|where|who|why|which|tell me|explain)\b/i.test(words.trim()) || words.trim().split(/\s+/).length >= 5;
      return question ? { kind: "question", words, ship: globalThis.officerShipWord(norm(words)) } : { kind: "watch", ...(await hear({ intent: "unclear" })) };
    }

    return { open: () => menu(true), hear, converse, report, state: () => ({ focus: focus && (focus.item ? focus.item.headline : focus.topic.label), options: focus ? (focus.item || focus.topic.items[0]).options : topics().map((t) => t.label), last, remaining: items.length }) };
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
