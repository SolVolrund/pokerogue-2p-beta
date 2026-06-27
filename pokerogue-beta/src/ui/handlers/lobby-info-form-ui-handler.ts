import { FormModalUiHandler, type InputFieldConfig } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

interface LobbyInfoFormConfig extends ModalConfig {
  fields?: { label: string; value: string }[];
}

export class LobbyInfoFormUiHandler extends FormModalUiHandler {
  getModalTitle(_config?: ModalConfig): string {
    return "Lobby Created";
  }

  getWidth(_config?: ModalConfig): number {
    return 260;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [24, 0, 0, 0];
  }

  getButtonTopMargin(): number {
    return 8;
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return ["Enter", "Cancel"];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [
      { label: "Lobby ID", isReadOnly: true, maxLength: 512 },
      { label: "Web Address", isReadOnly: true, maxLength: 512 },
      { label: "Player 2 Link", isReadOnly: true, maxLength: 512 },
      { label: "Player 3 Link", isReadOnly: true, maxLength: 512 },
    ];
  }

  show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as LobbyInfoFormConfig;
    const fields = config.fields ?? [];
    for (const [index, input] of this.inputs.entries()) {
      const field = fields[index];
      input.text = field?.value ?? "";
      input.setVisible(!!field);
      this.inputContainers[index].setVisible(!!field).setActive(!!field);
      this.formLabels[index].setText(field?.label ?? "");
      this.formLabels[index].setVisible(!!field);
    }
    return true;
  }
}
