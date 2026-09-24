// The officer's hands on the Bridge. Every line the officer says carries a view of what is on the table; this puts that
// view on the screen and moves the cockpit to match, so the page always answers the last thing the captain said
// (founder, 2026-09-18: "every command should trigger the relevant part of UI"). Ships are marked and the rest dim;
// a single ship opens its own panel; the choices appear as buttons, so a judge can see what the words can do — and press
// them, through the very same conversation.
(() => {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ships = () => Array.from(document.querySelectorAll(".ship"));
  const findShip = (name) => { const q = norm(name); return q ? ships().find((s) => norm(s.dataset.app) === q) || null : null; };

  function create({ dock, bridge, showFleet, onChoice }) {
    const table = document.createElement("section");
    table.hidden = true;
    table.innerHTML = '<h3></h3><p></p><ul></ul><nav></nav>';
    dock.querySelector("form").before(table);
    const [heading, headline, list, choices] = ["h3", "p", "ul", "nav"].map((t) => table.querySelector(t));
    choices.addEventListener("click", (e) => { const b = e.target.closest("button[value]"); if (b) onChoice(b.value); });

    let openShip = "";
    const fill = (el, texts) => {
      if (el.childElementCount === texts.length && [...el.children].every((c, i) => c.textContent === texts[i])) return;
      el.replaceChildren(...texts.map((t) => { const li = document.createElement(el === choices ? "button" : "li"); li.textContent = t; if (el === choices) { li.type = "button"; li.value = t; } return li; }));
    };

    // The Bridge itself: the ships being discussed are marked, everything else recedes. A ship's own panel opens only when
    // the captain asks to see it (view.modal) — an item on the table marks its ship instead, or the panel would bury both
    // the fleet and the officer's own surface.
    function move(view) {
      const wanted = new Set((view.ships || []).map(norm));
      const alone = wanted.size === 1 ? [...wanted][0] : "";
      document.documentElement.dataset.officer = view.kind || "watch";
      for (const card of ships()) {
        const on = wanted.has(norm(card.dataset.app));
        if (on) card.dataset.officer = alone ? "focus" : "listed";
        else delete card.dataset.officer;
      }
      const show = view.modal && alone ? alone : "";
      if (show && show !== openShip) {
        const card = findShip(show);
        if (card) { try { bridge.openShip(card); openShip = show; } catch { /* the cockpit following is best effort */ } }
      } else if (!show) {
        // Back to the whole fleet: a panel left open, or focus mode left on by an earlier order, hides the very ships the
        // officer is talking about (seen 2026-09-18: one card on screen while four were on the table).
        if (openShip || document.querySelector("dialog[open]") || document.body.classList.contains("focus-mode")) showFleet();
        openShip = "";
      }
      // A topic with no ship may still have a panel of its own (heal → ops, contest → contests). It exists on the live
      // Bridge and is scrubbed out of the judges' snapshot, so this is best effort: found, it is marked and scrolled to.
      document.querySelectorAll("[data-officer='panel']").forEach((el) => delete el.dataset.officer);
      const name = view.ui && view.ui.panel;
      const panel = !wanted.size && name ? document.getElementById(`${name}-title`) || document.querySelector(`[data-search-keywords*="${name}"]`) || document.getElementById(name) : null;
      const section = panel && (panel.closest("section, article, details") || panel);
      if (section) section.dataset.officer = "panel";
      const first = wanted.size ? findShip([...wanted][0]) : null;
      const into = show ? null : section || first;
      if (into) into.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    return {
      // One call per officer line. `result` is what the watch returned: { say, view } (a cockpit order has no view).
      show(result) {
        const view = result && result.view;
        if (!view) return;
        table.hidden = false;
        table.dataset.kind = view.kind || "";
        heading.textContent = view.label || "";
        headline.textContent = view.headline || "";
        headline.hidden = !view.headline;
        fill(list, view.lines || []);
        list.hidden = !(view.lines || []).length;
        fill(choices, view.options || []);
        choices.hidden = !(view.options || []).length;
        move(view);
      },
      clear() {
        table.hidden = true;
        delete document.documentElement.dataset.officer;
        ships().forEach((card) => { delete card.dataset.officer; card.classList.remove("focused"); }); // the page's own ring too: a watch ends with nothing singled out
        openShip = "";
      },
    };
  }

  globalThis.officerCockpit = { create };
})();
