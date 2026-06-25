export enum TrainerSlot {
  NONE,
  TRAINER,
  TRAINER_PARTNER,
  TRAINER_PARTNER_2,
}

export function getTrainerSlotForFieldIndex(fieldIndex: number): TrainerSlot {
  switch (fieldIndex) {
    case 1:
      return TrainerSlot.TRAINER_PARTNER;
    case 2:
      return TrainerSlot.TRAINER_PARTNER_2;
    default:
      return TrainerSlot.TRAINER;
  }
}

export function getTrainerSlotIndex(trainerSlot: TrainerSlot): number {
  switch (trainerSlot) {
    case TrainerSlot.TRAINER_PARTNER:
      return 1;
    case TrainerSlot.TRAINER_PARTNER_2:
      return 2;
    default:
      return 0;
  }
}
