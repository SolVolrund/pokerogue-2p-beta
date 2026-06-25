import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getTrainerSlotIndex, TrainerSlot } from "#enums/trainer-slot";

export abstract class BattlePhase extends Phase {
  showEnemyTrainer(trainerSlot: TrainerSlot = TrainerSlot.NONE): void {
    if (!globalScene.currentBattle.trainer) {
      console.warn("Enemy trainer is missing!");
      return;
    }
    const sprites = globalScene.currentBattle.trainer.getSprites();
    const tintSprites = globalScene.currentBattle.trainer.getTintSprites();
    const selectedTrainerIndex = Math.min(getTrainerSlotIndex(trainerSlot), sprites.length - 1);
    for (let i = 0; i < sprites.length; i++) {
      const visible = !trainerSlot || i === selectedTrainerIndex || sprites.length < 2;
      [sprites[i], tintSprites[i]].forEach(sprite => {
        if (visible) {
          sprite.x = trainerSlot || sprites.length < 2 ? 0 : (i - (sprites.length - 1) / 2) * 16;
        }
        sprite.setVisible(visible);
        sprite.clearTint();
      });
    }
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "-=16",
      y: "+=16",
      alpha: 1,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }

  hideEnemyTrainer(): void {
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }
}
