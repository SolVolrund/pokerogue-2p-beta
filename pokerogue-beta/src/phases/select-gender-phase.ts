import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { PlayerGender } from "#enums/player-gender";
import {
  PLAYER_BOY_TRAINER_SPRITES,
  PLAYER_GIRL_TRAINER_SPRITES,
  PLAYER_TRAINER_SPRITE_OPTIONS,
} from "#enums/player-trainer-sprite";
import { UiMode } from "#enums/ui-mode";
import { SettingKeys } from "#system/settings";

export class SelectGenderPhase extends Phase {
  public readonly phaseName = "SelectGenderPhase";
  start(): void {
    super.start();

    globalScene.ui.showText("Choose your trainer.", null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, {
        options: PLAYER_TRAINER_SPRITE_OPTIONS.map(option => ({
          label: option.label,
          handler: () => {
            const genderSettingIndex = option.gender === PlayerGender.FEMALE ? 1 : 0;
            const trainerSpriteOptions =
              option.gender === PlayerGender.FEMALE ? PLAYER_GIRL_TRAINER_SPRITES : PLAYER_BOY_TRAINER_SPRITES;
            const trainerSpriteSettingKey =
              option.gender === PlayerGender.FEMALE
                ? SettingKeys.Player_Girl_Trainer_Sprite
                : SettingKeys.Player_Boy_Trainer_Sprite;
            globalScene.gameData.gender = option.gender;
            globalScene.gameData.saveSetting(SettingKeys.Player_Gender, genderSettingIndex);
            globalScene.gameData.saveSetting(trainerSpriteSettingKey, trainerSpriteOptions.indexOf(option.sprite));
            globalScene.gameData.saveSystem().then(() => this.end());
            return true;
          },
        })),
        maxOptions: 7,
      });
    });
  }

  end(): void {
    globalScene.ui.setMode(UiMode.MESSAGE);
    super.end();
  }
}
