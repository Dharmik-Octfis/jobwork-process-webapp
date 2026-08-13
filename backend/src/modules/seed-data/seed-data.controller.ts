import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.ts';
import type { ApiEnvelope } from '../../lib/apiResponse.ts';
import { createMemoryCache } from '../../lib/memoryCache.ts';

/**
 * Global geo + industry reference data, served to every client that renders an
 * address form.
 *
 * WHY THIS ONE IS CACHED IN INSTANCE MEMORY (L1) AND NOT IN CATALYST CACHE
 * The payload is large — `prisma/data/states.json` is ~347 KB and
 * `cities-in.json` ~203 KB — and it is built from a nested join that pulls every
 * city of every state. Uncached, each request pays that join, plus serializing
 * roughly half a megabyte of JSON.
 *
 * Putting it in a shared cache would replace the join with a network fetch of
 * ~500 KB followed by a `JSON.parse` of ~500 KB on every request — real work,
 * every time. Holding it in memory costs one variable read.
 *
 * The usual objection to instance memory (`ARCHITECTURE_AND_TECH_STACK.md:269` —
 * instances share none) does not apply here, because there is nothing to keep in
 * sync: `countries`, `states`, `cities` and `industries` are master-data
 * reference tables. They change when someone reseeds, not when a user acts. Each
 * instance warms its own copy with one query and is then correct until the TTL
 * lapses.
 *
 * The response body is cached **already serialized**, so a hit skips the query
 * AND the `JSON.stringify`. That is why this is the one controller that writes
 * the envelope itself instead of calling `sendSuccess` — the bytes are identical
 * (see the `ApiEnvelope` annotation below, which is what keeps them identical),
 * they are simply produced once instead of per request.
 */

const MASTER_CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'AFN', name: 'Afghan Afghani', symbol: 'AFN' },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'ALL' },
  { code: 'AMD', name: 'Armenian Dram', symbol: 'AMD' },
  { code: 'ANG', name: 'Netherlands Antillian Guilder', symbol: 'ANG' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'AOA' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'ARS' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'AWG', name: 'Aruban Florin', symbol: 'Afl.' },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM' },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD' },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu' },
  { code: 'BMD', name: 'Bermudian Dollar', symbol: 'BD$' },
  { code: 'BND', name: 'Brunei Dollar', symbol: 'B$' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'BSD', name: 'Bahamian Dollar', symbol: 'B$' },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.' },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br' },
  { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COL$' },
  { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
  { code: 'CUP', name: 'Cuban Peso', symbol: '$MN' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: 'Esc' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr.' },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$' },
  { code: 'FKP', name: 'Falkland Islands Pound', symbol: 'FK£' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'GIP', name: 'Gibraltar Pound', symbol: '£' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG' },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
  { code: 'GYD', name: 'Guyanaese Dollar', symbol: 'GY$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn' },
  { code: 'HTG', name: 'Haitian Gourde', symbol: 'G' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD' },
  { code: 'IRR', name: 'Iranian Rial', symbol: '﷼' },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'KGS', name: 'Kyrgystani Som', symbol: 'сом' },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF' },
  { code: 'KPW', name: 'North Korean Won', symbol: '₩' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
  { code: 'KYD', name: 'Cayman Islands Dollar', symbol: 'CI$' },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
  { code: 'LAK', name: 'Laotian Kip', symbol: '₭' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'L£' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$' },
  { code: 'LSL', name: 'Lesotho Batchi', symbol: 'L' },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'LD' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD' },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'L' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'den' },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'Ks' },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
  { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$' },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT' },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रु' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/.' },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'din.' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'RF' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SR' },
  { code: 'SBD', name: 'Solomon Islands Dollar', symbol: 'SI$' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SR' },
  { code: 'SDG', name: 'Sudanese Pound', symbol: 'SDG' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'SHP', name: 'Saint Helena Pound', symbol: '£' },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'S' },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: 'SRD$' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: 'SSP' },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'Db' },
  { code: 'SYP', name: 'Syrian Pound', symbol: 'LS' },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'E' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'SM' },
  { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'DT' },
  { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: 'soʻm' },
  { code: 'VES', name: 'Venezuelan Bolívar Sovereign', symbol: 'Bs.S' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT' },
  { code: 'WST', name: 'Samoan Tala', symbol: 'WS$' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
  { code: 'XPF', name: 'CFP Franc', symbol: '₣' },
  { code: 'YER', name: 'Yemeni Rial', symbol: 'YR' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
  { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: 'Z$' },
];

interface SeedData {
  industries: { id: string; code: string; name: string }[];
  states: {
    code: string;
    name: string;
    countryCode: string;
    cities: { id: string; name: string }[];
  }[];
  countries: { id: string; name: string; code: string; isoCode: string; dialCode: string }[];
  currencies: { code: string; name: string; symbol: string }[];
}

interface CachedResponse {
  /** The full `{ statusCode, message, data }` envelope, pre-serialized. */
  body: string;
  /** Strong ETag over `body`, so a repeat client can be answered with a 304. */
  etag: string;
}

/**
 * Six hours: long, because this data only changes on a reseed, but not infinite,
 * so a reseed reaches every running instance the same day without a redeploy.
 * Restarting the app clears it immediately.
 */
const SEED_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'seed:geo';

const seedCache = createMemoryCache<CachedResponse>({ ttlMs: SEED_TTL_MS, maxEntries: 1 });

/** Exported for the reseed path and for tests — drops this instance's copy. */
export function invalidateSeedDataCache(): void {
  seedCache.clear();
}

async function loadSeedData(): Promise<SeedData> {
  const [industries, states, countries] = await Promise.all([
    prisma.industry.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.state.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        countryCode: true,
        cities: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, isoCode: true, dialCode: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return { industries, states, countries, currencies: MASTER_CURRENCIES };
}

async function getCachedResponse(): Promise<CachedResponse> {
  const hit = seedCache.get(CACHE_KEY);
  if (hit) return hit;

  const data = await loadSeedData();

  // Annotated as ApiEnvelope so this stays byte-identical to what `sendSuccess`
  // would emit — if that shape ever changes, this fails to compile rather than
  // silently drifting from every other endpoint.
  const envelope: ApiEnvelope<SeedData> = { statusCode: 200, message: 'Success', data };
  const body = JSON.stringify(envelope);

  const fresh: CachedResponse = {
    body,
    etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
  };
  seedCache.set(CACHE_KEY, fresh);
  return fresh;
}

// No try/catch — Express 5 sends a rejected promise to `errorHandler`.
export async function getSeedData(req: Request, res: Response) {
  const { body, etag } = await getCachedResponse();

  res.setHeader('ETag', etag);
  // `private`: the payload is identical for everyone, but the route sits behind
  // `authenticate`, and a shared proxy must not serve it to an unauthenticated
  // caller just because someone signed in earlier.
  res.setHeader('Cache-Control', 'private, max-age=3600');

  // The client already holds this exact body — answer with 304 and no payload.
  // This is the one legitimate empty-bodied response in the API: unlike a 204,
  // a 304 is not "success with no data", it is "reuse what you have", and the
  // envelope it refers to is the one we sent the first time.
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.type('application/json').send(body);
}
