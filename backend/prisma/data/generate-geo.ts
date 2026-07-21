// Generates the geography reference JSON that seed.ts consumes, from a LOCAL copy
// of the dr5hn "countries-states-cities-database" export (download the full ZIP
// from its GitHub Releases — the repo tree has no standalone cities.json; cities
// live inside countries+states+cities.json). Point this at the export's json/
// folder, via argument or the GEO_SRC env var:
//
//   npx tsx prisma/data/generate-geo.ts "C:/path/to/export/json"
//   GEO_SRC="C:/path/to/export/json" npx tsx prisma/data/generate-geo.ts
//
// Output (small — commit these): countries.json (world), states.json (world),
// cities-in.json (India only). Re-run whenever you refresh the dataset.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = process.argv[2] ?? process.env['GEO_SRC'];
if (!SRC) {
  console.error('Pass the dr5hn export json/ folder as an argument or via GEO_SRC.');
  process.exit(1);
}
const OUT_DIR = fileURLToPath(new URL('.', import.meta.url));
const read = <T>(file: string): T => JSON.parse(readFileSync(join(SRC, file), 'utf8')) as T;

// dr5hn export shapes. The snake_case keys are the third-party dataset's own
// field names (not ours), so naming-convention is disabled for these types only.
/* eslint-disable @typescript-eslint/naming-convention */
type RawCountry = { name: string; iso2: string; iso3: string; phonecode: string };
type RawState = { name: string; country_code: string; iso3166_2: string };
type NestedCity = { name: string };
type NestedState = { iso3166_2: string; cities: NestedCity[] };
type NestedCountry = { iso2: string; states: NestedState[] };
/* eslint-enable @typescript-eslint/naming-convention */

function main() {
  const rawCountries = read<RawCountry[]>('countries.json');
  const rawStates = read<RawState[]>('states.json');
  const nested = read<NestedCountry[]>('countries+states+cities.json');

  // --- countries (whole world) ---------------------------------------------
  // dialCode: "+" + phonecode; a few dependencies have none and become "" (the
  // column is NOT NULL but allows empty). Drop anything that overflows VARCHAR(8).
  const countries = rawCountries
    .filter((c) => c.iso2 && c.iso3)
    .map((c) => ({
      name: c.name,
      code: c.iso2,
      isoCode: c.iso3,
      dialCode: c.phonecode ? `+${String(c.phonecode).replace(/^\+/, '')}` : '',
    }))
    .filter((c) => c.dialCode.length <= 8);
  const countryCodes = new Set(countries.map((c) => c.code));

  // --- states (whole world) ------------------------------------------------
  // `iso3166_2` is already the full ISO 3166-2 code ("IN-GJ"). Skip rows with no
  // code, a dropped country, or a code that overflows VARCHAR(6) (a few non-ISO).
  const skipped: string[] = [];
  const states = rawStates
    .filter((s) => s.iso3166_2 && countryCodes.has(s.country_code))
    .map((s) => ({ code: s.iso3166_2, name: s.name, countryCode: s.country_code }))
    .filter((s) => {
      if (s.code.length <= 6) return true;
      skipped.push(s.code);
      return false;
    });
  const stateCodes = new Set(states.map((s) => s.code));

  // --- cities (INDIA only) -------------------------------------------------
  // Flatten India's states -> cities from the nested file; keep only cities whose
  // state survived above (FK safety).
  const india = nested.find((c) => c.iso2 === 'IN');
  const cities = (india?.states ?? [])
    .flatMap((s) => s.cities.map((ci) => ({ name: ci.name, stateCode: s.iso3166_2 })))
    .filter((c) => stateCodes.has(c.stateCode));

  writeFileSync(`${OUT_DIR}countries.json`, JSON.stringify(countries));
  writeFileSync(`${OUT_DIR}states.json`, JSON.stringify(states));
  writeFileSync(`${OUT_DIR}cities-in.json`, JSON.stringify(cities));
  console.log(
    `Wrote countries=${countries.length}, states=${states.length} ` +
      `(skipped ${skipped.length} over 6 chars), india-cities=${cities.length}`,
  );
}

main();
