import type { GameEvent, GameState, PlayerId, PokemonSlot } from "./types";

type EventInput = Omit<GameEvent, "seq">;

export function nextEvent(state: GameState, event: EventInput): GameEvent {
  state.eventSeq += 1;
  return { seq: state.eventSeq, ...event };
}

export function moveTopDeckCardToHand(state: GameState, playerId: PlayerId): string | undefined {
  const player = state.players[playerId];
  const cardInstanceId = player.deck.shift();
  if (cardInstanceId) player.hand.push(cardInstanceId);
  return cardInstanceId;
}

export function placeDamageOnActive(
  state: GameState,
  playerId: PlayerId,
  amount: number
): { totalDamage: number } | undefined {
  const active = state.players[playerId].active;
  if (!active) return undefined;
  active.damage += amount;
  return { totalDamage: active.damage };
}

export function placeDamageOnSlot(
  slot: PokemonSlot,
  amount: number
): { totalDamage: number } {
  slot.damage += amount;
  return { totalDamage: slot.damage };
}
