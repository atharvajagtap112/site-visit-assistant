/**
 * The last check on every assistant reply, run in code so a persuaded or confused model still
 * cannot reach the buyer with a discount, a number nobody gave it, or our internals. It fails safe:
 * anything it cannot prove came from the fact sheet is withheld, and a person takes over.
 *
 * Known limits: it cannot catch a false claim with no number in it ("there is a swimming pool"),
 * a bare fact-sheet number used as a price ("for you, 2"), every way of spelling a number, an offer
 * hinted at in other words ("something extra for you"), or an unlabelled slot ID that is also a
 * number on the fact sheet or in a listed time. Those rely on the prompt, the eval set and the sales head's review of flagged chats.
 */

/** True if the buyer is asking about a discount or offer, or the assistant is talking about one. */
export const mentionsDiscount = (text: string) => {
  const plain = normalise(text);
  return (
    DISCOUNT_PATTERNS.some((pattern) => pattern.test(plain)) ||
    SQUEEZED_DISCOUNT.test(plain.replace(/[^\p{L}]/gu, ""))
  );
};

// Promising a person, in any language. If the reply does this, a real handoff has to happen.
// Roles that also describe facts ("security staff", "specialist hospital") need a word that makes them a person of ours.
const PROMISES_PERSON = new RegExp(
  [
    String.raw`sales\s*(?:team|executive|specialist|rep|representative|manager|agent|staff|consultant|advis[eo]r)|salesperson|our team|team member|a person|a human|someone (?:from|will|can)`,
    String.raw`\b(?:specialist|representative|advis[eo]r|colleague)s?\b(?!\s+(?:hospital|clinic|doctor|care|cent(?:re|er)))`,
    String.raw`\b(?:our|an?)\s+(?:consultant|agent|expert|manager|executive|staff)\b`,
    String.raw`(?:will|'ll)\s+(?:contact|call|reach out|get in touch|get back)`,
    String.raw`सेल्स\s*(?:टीम|एग्ज़?ीक्यूटिव|एक्ज़?ीक्यूटिव|मैनेजर)|बिक्री\s*टीम|हमारी टीम|कोई व्यक्ति|एक व्यक्ति|सहकर्मी|सहयोगी|प्रतिनिधि|विशेषज्ञ(?!\s*(?:अस्पताल|डॉक्टर))|एक्सपर्ट|स्पेशलिस्ट|सलाहकार|कंसल्टेंट|एजेंट|हमारे कर्मचारी|(?:संपर्क|कॉल)\s*कर(?:ेगा|ेगी|ेंगे)`,
    String.raw`સેલ્સ\s*(?:ટીમ|એક્ઝિક્યુટિવ|મેનેજર)|વેચાણ\s*ટીમ|અમારી ટીમ|કોઈ વ્યક્તિ|એક વ્યક્તિ|સહકર્મી|સહયોગી|પ્રતિનિધિ|નિષ્ણા[તં]|વિશેષજ્ઞ|એક્સપર્ટ|સ્પેશિયાલિસ્ટ|સ્પેશ્યાલિસ્ટ|સલાહકાર|કન્સલ્ટન્ટ|એજન્ટ|અમારા કર્મચારી|(?:સંપર્ક|ક[ૉો]લ)\s*કરશે`,
  ].join("|"),
  "i",
);

export const promisesPerson = (reply: string) => PROMISES_PERSON.test(normalise(reply));

const letters = (script: string) => new RegExp(String.raw`(?=\p{L})\p{Script=${script}}`, "gu");
const DEVANAGARI_LETTER = letters("Devanagari");
const GUJARATI_LETTER = letters("Gujarati");

// Letters and marks only, so digits and Latin text next to a stray word stay. Zero-width joiners sit inside conjuncts.
const strayGaps = (script: string) => {
  const word = String.raw`(?:(?=[\p{L}\p{M}])\p{Script=${script}}[‌‍]*)+`;
  const between = String.raw`[\s.,!?…।॥:;–—-]*`;
  return new RegExp(`${between}${word}(?:${between}${word})*${between}`, "gu");
};
const DEVANAGARI_GAPS = strayGaps("Devanagari");
const GUJARATI_GAPS = strayGaps("Gujarati");

/**
 * The model sometimes ends a Gujarati reply with a Hindi word. Removes the words in whichever of the
 * two scripts has fewer letters, with the spacing and punctuation they leave behind. A tie is left
 * alone since neither is clearly stray. The page language plays no part: a buyer may write Hindi on a Gujarati page.
 * ponytail: it cannot read meaning, so a stray "नहीं" would go too and flip the sentence. The prompt and eval set cover that.
 */
export function dropStrayScript(reply: string) {
  const devanagari = reply.match(DEVANAGARI_LETTER)?.length ?? 0;
  const gujarati = reply.match(GUJARATI_LETTER)?.length ?? 0;
  if (!devanagari || !gujarati || devanagari === gujarati) return reply;

  const keepsGujarati = gujarati > devanagari;
  return reply
    .replace(keepsGujarati ? DEVANAGARI_GAPS : GUJARATI_GAPS, (gap, offset: number) => {
      if (offset === 0) return "";
      const found = gap.match(/[.!?…।]/)?.[0];
      const mark = found === "।" && keepsGujarati ? "." : (found ?? "");
      if (offset + gap.length === reply.length) return mark;
      const separator = mark || (gap.match(/[,:;]/)?.[0] ?? "");
      return separator + (gap.includes("\n") ? "\n" : /\s/.test(gap) ? " " : "");
    })
    .replace(/\s*(?:\(\s*\)|""|“\s*”)/g, "")
    .trim();
}

export type CheckFailure = "discount" | "internals" | "unsupported_number" | "unsupported_price";

// Nothing a buyer should read has braces or quoted keys, so these catch cut-off JSON too.
const INTERNALS = [
  /[{}]|"\w+"\s*:/,
  /project[\s_-]*slug|handoff_to_human|get_free_slots|book_visit|save_buyer_needs|free_slots|handed_off|details_needed|slot_unavailable/i,
  /(?:slot|स्लॉट|સ્લોટ)[\s_-]*(?:id|आई\s*डी|આઈ\s*ડી)/i,
  // "Slot 12" or "ID: 12", but not a time or date such as "slot 11:00" or "slot 8 Nov".
  /(?:slot|स्लॉट|સ્લોટ)\s*(?:#|no\.?|number|नंबर|નંબર)?\s*[:=-]?\s*\d+(?![\d:.]*\d|\s*(?:am|pm|a\.m|p\.m|बजे|વાગ|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/iu,
  /(?<![\p{L}\p{M}])(?:id|आई\s*डी|આઈ\s*ડી)\s*[:#=]?\s*\d/iu,
];

const LETTER_BEFORE = String.raw`(?<![\p{L}\p{M}])`;
const LETTER_AFTER = String.raw`(?![\p{L}\p{M}])`;

const DISCOUNT_PATTERNS = [
  /discount|waiv|rebate|concession|cashback|negotiat|bargain/i,
  /(offer|best|lowest|lower|reduced?|special|final|all[\s-]*inclusive)[\s-]+(\w+[\s-]+)?(price|prices|pricing|cost|rate|deal|offer|amount)/i,
  /(reduce|lower|cut)\s+(\w+\s+)?(price|cost)/i,
  // "offer" as a noun only: "Project 1 offers a gym" and "we offer 3 BHK homes" are ordinary replies.
  /\b(any|an|the|this|our|such|have|has|got|get|discuss|regarding|about|current|latest|ongoing|available|exclusive|festive|seasonal|limited|attractive|great|good|better)[\s-]+offers?\b/i,
  /\b(these|those|some|other|more)\s+offers\b/i,
  /\b(pric(e|es|ing)|costs?|payments?|deals?|schemes?)\s*(,|&|\/|and|or)\s*(\w+\s+)?offers?\b/i,
  /\boffers?\s+(available|running|valid|are|is|for\s+you)\b/i,
  /\b(any|some|current|latest|exclusive|festive|good|great|better|attractive)[\s-]+deals?\b(?!\s+(of|with))|\bdeals\b(?!\s+with)/i,
  /\bpromotions?\b|\bpromos?\b|\bschemes?\b|\bfreebies?\b|\bsubvention\b/i,
  /छूट|छुट|डिस्काउंट|डिसकाउंट|रियायत|मोलभाव|कैशबैक|ऑफ\u093C?र|डील|स्कीम|अंतिम\s*(कीमत|दाम|मूल्य)|फाइनल\s*(कीमत|प्राइस|दाम)|कम\s*(कीमत|दाम)|(कीमत|दाम)\s*कम/,
  /છૂટ|છુટ|ડિસ્કાઉન્ટ|ડિસ્કાઉંટ|રાહત|ભાવતાલ|કેશબેક|[ઓઑ]ફર|ડીલ|સ્કીમ|અંતિમ\s*(કિંમત|ભાવ)|ફાઇનલ\s*(કિંમત|ભાવ|પ્રાઇસ)|ઓછી\s*કિંમત|ઓછા\s*ભાવ|(કિંમત|ભાવ)\s*ઓછ/,
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
  const tool = normalise(toolOutput);

  if (INTERNALS.some((pattern) => pattern.test(text))) return "internals";
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

  // A slot ID in the tool output never makes a number sayable: the buyer sees times, not IDs.
  const slotId = /"slot_id":\s*\d+/g;
  const known = numbersIn(`${factText}\n${tool.replace(slotId, "")}`);
  const unknown = [...numbersIn(rest)].filter((n) => !known.has(n));
  if (!unknown.length) return null;
  const slotIds = numbersIn((tool.match(slotId) ?? []).join(" "));
  return unknown.some((n) => slotIds.has(n)) ? "internals" : "unsupported_number";
}
