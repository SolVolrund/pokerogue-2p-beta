import { FormModalUiHandler, type InputFieldConfig } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

export class LobbyIpFormUiHandler extends FormModalUiHandler {
  getModalTitle(_config?: ModalConfig): string {
    return "Enter IP Address";
  }

  getWidth(_config?: ModalConfig): number {
    return 180;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return ["Enter", "Cancel"];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: "IPv4", maxLength: 64 }];
  }

  show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;
    const defaultAddress = typeof args[1] === "string" ? args[1] : "";
    this.inputs[0].text = defaultAddress;
    this.submitAction = () => {
      this.sanitizeInputs();
      config.buttonActions[0](this.inputs[0].text);
      return true;
    };
    return true;
  }
}
