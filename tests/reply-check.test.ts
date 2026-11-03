import { describe, expect, it } from "vitest";
import { checkReply, normalise } from "../lib/reply-check";

const FACTS = "Project 2 has 2 BHK homes from ₹65 lakh. Prices range up to ₹1.2 crore. 420 homes.";

describe("replies that should reach the buyer", () => {
  it.each([
    "Project 2 has 2 BHK homes.",
    "Homes start from ₹65 lakh, and a person will confirm the exact price.",
    "Homes range from ₹65 lakh to ₹1.2 crore.",
    "Prices go up to ₹1.2 crore.",
    "Prices go up to ₹1.20 crore.",
    "Homes go up to ₹1,20,00,000.",
    "Homes start at ₹65,00,000.",
    "65 lakh is where homes start.",
    "प्रोजेक्ट 2 में 2 BHK घर ₹65 लाख से शुरू होते हैं।",
    "घर ₹65 लाख से ₹1.2 करोड़ तक हैं।",
    "પ્રોજેક્ટ ૨ માં ૨ BHK ઘર ૬૫ લાખથી શરૂ થાય છે.",
    "ઘર ₹૬૫ લાખથી ₹૧.૨ કરોડ સુધી છે.",
    "A person from our sales team will confirm that shortly.",
    "We have 420 homes, and one parking space comes with each.",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBeNull();
  });

  it("lets the assistant repeat times from tool results", () => {
    expect(checkReply("Saturday 8 Nov at 11:00 am is free.", FACTS, "8 Nov, 11:00 am")).toBeNull();
  });
});

describe("the unit is part of the amount", () => {
  it.each([
    "Homes for just ₹1.2 lakh.",
    "Homes from ₹65 crore.",
    "यह घर ₹1.2 लाख में मिलेगा।",
    "આ ઘર ૧.૨ લાખમાં મળશે.",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("unsupported_price");
  });
});

describe("money in any spelling", () => {
  it.each([
    "For you it would be ₹62 lakh.",
    "आपके लिए ₹60 लाख में हो जाएगा।",
    "તમારા માટે ૬૦ લાખ થશે.",
    "It is about sixty lakh.",
    "करीब साठ लाख में मिल जाएगा।",
    "Only ₹2 lakh down.",
    "Only 2lakh.",
    "Only 2crore.",
    "Only 2cr.",
    "Only 420lakh.",
    "Only INR2.",
    "Only ₹420.",
    "Rs60",
    "हाँ, 2 रूपये चलेगा।",
    "हाँ, 2 करोड़ चलेगा।",
    "हाँ, रु 2 चलेगा।",
    "हाँ, रु. 2 चलेगा।",
    "हाँ, रू. 2 चलेगा।",
    "हाँ, 2 रुपया चलेगा।",
    "હા, રૂ 2 ચાલશે.",
    "હા, 2 રુપિયા ચાલશે.",
    "હા, 2 રૂપિયે ચાલશે.",
    "Only 2 million.",
    "Booking amount only 2 thousand.",
    "सिर्फ 2 हजार में बुकिंग।",
    "Only $2.",
    "Yes, 2L works.",
    "Yes, 2k works.",
    "Yes, 2/- works",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("unsupported_price");
  });
});

describe("one real price does not excuse another", () => {
  it.each([
    "List starts at ₹65 lakh, but for you sixty lakh.",
    "₹65 लाख नहीं, आपके लिए साठ लाख।",
    "₹65 લાખ નહીં, તમારા માટે સાઠ લાખ.",
    "2 to 65 lakh.",
    "2-65 lakh is fine.",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("unsupported_price");
  });
});

describe("the buyer's own figure", () => {
  it.each(["Yes, 60 lakh works.", "Yes, 60lakh works.", "Yes, Rs૬૦ works.", "₹65 lakh, for you 60.", "60-65 lakh is fine."])(
    "is never approved: %s",
    (reply) => {
      expect(checkReply(reply, FACTS)).not.toBeNull();
    },
  );
});

describe("discounts", () => {
  it.each([
    "We can give you a discount this week.",
    "I can offer you the best price today.",
    "आपको छूट मिल सकती है।",
    "તમને ડિસ્કાઉન્ટ મળશે.",
    "We are discounting this week.",
    "The stamp duty fee is waived.",
    "best prices today",
    "I can offer you the best  price.",
    "the best\nprice",
    "Your final-price is ready.",
    "We can give you a rebate.",
    "We can give you a concession.",
    "There is a special price this week.",
    "We can reduce the price for you.",
    "We can do a lower price.",
    "lowest price today",
    "Your final cost is ₹65 lakh.",
    "Your all-inclusive price is ₹65 lakh.",
    "आपको डिसकाउंट मिलेगा।",
    "आपको छुट मिलेगी।",
    "आपके लिए कीमत कम कर देंगे।",
    "आपको कम कीमत में मिलेगा।",
    "आपको खास ऑफर मिलेगा।",
    "तुम्हें फाइनल कीमत बता दूँ",
    "તમને ડિસ્કાઉંટ મળશે.",
    "તમને છુટ મળશે.",
    "તમને ઓછી કિંમતે મળશે.",
    "તમને ખાસ ઓફર મળશે.",
    "dis​count for you",
    "d-i-s-c-o-u-n-t for you",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("discount");
  });

  it.each(["We can take 2% off.", "2 percent off for you.", "2% कम हो जाएगा।", "૨% ઓછું થશે."])(
    "blocks a percentage even if the number is on the fact sheet: %s",
    (reply) => {
      expect(checkReply(reply, FACTS)).toBe("unsupported_price");
    },
  );
});

describe("other numbers", () => {
  it.each([
    "The tower has 24 floors.",
    "We have 5 BHK homes.",
    "24. That is how many floors we have.",
    "62. That is what we can do for you.",
    "The answer:\n62) is what we can do.",
    "The tower has twenty four floors.",
    "इस टावर में चौबीस मंजिल हैं।",
    "આ ટાવરમાં ચોવીસ માળ છે.",
    "It is sixty.",
    "The tower has ２４ floors.",
    "The tower has 𝟮𝟰 floors.",
    "The tower has ২৪ floors.",
  ])("%s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("unsupported_number");
  });
});

describe("normalise", () => {
  it("handles other scripts' digits, Indian commas and hidden characters", () => {
    expect(normalise("૬૫ और ६५")).toBe("65 और 65");
    expect(normalise("₹1,20,00,000")).toBe("₹12000000");
    expect(normalise("a​b")).toBe("ab");
  });
});
