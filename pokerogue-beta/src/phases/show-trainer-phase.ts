import { globalScene } from "#app/global-scene";
import { PlayerGender } from "#enums/player-gender";
import { BattlePhase } from "#phases/battle-phase";

export class ShowTrainerPhase extends BattlePhase {
  public readonly phaseName = "ShowTrainerPhase";
  start() {
    super.start();

    const trainerBackKey = `trainer_${globalScene.gameData.gender === PlayerGender.FEMALE ? "f" : "m"}_back`;
    const playerTrainerX = globalScene.twoPlayerMode ? 90 : 106;

    globalScene.trainer
      .setVisible(true)
      .setTexture(trainerBackKey)
      .setFrame(0);
    globalScene.trainerPartner
      .setVisible(globalScene.twoPlayerMode)
      .setTexture(trainerBackKey)
      .setFrame(0);

    globalScene.tweens.add({
      targets: globalScene.trainer,
      x: playerTrainerX,
      duration: 1000,
      onComplete: () => {
        if (!globalScene.twoPlayerMode) {
          this.end();
        }
      },
    });
    if (globalScene.twoPlayerMode) {
      globalScene.tweens.add({
        targets: globalScene.trainerPartner,
        x: 122,
        duration: 1000,
        onComplete: () => this.end(),
      });
    }
  }
}
