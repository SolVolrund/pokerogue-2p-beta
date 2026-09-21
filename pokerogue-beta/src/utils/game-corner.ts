import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { randSeedInt } from "#utils/common";

export const GAME_CORNER_CPU_PAYOUT_WEIGHTS = Array.from({ length: 22 }, (_, index) => ({
  nuggies: index + 10,
  weight: Math.round(10000 * Math.exp(-0.5 * ((index + 10 - 21) / 4) ** 2)),
}));

export function rollGameCornerCpuNuggies(draw = randSeedInt): number {
  if (draw(100) === 0) {
    return 32;
  }
  let roll = draw(GAME_CORNER_CPU_PAYOUT_WEIGHTS.reduce((total, entry) => total + entry.weight, 0));
  for (const { nuggies, weight } of GAME_CORNER_CPU_PAYOUT_WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      return nuggies;
    }
  }
  return 31;
}

/** Synchronous RNG scope: other players' choices must not change this player's visit. */
export function withGameCornerSeed<T>(playerIndex: PlayerIndex, purpose: string, action: () => T): T {
  let result!: T;
  globalScene.executeWithSeedOffset(
    () => {
      result = action();
    },
    globalScene.currentBattle.waveIndex,
    `${globalScene.seed}:game-corner:${playerIndex}:${purpose}`,
  );
  return result;
}
