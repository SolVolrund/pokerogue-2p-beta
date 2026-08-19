# Cleanup TODOs

## Fusion Form Ability Follow-Up

Donor-side form abilities now have shared plumbing for simple ability-triggered form changes, and the following have been enabled for fusions:

- Forecast
- Flower Gift
- Zen Mode
- Schooling
- Hunger Switch

These form abilities still need a more careful component-aware pass before removing their fusion blocks:

- Shields Down: form changes plus status/Yawn immunity still inspect body `formIndex`.
- Disguise: damage-block logic and battle reset/faint reversion need donor-aware form state.
- Power Construct: multiple conditions and form calculations inspect body `formIndex`.
- Ice Face: damage-block logic, weather reversion, and physical-hit behavior need donor-aware form state.
- Zero to Hero: switch-out transformation and message state need donor-aware form state.
- Tera Shift: summon transformation uses the active form key and should be checked against donor Terapagos behavior.
- Stance Change: Aegislash stance logic is not wired through the shared form-change attrs and needs its own donor-aware audit.
- Gulp Missile: Cramorant form/damage callbacks are specialized and need a separate donor-aware audit.

For each remaining ability, prefer updating every related sub-attr/condition to use the selected fusion component rather than only removing `NoFusionAbilityAbAttr`.
