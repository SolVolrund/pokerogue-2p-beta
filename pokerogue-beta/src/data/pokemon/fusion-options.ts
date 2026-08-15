import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";

export type FusionComponent = "body" | "donor";
export type FusionNatureMode = FusionComponent | "mixed";
export type FusionTypeSlot = 0 | 1;

export class FusionOptions {
  public spriteBody: FusionComponent;
  public palette: FusionComponent;
  public statPrimary: FusionComponent;
  public bodyTypeSlot: FusionTypeSlot;
  public donorTypeSlot: FusionTypeSlot;
  public teraSource: FusionComponent;
  public abilitySource: FusionComponent;
  public natureMode: FusionNatureMode;
  public passiveSource: FusionComponent;
  public donorPassive: boolean;
  public donorNature: Nature | null;
  public moves: (MoveId | null)[];

  constructor(data?: Partial<FusionOptions>) {
    this.spriteBody = getFusionComponent(data?.spriteBody, "body");
    this.palette = getFusionComponent(data?.palette, "donor");
    this.statPrimary = getFusionComponent(data?.statPrimary, "body");
    this.bodyTypeSlot = getFusionTypeSlot(data?.bodyTypeSlot);
    this.donorTypeSlot = getFusionTypeSlot(data?.donorTypeSlot);
    this.teraSource = getFusionComponent(data?.teraSource, "body");
    this.abilitySource = getFusionComponent(data?.abilitySource, "donor");
    this.natureMode = getFusionNatureMode(data?.natureMode, "body");
    this.passiveSource = getFusionComponent(data?.passiveSource, "body");
    this.donorPassive = !!data?.donorPassive;
    this.donorNature = typeof data?.donorNature === "number" ? data.donorNature : null;
    this.moves = Array.isArray(data?.moves)
      ? data.moves.map(moveId => (typeof moveId === "number" ? moveId : null)).slice(0, 4)
      : [];
  }
}

function getFusionComponent(value: unknown, fallback: FusionComponent): FusionComponent {
  return value === "body" || value === "donor" ? value : fallback;
}

function getFusionNatureMode(value: unknown, fallback: FusionNatureMode): FusionNatureMode {
  return value === "mixed" ? value : getFusionComponent(value, fallback === "mixed" ? "body" : fallback);
}

function getFusionTypeSlot(value: unknown): FusionTypeSlot {
  return value === 1 ? 1 : 0;
}
