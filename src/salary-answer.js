/**
 * Salary answers, with the unit attached.
 *
 * A salary field is the one place where a bare number is actively dangerous:
 * the same "4500" means R$ 4.500/month, US$ 4,500/month or US$ 4,500/year
 * depending on a label the agent never read. Getting it wrong is not a typo —
 * it is off by 5x (currency) or 12x (period), in front of a recruiter, and it
 * cannot be taken back.
 *
 * So the answer is computed from the profile *and* the label, and the moment
 * either the currency or the period is unclear the answer is refused. Refusing
 * costs a manual review; guessing costs the application.
 */

const MONTHS_PER_YEAR = 12;
/** Brazilian CLT month, the convention behind a monthly figure quoted here. */
const HOURS_PER_MONTH = 176;

const CURRENCY_PATTERNS = [
  { currency: "BRL", pattern: /\bR\$|\bBRL\b|\breais?\b|\breal\b/i },
  { currency: "USD", pattern: /\bUS\$|\bUSD\b|\bd[óo]lar(?:es)?\b|\bdollars?\b/i },
  { currency: "EUR", pattern: /€|\bEUR\b|\beuros?\b/i }
];

const PERIOD_PATTERNS = [
  { period: "hour", pattern: /\bper hour\b|\bhourly\b|\b\/\s*h(?:our|r)?\b|\bpor hora\b|\bhora\b/i },
  { period: "year", pattern: /\bper year\b|\bannual(?:ly)?\b|\byearly\b|\bp\.?a\.?\b|\bpor ano\b|\banual\b|\bao ano\b|\banualmente\b/i },
  { period: "month", pattern: /\bper month\b|\bmonthly\b|\bpor m[êe]s\b|\bmensal(?:mente)?\b|\bao m[êe]s\b/i }
];

/** What the label asks for, or null for whichever part it does not say. */
export function readSalaryUnits(label) {
  const text = String(label || "");
  return {
    currency: CURRENCY_PATTERNS.find((item) => item.pattern.test(text))?.currency ?? null,
    // Order matters: "hour" is checked first so "hourly rate per year" cannot
    // be read as annual, and "year" before "month" so "annual" wins over a
    // stray "mensal" elsewhere in a long label.
    period: PERIOD_PATTERNS.find((item) => item.pattern.test(text))?.period ?? null
  };
}

/**
 * True when the field is about pay at all.
 *
 * "rate" only counts next to a period word: "Rate your experience with Go" is a
 * different question entirely, and matching it here would put a salary in it.
 */
export function isSalaryLabel(label) {
  const text = String(label || "");
  if (/salary|compensation|\bpay\b|sal[aá]rio|pretens[aã]o|remunera[cç][aã]o/i.test(text)) return true;
  return /\b(hourly|daily|monthly|annual)\s+rate\b|\brate\s+per\s+(hour|day|month|year)\b|taxa\s+hor[áa]ria|valor\s*\/?\s*hora/i.test(text);
}

/** Monthly figure the profile declares for a currency, or null. */
function monthlyFor(profile, currency) {
  const professional = profile?.professional || {};
  const amounts = {
    BRL: professional.expected_salary_brl_monthly,
    USD: professional.expected_salary_usd_gross_monthly
  };
  const value = Number(amounts[currency]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The value to type, or null when it cannot be known.
 *
 * Never converts between currencies: an exchange rate the user did not state is
 * a number this code invented, and it would go out as if they had said it.
 *
 * @returns {{value: string, currency: string, period: string, monthly: number}|null}
 */
export function resolveSalaryAnswer(label, profile) {
  if (!isSalaryLabel(label)) return null;

  const { currency, period } = readSalaryUnits(label);
  if (!currency || !period) return null;

  const monthly = monthlyFor(profile, currency);
  if (monthly === null) return null;

  const amount =
    period === "year" ? monthly * MONTHS_PER_YEAR
    : period === "hour" ? monthly / HOURS_PER_MONTH
    : monthly;

  // Whole units for month and year; hourly keeps two decimals or it rounds to
  // a number that is wrong by several percent.
  const value = period === "hour" ? amount.toFixed(2) : String(Math.round(amount));
  return { value, currency, period, monthly };
}

/** Why an answer was refused, for the audit trail. */
export function explainSalaryRefusal(label, profile) {
  if (!isSalaryLabel(label)) return null;
  const { currency, period } = readSalaryUnits(label);
  if (!currency && !period) return "moeda_e_periodo_nao_declarados_no_rotulo";
  if (!currency) return "moeda_nao_declarada_no_rotulo";
  if (!period) return "periodo_nao_declarado_no_rotulo";
  if (monthlyFor(profile, currency) === null) return `perfil_sem_pretensao_em_${currency.toLowerCase()}`;
  return null;
}
