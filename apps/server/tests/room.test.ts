import { describe, expect, it } from "vitest";
import { createRoomStore, serializeResolveResultForViewer } from "../src/rooms";

describe("room store", () => {
  it("rejects illegal client actions through the authoritative engine", () => {
    const store = createRoomStore();
    const room = store.createRoom("r1");

    const rejected = store.dispatch(room.id, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-3", target: { playerId: "p2", zone: "active" } },
      clientActionId: "illegal"
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("ACTION_NOT_ALLOWED_IN_SETUP");
  });

  it("filters private events and hidden state for non-owning viewers", () => {
    const store = createRoomStore();
    const room = store.createRoom("r-private");

    for (const [playerId, cardInstanceId] of [
      ["p1", "p1-card-1"],
      ["p2", "p2-card-1"]
    ] as const) {
      const placed = store.dispatch(room.id, {
        playerId,
        type: "PLACE_ACTIVE",
        payload: { cardInstanceId },
        clientActionId: `active-${playerId}`
      });
      if (!placed.ok) throw new Error(placed.error.message);
    }

    const started = store.dispatch(room.id, {
      playerId: "p1",
      type: "START_GAME",
      payload: {},
      clientActionId: "start"
    });
    if (!started.ok) throw new Error(started.error.message);

    const trainerId = store.getRoom(room.id)?.state.players.p1.hand.find((id) => {
      const currentRoom = store.getRoom(room.id);
      const cardId = currentRoom?.state.instances[id]?.cardId;
      return cardId === "sv1-005";
    });
    if (!trainerId) throw new Error("expected draw trainer in p1 hand");

    const played = store.dispatch(room.id, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "draw"
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.events.some((event) => event.type === "CARD_DRAWN")).toBe(true);

    const p1View = serializeResolveResultForViewer(played, "p1");
    const p2View = serializeResolveResultForViewer(played, "p2");
    expect(p1View.ok).toBe(true);
    expect(p2View.ok).toBe(true);
    if (!p1View.ok || !p2View.ok) return;

    expect(p1View.events.some((event) => event.type === "CARD_DRAWN")).toBe(true);
    expect(p2View.events.some((event) => event.type === "CARD_DRAWN")).toBe(false);
    expect(Array.isArray(p1View.state.players.p1.hand)).toBe(true);
    expect(p2View.state.players.p1.hand).toEqual({ count: expect.any(Number) });
  });
});
