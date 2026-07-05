import { TrainerType } from "#enums/trainer-type";
import { toCamelCase, toTitleCase } from "#utils/strings";

export enum ContestCoordinatorType {
  UNKNOWN,
  COORDINATOR,
  ACE_TRAINER,
  AROMA_LADY,
  BEAUTY,
  BREEDER,
  CAMPER,
  COLLECTOR,
  EXPERT,
  COOL_TRAINER_F,
  FLOWERS_GIRL,
  GENTLEMAN,
  GREEN_SHOES_BOY,
  HEX_MANIAC,
  LASS,
  NINJA_BOY,
  POKEFAN,
  PSYCHIC,
  RICH_BOY,
  SCHOOL_KID,
  TRIATHLETE,
  TUBER,
  YELLOW_DRESS_GIRL,
  YOUNGSTER,
}

export class ContestCoordinatorConfig {
  public coordinatorType: ContestCoordinatorType;
  public name: string;
  public title: string;
  public trainerType?: TrainerType;
  public spriteKey?: string;

  constructor(coordinatorType: ContestCoordinatorType) {
    this.coordinatorType = coordinatorType;
    this.name = toTitleCase(ContestCoordinatorType[coordinatorType]);
    this.title = toCamelCase(this.name);
  }

  getKey(): string {
    return ContestCoordinatorType[this.coordinatorType].toString().toLowerCase();
  }

  getSpriteKey(): string {
    return this.spriteKey
      ?? (this.trainerType !== undefined ? TrainerType[this.trainerType].toString().toLowerCase() : this.getKey());
  }

  setName(name: string): ContestCoordinatorConfig {
    this.name = name;

    return this;
  }

  setTitle(title: string): ContestCoordinatorConfig {
    this.title = toCamelCase(title);

    return this;
  }

  setTrainerType(trainerType: TrainerType): ContestCoordinatorConfig {
    this.trainerType = trainerType;

    return this;
  }

  setSpriteKey(spriteKey: string): ContestCoordinatorConfig {
    this.spriteKey = spriteKey;

    return this;
  }
}

export const contestCoordinatorConfigs = {
  [ContestCoordinatorType.UNKNOWN]: new ContestCoordinatorConfig(ContestCoordinatorType.UNKNOWN),
  [ContestCoordinatorType.COORDINATOR]: new ContestCoordinatorConfig(ContestCoordinatorType.COORDINATOR),
  [ContestCoordinatorType.ACE_TRAINER]: new ContestCoordinatorConfig(ContestCoordinatorType.ACE_TRAINER).setTrainerType(
    TrainerType.ACE_TRAINER,
  ),
  [ContestCoordinatorType.AROMA_LADY]: new ContestCoordinatorConfig(ContestCoordinatorType.AROMA_LADY).setTrainerType(
    TrainerType.AROMA_LADY,
  ),
  [ContestCoordinatorType.BEAUTY]: new ContestCoordinatorConfig(ContestCoordinatorType.BEAUTY).setTrainerType(
    TrainerType.BEAUTY,
  ),
  [ContestCoordinatorType.BREEDER]: new ContestCoordinatorConfig(ContestCoordinatorType.BREEDER).setTrainerType(
    TrainerType.BREEDER,
  ),
  [ContestCoordinatorType.CAMPER]: new ContestCoordinatorConfig(ContestCoordinatorType.CAMPER).setTrainerType(
    TrainerType.CAMPER,
  ),
  [ContestCoordinatorType.COLLECTOR]: new ContestCoordinatorConfig(ContestCoordinatorType.COLLECTOR).setTrainerType(
    TrainerType.COLLECTOR,
  ),
  [ContestCoordinatorType.EXPERT]: new ContestCoordinatorConfig(ContestCoordinatorType.EXPERT),
  [ContestCoordinatorType.COOL_TRAINER_F]: new ContestCoordinatorConfig(ContestCoordinatorType.COOL_TRAINER_F)
    .setTrainerType(TrainerType.ACE_TRAINER),
  [ContestCoordinatorType.FLOWERS_GIRL]: new ContestCoordinatorConfig(ContestCoordinatorType.FLOWERS_GIRL),
  [ContestCoordinatorType.GENTLEMAN]: new ContestCoordinatorConfig(ContestCoordinatorType.GENTLEMAN),
  [ContestCoordinatorType.GREEN_SHOES_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.GREEN_SHOES_BOY),
  [ContestCoordinatorType.HEX_MANIAC]: new ContestCoordinatorConfig(ContestCoordinatorType.HEX_MANIAC).setTrainerType(
    TrainerType.HEX_MANIAC,
  ),
  [ContestCoordinatorType.LASS]: new ContestCoordinatorConfig(ContestCoordinatorType.LASS),
  [ContestCoordinatorType.NINJA_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.NINJA_BOY).setSpriteKey(
    "ninja_boy",
  ),
  [ContestCoordinatorType.POKEFAN]: new ContestCoordinatorConfig(ContestCoordinatorType.POKEFAN).setTrainerType(
    TrainerType.POKEFAN,
  ),
  [ContestCoordinatorType.PSYCHIC]: new ContestCoordinatorConfig(ContestCoordinatorType.PSYCHIC).setTrainerType(
    TrainerType.PSYCHIC,
  ),
  [ContestCoordinatorType.RICH_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.RICH_BOY).setTrainerType(
    TrainerType.RICH_KID,
  ),
  [ContestCoordinatorType.SCHOOL_KID]: new ContestCoordinatorConfig(ContestCoordinatorType.SCHOOL_KID).setTrainerType(
    TrainerType.SCHOOL_KID,
  ),
  [ContestCoordinatorType.TRIATHLETE]: new ContestCoordinatorConfig(ContestCoordinatorType.TRIATHLETE),
  [ContestCoordinatorType.TUBER]: new ContestCoordinatorConfig(ContestCoordinatorType.TUBER),
  [ContestCoordinatorType.YELLOW_DRESS_GIRL]: new ContestCoordinatorConfig(ContestCoordinatorType.YELLOW_DRESS_GIRL),
  [ContestCoordinatorType.YOUNGSTER]: new ContestCoordinatorConfig(ContestCoordinatorType.YOUNGSTER).setTrainerType(
    TrainerType.YOUNGSTER,
  ),
} as const satisfies Record<ContestCoordinatorType, ContestCoordinatorConfig>;
