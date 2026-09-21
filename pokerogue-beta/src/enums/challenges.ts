export enum Challenges {
  SINGLE_GENERATION,
  SINGLE_TYPE,
  LOWER_MAX_STARTER_COST,
  LOWER_STARTER_POINTS,
  FRESH_START,
  INVERSE_BATTLE,
  FLIP_STAT,
  LIMITED_CATCH,
  LIMITED_SUPPORT,
  HARDCORE,
  PASSIVES,
  SINGLE_TYPE_P1,
  SINGLE_TYPE_P2,
  SINGLE_TYPE_P3,
}

export function isSingleTypeChallenge(id: Challenges): boolean {
  return (
    id === Challenges.SINGLE_TYPE
    || id === Challenges.SINGLE_TYPE_P1
    || id === Challenges.SINGLE_TYPE_P2
    || id === Challenges.SINGLE_TYPE_P3
  );
}
