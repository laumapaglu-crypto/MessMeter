export function calculateForecast({ strength, eating, skipping, popularity = 60, eventModifier = 0, learningFactor = 1 }) {
  const undecided = Math.max(0, strength - eating - skipping);
  const eatingEquivalent = eating;
  const expectedTurnout =
    (eatingEquivalent * 0.95 +
      undecided * (0.25 + 0.5 * (popularity / 100))) *
    (1 + eventModifier) *
    learningFactor;

  const platesToCook = Math.ceil(expectedTurnout * 1.05);
  const answered = eating + skipping;
  const responseRate = strength > 0 ? answered / strength : 0;

  let confidence = "Low";
  if (responseRate > 0.70) confidence = "High";
  else if (responseRate >= 0.40) confidence = "Medium";

  return {
    undecided,
    expectedTurnout: Number(expectedTurnout.toFixed(2)),
    platesToCook,
    responseRate: Number((responseRate * 100).toFixed(1)),
    confidence
  };
}
