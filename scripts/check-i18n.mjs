import { messages } from "../src/i18n.js";

const locales = Object.keys(messages);
const referenceLocale = "en";
const referenceKeys = Object.keys(messages[referenceLocale]).sort();
const failures = [];

for (const locale of locales) {
  const keys = Object.keys(messages[locale]).sort();
  const missing = referenceKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !referenceKeys.includes(key));
  const empty = keys.filter((key) => !String(messages[locale][key]).trim());
  if (missing.length) failures.push(`${locale} missing: ${missing.join(", ")}`);
  if (extra.length) failures.push(`${locale} extra: ${extra.join(", ")}`);
  if (empty.length) failures.push(`${locale} empty: ${empty.join(", ")}`);
}

if (failures.length) {
  console.error("Internationalization check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Internationalization check passed: ${referenceKeys.length} keys across ${locales.length} locales.`
  );
}
