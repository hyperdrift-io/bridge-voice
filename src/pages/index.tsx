// Static shell only. Per lablab rules, the core (voice pipeline, agent logic,
// MCP wiring) is built inside the September 1-30 contest window.
export default async function HomePage() {
  return (
    <div>
      <title>Bridge Voice — talk to your fleet</title>

      <h1>Bridge Voice</h1>
      <p>
        Speak, and a live fleet of apps moves. Bridge Voice turns a spoken
        command into real MCP tool calls against Hyperdrift&rsquo;s production
        fleet — &ldquo;how did revela do overnight?&rdquo;, &ldquo;what shipped
        yesterday?&rdquo; — and answers back in voice with the real numbers.
      </p>
      <p>
        The heartbeat is AssemblyAI&rsquo;s Voice Agent API: one WebSocket that
        streams your words to the screen as you say them, detects the instant
        your command is complete, and fires the tool — no push-to-talk, no
        submit button.
      </p>
      <p>
        Building September 1&ndash;30 for the AssemblyAI Voice Agent Hackathon.
        The mic goes live when the window opens.
      </p>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
