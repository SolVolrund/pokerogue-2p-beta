import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import { recruitCrystalPokemon } from "#utils/crystal-recruitment";

export class CrystalRecruitmentPhase extends BattlePhase {
  public readonly phaseName = "CrystalRecruitmentPhase";
  private readonly playerIndex: PlayerIndex;

  constructor(playerIndex: PlayerIndex) {
    super();
    this.playerIndex = playerIndex;
  }

  public start(): void {
    super.start();
    globalScene.setInputOwner("none");
    this.recruit();
  }

  private async recruit(): Promise<void> {
    const messages = await recruitCrystalPokemon(this.playerIndex);
    await globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.waitForPlayerSideProgressionInput();
    messages.forEach(message => globalScene.phaseManager.queueMessage(message, null, true));
    this.end();
  }
}
