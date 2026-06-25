import type { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";

export class TrainerData {
  public trainerType: TrainerType;
  public variant: TrainerVariant;
  public partyTemplateIndex: number;
  public nameKey: string;
  public partnerNameKey: string | undefined;
  public partnerNameKey2: string | undefined;
  public partnerTrainerType: TrainerType | undefined;
  public partnerTrainerType2: TrainerType | undefined;
  public partnerVariant: TrainerVariant | undefined;
  public partnerVariant2: TrainerVariant | undefined;

  constructor(source: Trainer | any) {
    const sourceTrainer = source instanceof Trainer ? (source as Trainer) : null;
    this.trainerType = sourceTrainer ? sourceTrainer.config.trainerType : source.trainerType;
    this.variant = Object.hasOwn(source, "variant")
      ? source.variant
      : source.female
        ? TrainerVariant.FEMALE
        : TrainerVariant.DEFAULT;
    this.partyTemplateIndex = sourceTrainer
      ? sourceTrainer.partyTemplateIndex
      : (source.partyTemplateIndex ?? source.partyMemberTemplateIndex);
    this.nameKey = source.nameKey;
    this.partnerNameKey = source.partnerNameKey;
    this.partnerNameKey2 = source.partnerNameKey2;
    this.partnerTrainerType = sourceTrainer ? sourceTrainer.partnerTrainerType : source.partnerTrainerType;
    this.partnerTrainerType2 = sourceTrainer ? sourceTrainer.partnerTrainerType2 : source.partnerTrainerType2;
    this.partnerVariant = sourceTrainer ? sourceTrainer.partnerVariant : source.partnerVariant;
    this.partnerVariant2 = sourceTrainer ? sourceTrainer.partnerVariant2 : source.partnerVariant2;
  }

  toTrainer(): Trainer {
    return new Trainer(
      this.trainerType,
      this.variant,
      this.partyTemplateIndex,
      this.nameKey,
      this.partnerNameKey,
      undefined,
      this.partnerTrainerType,
      this.partnerVariant,
      undefined,
      this.partnerTrainerType2,
      this.partnerVariant2,
      undefined,
      this.partnerNameKey2,
    );
  }
}
