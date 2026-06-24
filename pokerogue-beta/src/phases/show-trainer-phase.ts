import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";

export class ShowTrainerPhase extends BattlePhase {
  public readonly phaseName = "ShowTrainerPhase";
  start() {
    super.start();

    const hasPartnerTrainer = globalScene.getPlayerFieldOwners().length > 1;
    const playerTrainerX = globalScene.getTrainerBackSpriteX(0, hasPartnerTrainer);

    globalScene.trainer
      .setVisible(true)
      .setTexture(globalScene.getTrainerBackTextureKey(0))
      .setFrame(0);
    globalScene.trainerPartner
      .setVisible(hasPartnerTrainer)
      .setTexture(globalScene.getTrainerBackTextureKey(1))
      .setFrame(0);

    globalScene.tweens.add({
      targets: globalScene.trainer,
      x: playerTrainerX,
      duration: 1000,
      onComplete: () => {
        if (!hasPartnerTrainer) {
          this.end();
        }
      },
    });
    if (hasPartnerTrainer) {
      globalScene.tweens.add({
        targets: globalScene.trainerPartner,
        x: globalScene.getTrainerBackSpriteX(1, true),
        duration: 1000,
        onComplete: () => this.end(),
      });
    }
  }
}
