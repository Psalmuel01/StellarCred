// @stellarcred/sdk — jurisdiction presets
//
// Named regional presets that expand to ISO 3166-1 numeric country-code sets
// for jurisdiction gating. A protocol can gate by a named region instead of
// hand-managing raw code lists, which removes a sharp edge and reduces
// mistakes in jurisdiction allow/deny logic.
//
// Each preset is a documented, immutable set of ISO 3166-1 numeric codes.
// They are used by `buildVerifyUrl` (and available for any witness-input
// use) via `resolveJurisdictionPreset`.

/**
 * A named jurisdiction preset: maps a preset name to the set of ISO 3166-1
 * numeric country codes it covers, plus a human-readable description.
 */
export interface JurisdictionPreset {
  /** Stable machine name, e.g. "eu", "us", "non-sanctioned". */
  name: JurisdictionPresetName;
  /** The ISO 3166-1 numeric codes in this preset. */
  codes: readonly string[];
  /** Short human description of what the preset covers. */
  description: string;
}

/**
 * Recognised preset names. Passing an unknown name to
 * {@link resolveJurisdictionPreset} throws a {@link JurisdictionPresetError}.
 */
export type JurisdictionPresetName =
  | "eu"
  | "eea"
  | "us"
  | "non-sanctioned";

/**
 * Thrown when an unrecognised preset name is passed to
 * {@link resolveJurisdictionPreset}. Lists the valid options so integrators
 * can self-correct.
 */
export class JurisdictionPresetError extends Error {
  constructor(name: string) {
    super(
      `Unknown jurisdiction preset "${name}". Valid presets: ` +
        Object.keys(JURISDICTION_PRESETS).join(", "),
    );
    this.name = "JurisdictionPresetError";
  }
}

// ── Preset definitions ─────────────────────────────────────────────────────
//
// ISO 3166-1 numeric codes: https://en.wikipedia.org/wiki/ISO_3166-1_numeric
// Codes are 3-digit strings, e.g. "840" = United States, "250" = France.

const EU_CODES = [
  "040", // Austria
  "056", // Belgium
  "100", // Bulgaria
  "191", // Croatia
  "196", // Cyprus
  "203", // Czechia
  "208", // Denmark
  "233", // Estonia
  "246", // Finland
  "250", // France
  "276", // Germany
  "300", // Greece
  "348", // Hungary
  "372", // Ireland
  "380", // Italy
  "428", // Latvia
  "440", // Lithuania
  "442", // Luxembourg
  "470", // Malta
  "528", // Netherlands
  "616", // Poland
  "620", // Portugal
  "642", // Romania
  "703", // Slovakia
  "705", // Slovenia
  "724", // Spain
  "752", // Sweden
] as const;

const EEA_CODES = [
  ...EU_CODES,
  "352", // Iceland
  "438", // Liechtenstein
  "578", // Norway
] as const;

const US_CODES = ["840"] as const; // United States

// A deliberately conservative, documentation-driven starter list of countries
// subject to broad international sanctions (US OFAC SDN / EU restrictive
// measures). This is NOT legal advice and MUST be reviewed against your
// jurisdiction's current restrictions before relying on it. The set is
// exposed as raw codes so integrators can override it to match their own
// compliance posture.
const NON_SANCTIONED_BLOCKED_CODES = [
  "004", // Afghanistan
  "112", // Belarus
  "140", // Central African Republic
  "180", // DR Congo
  "231", // Ethiopia
  "364", // Iran
  "408", // North Korea
  "716", // Zimbabwe
] as const;

/**
 * The named jurisdiction presets. Each expands to a set of ISO 3166-1
 * numeric codes that can be passed to `buildVerifyUrl`'s `restricted` /
 * `allow` options (or used as raw witness-input codes).
 *
 * Membership is exact and documented above. Presets are immutable; to
 * override, expand the desired preset and add/remove codes yourself — raw
 * code lists remain fully supported for custom cases.
 */
export const JURISDICTION_PRESETS: Record<JurisdictionPresetName, JurisdictionPreset> = {
  eu: {
    name: "eu",
    codes: [...EU_CODES],
    description: "European Union member states (27 countries).",
  },
  eea: {
    name: "eea",
    codes: [...EEA_CODES],
    description: "EEA countries (EU + Iceland, Liechtenstein, Norway).",
  },
  us: {
    name: "us",
    codes: [...US_CODES],
    description: "United States (ISO 3166-1 numeric 840).",
  },
  "non-sanctioned": {
    name: "non-sanctioned",
    codes: [...NON_SANCTIONED_BLOCKED_CODES],
    description:
      "Starter list of countries under broad international sanctions (blocked by default). Review before relying on it.",
  },
};

/** The set of known preset names. */
export const JURISDICTION_PRESET_NAMES = Object.keys(
  JURISDICTION_PRESETS,
) as readonly JurisdictionPresetName[];

/**
 * Resolve a preset name to its ISO 3166-1 numeric code set.
 *
 * Throws {@link JurisdictionPresetError} for unknown names so a typo surfaces
 * loudly rather than silently gating on an empty/wrong set.
 *
 * @example
 * import { resolveJurisdictionPreset } from "@stellarcred/sdk";
 *
 * // Allow only EU countries:
 * const sniff = resolveJurisdictionPreset("eu"); // ['040','056',…]
 *
 * // Named presets are overridable — expand and tweak for custom cases:
 * const euPlusUk = [...resolveJurisdictionPreset("eu"), "826"]; // + Great Britain
 */
export function resolveJurisdictionPreset(
  name: JurisdictionPresetName,
): readonly string[] {
  const preset = JURISDICTION_PRESETS[name];
  if (!preset) {
    throw new JurisdictionPresetError(name);
  }
  return preset.codes;
}
