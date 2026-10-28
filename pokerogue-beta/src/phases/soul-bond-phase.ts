import { BattlePhase } from "#phases/battle-phase";
import { redistributeSoulBondHp } from "#utils/soul-bond";

/** Runs after turn-end residual effects and their queued faint/revival phases finish. */
export class SoulBondPhase extends BattlePhase {
  public readonly phaseName = "SoulBondPhase";

  override start(): void {
    super.start();
    redistributeSoulBondHp();
    this.end();
  }
}
