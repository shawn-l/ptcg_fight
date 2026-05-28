import { describe, expect, it } from "vitest";
import { createRoomStore } from "../src/rooms";

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
});
