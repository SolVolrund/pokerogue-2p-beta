import { FormModalUiHandler, type InputFieldConfig } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

export class LobbyJoinFormUiHandler extends FormModalUiHandler {
  getModalTitle(_config?: ModalConfig): string {
    return "Join Lobby";
  }

  getWidth(_config?: ModalConfig): number {
    return 240;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [48, 0, 0, 0];
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return ["Enter", "Cancel"];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [
      { label: "Lobby ID or Link", maxLength: 512 },
      { label: "Host/Hamachi IP", maxLength: 64 },
    ];
  }

  show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;
    this.inputs[0].text = "";
    this.inputs[1].text = "";
    this.submitAction = () => {
      this.sanitizeInputs();
      config.buttonActions[0](this.inputs[0].text, this.inputs[1].text);
      return true;
    };
    return true;
  }
}
