import { type FormModalConfig, FormModalUiHandler, type InputFieldConfig } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";
import { normalizePlayerDisplayName, PLAYER_DISPLAY_NAME_MAX_LENGTH } from "#utils/player-display-name";

export class PlayerNameFormUiHandler extends FormModalUiHandler {
  getModalTitle(): string {
    return "Player Name";
  }

  getWidth(): number {
    return 200;
  }

  getMargin(): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  getButtonLabels(): string[] {
    return ["Save", "Cancel"];
  }

  getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: "Name", maxLength: PLAYER_DISPLAY_NAME_MAX_LENGTH }];
  }

  show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;
    this.inputs[0].text = normalizePlayerDisplayName(args[1]);
    this.submitAction = () => {
      const name = normalizePlayerDisplayName(this.inputs[0].text);
      if (!name) {
        const errorConfig: FormModalConfig = { ...config, errorMessage: "Please enter a player name." };
        this.updateContainer(errorConfig);
        return;
      }
      config.buttonActions[0](name);
    };
    return true;
  }
}
