import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getEnemyPlayerTokenRewardOptions } from "#data/vs-enemy-tokens";
import { UiMode } from "#enums/ui-mode";
import { EnemyPersistentModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";

const ENEMY_PLAYER_TOKEN_REWARD_COUNT = 3;
const ENEMY_PLAYER_TOKEN_REWARD_SEED_OFFSET = 90000;

export class EnemyPlayerTokenRewardPhase extends BattlePhase {
  public readonly phaseName = "EnemyPlayerTokenRewardPhase";

  public start(): void {
    super.start();

    globalScene.resetSeed((globalScene.currentBattle?.waveIndex ?? 0) + ENEMY_PLAYER_TOKEN_REWARD_SEED_OFFSET);
    globalScene.waitForEnemyPlayerInput();

    const tokenOptions = getEnemyPlayerTokenRewardOptions(
      ENEMY_PLAYER_TOKEN_REWARD_COUNT,
      globalScene.findModifiers(modifier => modifier instanceof EnemyPersistentModifier, false),
    );

    if (tokenOptions.length === 0) {
      this.end();
      return;
    }

    const optionItems: OptionSelectItem[] = tokenOptions.map(tokenOption => ({
      label: tokenOption.type.name,
      item: tokenOption.type.iconImage,
      handler: () => {
        const modifier = tokenOption.type.newModifier() as EnemyPersistentModifier | null;
        if (!modifier) {
          globalScene.ui.playError();
          return false;
        }

        void globalScene.addEnemyModifier(modifier, false, true).then(() => {
          audioManager.playSound(tokenOption.type.soundName);
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
            globalScene.ui.showText(
              `Enemy Player obtained ${tokenOption.type.name}.`,
              null,
              () => {
                globalScene.ui.clearText();
                globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("enemy-player-token-reward-picked");
                this.end();
              },
              null,
              true,
            );
          });
        });

        return true;
      },
      onHover: () => {
        globalScene.ui.showText(tokenOption.type.getDescription());
      },
    }));

    globalScene.ui.showText("Enemy Player reward", null, () => {
      globalScene.ui.setModeWithoutClear(
        UiMode.OPTION_SELECT,
        {
          options: optionItems,
          noCancel: true,
          supportHover: true,
        },
        null,
        true,
      );
    });
  }
}
