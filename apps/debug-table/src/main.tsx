import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleCards } from "@ptcg-fight/cards";
import {
  createInitialState,
  getLegalActions,
  resolveAction,
  serializePublicState,
  type GameAction,
  type GameEvent,
  type GameState,
  type PlayerId
} from "@ptcg-fight/engine";
import "./styles.css";

const p1Deck = ["sv1-001", "sv1-002", "sv1-003", "sv1-004", "sv1-005", "sv1-006", "sv1-007", "sv1-008", "sv1-009"];
const p2Deck = ["sv1-101", "sv1-102", "sv1-103", "sv1-104", "sv1-105", "sv1-106", "sv1-107", "sv1-108", "sv1-109"];

function createDebugState(): GameState {
  return createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: p1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: sampleCards,
    seed: "debug"
  });
}

function App() {
  const [state, setState] = useState(createDebugState);
  const [viewer, setViewer] = useState<PlayerId>("p1");
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibleState = useMemo(() => serializePublicState(state, viewer), [state, viewer]);
  const legalActions = getLegalActions(state, viewer);

  const dispatch = (action: GameAction) => {
    const result = resolveAction(state, action);
    if (!result.ok) {
      setError(`${result.error.code}: ${result.error.message}`);
      return;
    }
    setError(null);
    setState(result.state);
    setEvents((existing) => [...result.events, ...existing].slice(0, 30));
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>PTCG Fight Debug Table</h1>
          <p>Phase {state.phase} · Turn {state.turn.number} · Current {state.turn.playerId}</p>
        </div>
        <div className="toolbar">
          <button onClick={() => setViewer(viewer === "p1" ? "p2" : "p1")}>View {viewer === "p1" ? "P2" : "P1"}</button>
          <button onClick={() => navigator.clipboard.writeText(JSON.stringify(state, null, 2))}>Export JSON</button>
          <button onClick={() => { setState(createDebugState()); setEvents([]); setError(null); }}>Reset</button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="table">
        {state.playerOrder.map((playerId) => (
          <PlayerPanel key={playerId} state={visibleState} playerId={playerId} viewer={viewer} />
        ))}
      </section>

      <section className="actions">
        <h2>Legal Actions for {viewer}</h2>
        {state.pendingChoice?.playerId === viewer ? (
          <div className="choice-panel">
            <strong>{state.pendingChoice.prompt}</strong>
            <div className="action-grid">
              {state.pendingChoice.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() =>
                    dispatch({
                      playerId: viewer,
                      type: "RESOLVE_CHOICE",
                      payload: { choiceId: state.pendingChoice!.id, selectedOptionIds: [option.id] },
                      clientActionId: `choice-${Date.now()}-${option.id}`
                    })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="action-grid">
          {legalActions.map((action, index) => (
            <button
              key={`${action.type}-${index}`}
              onClick={() =>
                dispatch({
                  playerId: viewer,
                  type: action.type,
                  payload: (action.payload ?? {}) as never,
                  clientActionId: `debug-${Date.now()}-${index}`
                } as GameAction)
              }
            >
              {formatActionLabel(action)}
            </button>
          ))}
        </div>
      </section>

      <section className="log">
        <h2>Event Log</h2>
        {events.map((event) => (
          <pre key={event.seq}>{JSON.stringify(event, null, 2)}</pre>
        ))}
      </section>
    </main>
  );
}

function PlayerPanel({
  state,
  playerId,
  viewer
}: {
  state: ReturnType<typeof serializePublicState>;
  playerId: PlayerId;
  viewer: PlayerId;
}) {
  const player = state.players[playerId];
  const active = player.active ? state.instances[player.active.cardInstanceId] : undefined;
  const activeCard = active ? state.cards[active.cardId] : undefined;
  return (
    <article className={playerId === viewer ? "player current-viewer" : "player"}>
      <h2>{player.name}</h2>
      <div className="zones">
        <Zone label="Deck" value={zoneLabel(player.deck)} />
        <Zone label="Prizes" value={zoneLabel(player.prizes)} />
        <Zone label="Hand" value={zoneLabel(player.hand)} />
        <Zone label="Discard" value={`${player.discard.length}`} />
      </div>
      <div className="active">
        <span>Active</span>
        <strong>{activeCard?.languageRefs.zhHans?.name ?? activeCard?.languageRefs.en.name ?? "None"}</strong>
        {player.active ? <small>Damage {player.active.damage} · Energy {player.active.attachedEnergy.length}</small> : null}
      </div>
      <div className="bench">
        {Array.from({ length: state.ruleset.maxBenchSize }).map((_, index) => (
          <div key={index} className="bench-slot">{player.bench[index]?.cardInstanceId ?? "Bench"}</div>
        ))}
      </div>
    </article>
  );
}

function Zone({ label, value }: { label: string; value: string }) {
  return (
    <div className="zone">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function zoneLabel(zone: string[] | { count: number }): string {
  return Array.isArray(zone) ? `${zone.length}` : `${zone.count}`;
}

function formatActionLabel(action: ReturnType<typeof getLegalActions>[number]): string {
  const payload = action.payload;
  if (!payload) return action.type;
  if ("cardInstanceId" in payload) return `${action.type} · ${String(payload.cardInstanceId)}`;
  if ("evolutionCardInstanceId" in payload) return `${action.type} · ${String(payload.evolutionCardInstanceId)}`;
  if ("count" in payload) return `${action.type} · ${String(payload.count)}`;
  if ("benchIndex" in payload) return `${action.type} · Bench ${String(payload.benchIndex)}`;
  if ("choiceId" in payload) return `${action.type} · Choice`;
  return action.type;
}

createRoot(document.getElementById("root")!).render(<App />);
