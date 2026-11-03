/**
 * The last check on every assistant reply, run in code so a persuaded or confused model still
 * cannot reach the buyer with a discount or a number nobody gave it. It fails safe: anything it
 * cannot prove came from the fact sheet is withheld, and a person takes over.
 *
 * Known limits: it cannot catch a false claim with no number in it ("there is a swimming pool"),
 * a bare fact-sheet number used as a price ("for you, 2"), or every way of spelling a number.
 * Those rely on the prompt, the eval set and the sales head's review of flagged chats.
 */

/** True if the buyer is asking about a discount or the assistant is talking about one. */
export const mentionsDiscount = (text: string) => {
  const plain = normalise(text);
  return (
    DISCOUNT_PATTERNS.some((pattern) => pattern.test(plain)) ||
    SQUEEZED_DISCOUNT.test(plain.replace(/[^\p{L}]/gu, ""))
  );
};

// Promising a person, in any language. If the reply does this, a real handoff has to happen.
const PROMISES_PERSON =
  /sales team|sales executive|salesperson|our team|a person|someone from|सेल्स टीम|सेल्स एग्जीक्यूटिव|हमारी टीम|कोई व्यक्ति|एक व्यक्ति|સેલ્સ ટીમ|અમારી ટીમ|કોઈ વ્યક્તિ|એક વ્યક્તિ/i;

export const promisesPerson = (reply: string) => PROMISES_PERSON.test(normalise(reply));

export type CheckFailure = "discount" | "unsupported_number" | "unsupported_price";

const LETTER_BEFORE = String.raw`(?<![\p{L}\p{M}])`;
const LETTER_AFTER = String.raw`(?![\p{L}\p{M}])`;

const DISCOUNT_PATTERNS = [
  /discount|waiv|rebate|concession|cashback|negotiat|bargain/i,
  /(offer|best|lowest|lower|reduced?|special|final|all[\s-]*inclusive)[\s-]+(\w+[\s-]+)?(price|prices|cost|rate|deal|offer|amount)/i,
  /(reduce|lower|cut)\s+(\w+\s+)?(price|cost)/i,
  /छूट|छुट|डिस्काउंट|डिसकाउंट|रियायत|मोलभाव|कैशबैक|ऑफर|अंतिम\s*(कीमत|दाम|मूल्य)|फाइनल\s*(कीमत|प्राइस|दाम)|कम\s*(कीमत|दाम)|(कीमत|दाम)\s*कम/,
  /છૂટ|છુટ|ડિસ્કાઉન્ટ|ડિસ્કાઉંટ|રાહત|ભાવતાલ|કેશબેક|ઓફર|અંતિમ\s*(કિંમત|ભાવ)|ફાઇનલ\s*(કિંમત|ભાવ|પ્રાઇસ)|ઓછી\s*કિંમત|ઓછા\s*ભાવ|(કિંમત|ભાવ)\s*ઓછ/,
];
// Catches "d-i-s-c-o-u-n-t" and "dis count" once everything but letters is removed.
const SQUEEZED_DISCOUNT = /discount|cashback|rebate/i;

const PERCENT = /\d\s*(%|percent|per\s*cent|प्रतिशत|टका|ટકા)/i;

// Every word or symbol that means money. Whatever is left after removing approved amounts fails.
const CURRENCY = String.raw`₹|\$|€|£|₨|${LETTER_BEFORE}(?:rs\.?|inr|rupees?|rupaya|रु\.?|रू\.?|રૂ\.?)|रुपय|रुपए|रुपये|रूपय|रूपए|रूपये|રૂપિય|રુપિય`;
const LATIN_UNITS = String.raw`(?:lakhs?|lacs?|crores?|crs?|millions?|billions?|thousands?|hundreds?)${LETTER_AFTER}`;
const INDIC_UNITS = String.raw`लाख|करोड|अरब|हजार|हज़ार|લાખ|કરોડ|અબજ|હજાર`;
const MONEY_WORD = new RegExp(
  String.raw`${CURRENCY}|${LETTER_BEFORE}${LATIN_UNITS}|${INDIC_UNITS}|\d\s*(?:l|k)${LETTER_AFTER}|\d\s*/-`,
  "iu",
);

const AMOUNT = new RegExp(
  String.raw`(?:(?:₹|${LETTER_BEFORE}(?:rs\.?|inr|रु\.?|रू\.?|રૂ\.?))\s*)?(\d+(?:\.\d+)?)[\s-]*(lakhs?|lacs?|crores?|crs?|लाख|करोड|લાખ|કરોડ)|(?:₹|${LETTER_BEFORE}(?:rs\.?|inr|रु\.?|रू\.?|રૂ\.?))\s*(\d+(?:\.\d+)?)`,
  "giu",
);
const LAKH = /^(lakh|lac|लाख|લાખ)/i;
const CRORE = /^(crore|cr|करोड|કરોડ)/i;

// A number run up against an amount ("2 to 65 lakh") would turn a single price into a false range.
const RANGE_INTO_AMOUNT = new RegExp(
  String.raw`\d\s*(?:to|-|–|—|से|થી)\s*\d+(?:\.\d+)?[\s-]*(?:lakh|lac|crore|cr|लाख|करोड|લાખ|કરોડ)`,
  "iu",
);

// ponytail: tens and the most likely quantities only, since Hindi and Gujarati numbers are irregular.
const SPELLED_NUMBER = new RegExp(
  String.raw`${LETTER_BEFORE}(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)${LETTER_AFTER}` +
    String.raw`|${LETTER_BEFORE}(?:दस|बीस|तीस|चालीस|पचास|साठ|सत्तर|अस्सी|नब्बे|सौ|चौबीस|पच्चीस|દસ|વીસ|ત્રીસ|ચાલીસ|પચાસ|સાઠ|સિત્તેર|એંસી|નેવું|સો|ચોવીસ|પચ્ચીસ)${LETTER_AFTER}`,
  "iu",
);

const ZERO_WIDTH = /[­​-‏⁠﻿]/g;

/** One form for matching: Hindi and Gujarati digits become 0-9, and Indian commas are removed. */
export function normalise(text: string) {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[૦-૯]/g, (d) => String(d.charCodeAt(0) - 0x0ae6))
    .replace(/(?<=\d),(?=\d)/g, "");
}

function toRupees(match: RegExpMatchArray) {
  const value = Number(match[1] ?? match[3]);
  const unit = match[2] ?? "";
  const multiplier = LAKH.test(unit) ? 100_000 : CRORE.test(unit) ? 10_000_000 : 1;
  return Math.round(value * multiplier);
}

function numbersIn(text: string) {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

/**
 * Amounts of money must equal one on the fact sheet, compared in rupees. Other numbers may come
 * from the fact sheet or from `toolOutput`. The buyer's words are never a source: "can you do
 * 60 lakh?" must not make 60 sayable. Returns the first rule the reply breaks, or null.
 */
export function checkReply(reply: string, facts: string, toolOutput = ""): CheckFailure | null {
  const text = normalise(reply);
  const factText = normalise(facts);

  if (mentionsDiscount(text)) return "discount";
  if (PERCENT.test(text) || RANGE_INTO_AMOUNT.test(text)) return "unsupported_price";

  const approved = new Set([...factText.matchAll(AMOUNT)].map(toRupees));
  let rest = text;
  for (const match of text.matchAll(AMOUNT)) {
    if (!approved.has(toRupees(match))) return "unsupported_price";
    rest = rest.replace(match[0], " ");
  }
  if (MONEY_WORD.test(rest)) return "unsupported_price";

  // Digits from any other script are still numbers we cannot check.
  if (/[^\P{Nd}0-9]/u.test(rest) || SPELLED_NUMBER.test(rest)) return "unsupported_number";

  const known = numbersIn(`${factText}\n${normalise(toolOutput)}`);
  return [...numbersIn(rest)].some((n) => !known.has(n)) ? "unsupported_number" : null;
}
