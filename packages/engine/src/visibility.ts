import type { GameState, PlayerId, PublicGameState, PublicPlayerState } from "./types";

export function serializePublicState(state: GameState, viewerId: PlayerId): PublicGameState {
  const players: Record<PlayerId, PublicPlayerState> = {};

  for (const [playerId, player] of Object.entries(state.players)) {
    const canSeePrivateZones = playerId === viewerId;
    players[playerId] = {
      ...player,
      hand: canSeePrivateZones ? [...player.hand] : { count: player.hand.length },
      deck: canSeePrivateZones ? [...player.deck] : { count: player.deck.length },
      prizes: canSeePrivateZones ? [...player.prizes] : { count: player.prizes.length }
    };
  }

  return {
    ...state,
    players
  };
}
