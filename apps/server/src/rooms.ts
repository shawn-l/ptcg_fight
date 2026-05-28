import { sampleCards } from "@ptcg-fight/cards";
import {
  createInitialState,
  type GameAction,
  type GameState,
  type ResolveResult,
  resolveAction
} from "@ptcg-fight/engine";

const p1Deck = ["sv1-001", "sv1-002", "sv1-003", "sv1-004", "sv1-005", "sv1-006", "sv1-007", "sv1-008", "sv1-009"];
const p2Deck = ["sv1-101", "sv1-102", "sv1-103", "sv1-104", "sv1-105", "sv1-106", "sv1-107", "sv1-108", "sv1-109"];

export type Room = {
  id: string;
  state: GameState;
};

export type RoomStore = {
  createRoom: (id?: string) => Room;
  getRoom: (id: string) => Room | undefined;
  dispatch: (id: string, action: GameAction) => ResolveResult;
};

export function createRoomStore(): RoomStore {
  const rooms = new Map<string, Room>();

  return {
    createRoom(id = cryptoSafeId()) {
      const room: Room = {
        id,
        state: createInitialState({
          id,
          players: [
            { id: "p1", name: "Player 1", deck: p1Deck },
            { id: "p2", name: "Player 2", deck: p2Deck }
          ],
          cards: sampleCards,
          seed: id
        })
      };
      rooms.set(room.id, room);
      return room;
    },
    getRoom(id) {
      return rooms.get(id);
    },
    dispatch(id, action) {
      const room = rooms.get(id);
      if (!room) {
        const fallback = this.createRoom(id);
        return { ok: false, state: fallback.state, error: { code: "ROOM_NOT_FOUND", message: "Room does not exist" } };
      }
      const result = resolveAction(room.state, action);
      if (result.ok) {
        room.state = result.state;
      }
      return result;
    }
  };
}

function cryptoSafeId(): string {
  return `room-${Math.random().toString(36).slice(2, 10)}`;
}
