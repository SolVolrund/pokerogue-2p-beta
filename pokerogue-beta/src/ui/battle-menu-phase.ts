import { globalScene } from "#app/global-scene";
import type { CommandPhase } from "#phases/command-phase";
import type { EnemyCommandPhase } from "#phases/enemy-command-phase";
import type { PrivateFightPhase } from "#phases/private-fight-phase";

export type BattleMenuPhase = CommandPhase | EnemyCommandPhase | PrivateFightPhase;

export function getBattleMenuPhase(): BattleMenuPhase {
  const phase = globalScene.phaseManager.getCurrentPhase();
  if (phase.is("CommandPhase") || phase.is("EnemyCommandPhase") || phase.is("PrivateFightPhase")) return phase;
  return globalScene.phaseManager.getStandbyPhase() as CommandPhase | EnemyCommandPhase;
}
