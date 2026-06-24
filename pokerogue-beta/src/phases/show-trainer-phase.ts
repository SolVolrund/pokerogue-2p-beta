import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";

export class ShowTrainerPhase extends BattlePhase {
  public readonly phaseName = "ShowTrainerPhase";
  start() {
    super.start();

    const playerIndexes = globalScene.getPlayerFieldOwners();
    const hasPartnerTrainer = playerIndexes.length > 1;
    let remainingTweens = playerIndexes.length;

    globalScene.getActivePlayerIndexes().forEach(playerIndex => {
      const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
      trainerSprite
        .setVisible(playerIndexes.includes(playerIndex))
        .setTexture(globalScene.getTrainerBackTextureKey(playerIndex))
        .setFrame(0);
    });

    playerIndexes.forEach(playerIndex => {
      globalScene.tweens.add({
        targets: globalScene.getPlayerTrainerBackSprite(playerIndex),
        x: globalScene.getTrainerBackSpriteX(playerIndex, hasPartnerTrainer),
        duration: 1000,
        onComplete: () => {
          remainingTweens--;
          if (remainingTweens <= 0) {
            this.end();
          }
        },
      });
    });

    if (remainingTweens === 0) {
      this.end();
    }
  }
}
