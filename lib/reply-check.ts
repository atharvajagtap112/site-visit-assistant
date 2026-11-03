/**
 * The last check on every assistant reply, run in code so a persuaded or confused model
 * still cannot reach the buyer with a discount or a number nobody gave it.
 *
 * It cannot catch a false claim with no number in it ("there is a swimming pool"). Those
 * rely on the prompt, the eval set and the sales head's review of flagged chats.
 */

export type CheckFailure = "discount" | "unsupported_number" | "unsupported_price";

const DISCOUNT_WORDS = [
  /\b(discount|discounts|discounted|offer price|cashback|waive|waiver|negotiat\w*|best price|final price)\b/i,
  /छूट|डिस्काउंट|रियायत|मोलभाव|अंतिम कीमत|फाइनल प्राइस/,
  /છૂટ|ડિસ્કાઉન્ટ|રાહત|ભાવતાલ|અંતિમ કિંમત|ફાઇનલ પ્રાઇસ/,
];

// A price word with no digits next to it ("पैंसठ लाख") is caught too: the words mean money.
const MONEY_UNIT =
  /₹|\brs\.?(?=\s|\d)|\binr\b|\brupees?\b|\blakhs?\b|\blacs?\b|\bcrores?\b|\bcr\b|रुपये|रुपए|लाख|करोड़|करोड|રૂપિયા|રૂ\.|લાખ|કરોડ/i;

const DEVANAGARI_ZERO = 0x0966;
const GUJARATI_ZERO = 0x0ae6;

/** Hindi and Gujarati digits become 0-9, so "૬૫ લાખ" is checked the same as "65 lakh". */
export function normaliseDigits(text: string) {
  return text.replace(/[०-९૦-૯]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= GUJARATI_ZERO ? GUJARATI_ZERO : DEVANAGARI_ZERO));
  });
}

function numbersIn(text: string) {
  const plain = normaliseDigits(text).replace(/(?<=\d),(?=\d)/g, "");
  return new Set(plain.match(/\d+(?:\.\d+)?/g) ?? []);
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const AFTER_SYMBOL = new RegExp(String.raw`(?:₹|\brs\.?|\binr|રૂ\.)\s*${NUMBER}`, "gi");
const BEFORE_WORD = new RegExp(
  String.raw`${NUMBER}\s*(?:lakhs?\b|lacs?\b|crores?\b|cr\b|rupees?\b|रुपये|रुपए|लाख|करोड़|करोड|રૂપિયા|લાખ|કરોડ)`,
  "gi",
);

function moneyAmounts(text: string) {
  const plain = normaliseDigits(text).replace(/(?<=\d),(?=\d)/g, "");
  return [...plain.matchAll(AFTER_SYMBOL), ...plain.matchAll(BEFORE_WORD)].map((m) => m[1]);
}

/**
 * Amounts of money must come from the fact sheet itself. Other numbers may also come from
 * `context` (tool results and the buyer's words). If a buyer asks "can you do 60 lakh?", that
 * must not make 60 lakh sayable. Returns the first rule the reply breaks, or null.
 */
export function checkReply(reply: string, facts: string, context = ""): CheckFailure | null {
  if (DISCOUNT_WORDS.some((word) => word.test(reply))) return "discount";

  if (MONEY_UNIT.test(reply)) {
    const allowed = new Set(moneyAmounts(facts));
    const amounts = moneyAmounts(reply);
    if (amounts.length === 0 || amounts.some((a) => !allowed.has(a))) return "unsupported_price";
  }

  const known = numbersIn(`${facts}\n${context}`);
  const withoutListMarkers = normaliseDigits(reply).replace(/^\s*\d+[.)]\s/gm, "");
  return [...numbersIn(withoutListMarkers)].some((n) => !known.has(n))
    ? "unsupported_number"
    : null;
}
