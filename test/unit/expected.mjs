// Expected results transcribed by hand from the KNOBE Protocol READMEs:
// test-vectors/README.md, adversarial/README.md, interpretation/README.md.
// "—" for body_verified on unreadable files is spec §7's mandated "omitted".
export const EXPECTED = {
  // core nine
  "minimal-valid.knobe.md": ["verified", null, "valid"],
  "full-valid.knobe.md": ["verified", null, "valid"],
  "body-modified.knobe.md": ["verified-body-modified", "modified", "valid"],
  "payload-modified.knobe.md": ["failed", null, "valid"],
  "unreadable.knobe.md": ["unreadable", "omitted", "invalid"],
  "unicode-valid.knobe.md": ["verified", null, "valid"],
  "numeric-violation.knobe.md": ["verified", null, "invalid"],
  "omitted-body-hash.knobe.md": ["verified", "omitted", "valid"],
  "multi-block.knobe.md": ["verified", "omitted", "warnings"],
  // adversarial ten
  "adversarial/bad-attribution-sources-type.knobe.md": ["verified", "omitted", "invalid"],
  "adversarial/bad-body-hash-format.knobe.md": ["verified-body-modified", "modified", "invalid"],
  "adversarial/bad-created-date.knobe.md": ["verified", "omitted", "invalid"],
  "adversarial/control-character-title.knobe.md": ["verified", "omitted", "valid"],
  "adversarial/duplicate-key.knobe.md": ["unreadable", "omitted", "invalid"],
  "adversarial/multi-block-warning.knobe.md": ["verified", "omitted", "warnings"],
  "adversarial/nfc-key-collision.knobe.md": ["unreadable", "omitted", "invalid"],
  "adversarial/no-frontmatter-valid-payload.knobe.md": ["verified", "omitted", "invalid"],
  "adversarial/payload-array.knobe.md": ["unreadable", "omitted", "invalid"],
  "adversarial/unsupported-spec-version.knobe.md": ["unreadable", "omitted", "invalid"],
  // interpretation six
  "interpretation/boolean-null-values.knobe.md": ["verified", "omitted", "valid"],
  "interpretation/spec-version-frontmatter-mismatch.knobe.md": ["verified", "omitted", "warnings"],
  "interpretation/begin-marker-mid-line.knobe.md": ["verified", "yes", "valid"],
  "interpretation/base64-unpadded.knobe.md": ["unreadable", "omitted", "invalid"],
  "interpretation/attribution-missing.knobe.md": ["verified", "omitted", "invalid"],
  "interpretation/astral-unicode-literal.knobe.md": ["verified", "omitted", "valid"],
};
// null body_verified = the README does not state it for that vector.
