import { describe, expect, it } from "vitest";
import { checkReply, dropStrayScript, normalise, promisesPerson } from "../lib/reply-check";

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

describe("internals", () => {
  it.each([
    '{"result":"handed_off","salesperson":"Riya Mehta"}',
    '{"reason":"Buyer asked for a discount","summary":"Wants a lower price"}',
    'I have noted that. {"result":"saved"}',
    '"result":"handed_off"',
    "{ result: saved",
    "Please send me the slot_id you prefer.",
    "Please tell me the slot ID you prefer.",
    "Which project_slug do you want?",
    "I will call handoff_to_human now.",
    "get_free_slots shows nothing today.",
    "Calling book_visit.",
    "I ran save_buyer_needs.",
    "Sat, 8 Nov, 11:00 am (ID: 57)",
    "Slot 57 is free.",
    "Slot #57: Saturday morning.",
    "स्लॉट आईडी बताइए।",
    "સ્લોટ આઈડી જણાવો.",
  ])("withholds %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("internals");
  });

  const TOOL = '{"free_slots":[{"slot_id":57,"time":"Sat, 8 Nov, 11:00 am"},{"slot_id":8,"time":"Sat, 8 Nov, 2:00 pm"}]}';

  it("withholds a slot ID even though the tool returned it", () => {
    expect(checkReply("57 is free on Saturday.", FACTS, TOOL)).toBe("internals");
  });

  it.each([
    "Free times appear as buttons below the chat.",
    "Sat, 8 Nov, 11:00 am is free.",
    "The slot at 11:00 am on 8 Nov is free.",
    "The slot 11:00 am is free.",
    "Slot 8 Nov is free.",
    "Please pick a time slot below.",
    "You can book a visit below.",
    "Please provide a valid ID when you visit.",
    'Project 2 is called "the garden homes".',
  ])("lets through %s", (reply) => {
    expect(checkReply(reply, FACTS, TOOL)).toBeNull();
  });
});

describe("implied offers", () => {
  it.each([
    "A sales specialist will discuss pricing and any offers.",
    "A person will confirm pricing and offers.",
    "Offers are available this month.",
    "We have offers for you.",
    "We may have some offers.",
    "There are special offers.",
    "Is there an offer running?",
    "Ask about current deals.",
    "A person will explain the payment scheme.",
    "Special pricing applies this week.",
    "कोई ऑफ़र हो तो टीम बताएगी।",
    "ઑફર વિશે ટીમ જણાવશે.",
  ])("withholds %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("discount");
  });

  it.each([
    "We offer 2 BHK homes.",
    "Project 2 offers 2 BHK homes and a gym.",
    "Project 2 has a gym and offers 2 BHK homes.",
    "Each home offers one parking space.",
    "We are offering 2 BHK homes.",
    "A person from our sales team will confirm pricing.",
    "A person will deal with this.",
  ])("lets through %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBeNull();
  });
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

describe("more wording", () => {
  it.each([
    "We can negotiate.",
    "A waiver of the fee.",
    "We can waive it.",
    "Cashback is available.",
    "This is the offer price.",
    "This is the final price.",
    "रियायत मिलेगी।",
    "मोलभाव हो सकता है।",
    "यह अंतिम कीमत है।",
    "છૂટ મળશે.",
    "રાહત મળશે.",
    "ભાવતાલ થશે.",
  ])("blocks discount wording: %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("discount");
  });

  it.each(["Rs 2 down.", "INR 2 down.", "2 rupees down.", "2 crore.", "2 cr."])(
    "treats %s as money",
    (reply) => {
      expect(checkReply(reply, FACTS)).toBe("unsupported_price");
    },
  );

  it("handles amounts written with Indian commas", () => {
    const facts = "From ₹65,00,000.";
    expect(checkReply("₹65,00,000 onwards.", facts)).toBeNull();
    expect(checkReply("₹65,50,000 onwards.", facts)).toBe("unsupported_price");
    expect(checkReply("We have 1,200 homes.", "1200 homes.")).toBeNull();
  });

  it("normalises digits in tool output", () => {
    expect(checkReply("Free on 8 Nov.", FACTS, "૮ Nov")).toBeNull();
  });
});

describe("dropStrayScript", () => {
  it.each([
    ["એક સહકર્મી જલ્દી જ તમારી વિનંતી વિશે સંપર્ક કરશે. धन्यवाद.", "એક સહકર્મી જલ્દી જ તમારી વિનંતી વિશે સંપર્ક કરશે."],
    ["તમારી વિનંતી મળી ગઈ, धन्यवाद।", "તમારી વિનંતી મળી ગઈ."],
    ["તમારી વિનંતી મળી ગઈ धन्यवाद।", "તમારી વિનંતી મળી ગઈ."],
    ["धन्यवाद! Project 1 માં 2 BHK ઘર મળશે અને પાર્કિંગ પણ છે.", "Project 1 માં 2 BHK ઘર મળશે અને પાર્કિંગ પણ છે."],
    ["Project 1 માં कृपया 2 BHK ઘર છે.", "Project 1 માં 2 BHK ઘર છે."],
    ["Project 1 (धन्यवाद) માં ઘર મળશે અને પાર્કિંગ પણ છે.", "Project 1 માં ઘર મળશે અને પાર્કિંગ પણ છે."],
    ["Project 1 માં ઘર મળશે અને પાર્કિંગ પણ છે - धन्यवाद", "Project 1 માં ઘર મળશે અને પાર્કિંગ પણ છે"],
    ["Project 1 માં ઘર છે.\nआभार\nપાર્કિંગ મળશે.", "Project 1 માં ઘર છે.\nપાર્કિંગ મળશે."],
    ["Project 1 में पार्किंग है। આભાર.", "Project 1 में पार्किंग है।"],
    ["BHKवाला ઘર Project 1 માં છે.", "BHK ઘર Project 1 માં છે."],
    ["૨ BHK ઘર ६५ लाख લાખથી શરૂ થાય છે.", "૨ BHK ઘર ६५ લાખથી શરૂ થાય છે."],
  ])("cleans %s", (reply, cleaned) => {
    expect(dropStrayScript(reply)).toBe(cleaned);
  });

  it.each([
    "Project 1 has 2 BHK homes  ,  from ₹65 lakh!?",
    "प्रोजेक्ट 1 में  2 BHK घर हैं ।",
    "પ્રોજેક્ટ 2 માં  ઘર છે .",
    "आभा આભા",
    "",
  ])("leaves %s untouched", (reply) => {
    expect(dropStrayScript(reply)).toBe(reply);
  });
});

describe("promisesPerson", () => {
  it.each([
    "A sales specialist will confirm this.",
    "A dedicated specialist can help.",
    "Our representative will explain.",
    "A sales rep will explain.",
    "An advisor will help you.",
    "An adviser will help you.",
    "A colleague will get back to you.",
    "Our consultant will help.",
    "We will contact you soon.",
    "We'll call you tomorrow.",
    "Someone will confirm that.",
    "हमारे सहकर्मी आपको बताएंगे।",
    "एक प्रतिनिधि आपको बताएगा।",
    "हमारे विशेषज्ञ आपको बताएंगे।",
    "हमारे सलाहकार आपको बताएंगे।",
    "सेल्स एग्ज़ीक्यूटिव आपको बताएगा।",
    "हम जल्द ही संपर्क करेंगे।",
    "એક સહકર્મી તમને જણાવશે.",
    "અમારા પ્રતિનિધિ તમને જણાવશે.",
    "અમારા નિષ્ણાત તમને જણાવશે.",
    "અમારા સલાહકાર તમને જણાવશે.",
    "ટીમ ટૂંક સમયમાં સંપર્ક કરશે.",
  ])("hears the promise in %s", (reply) => {
    expect(promisesPerson(reply)).toBe(true);
  });

  it.each([
    "Project 1 has 3 BHK homes, a clubhouse and 24-hour security.",
    "One covered parking space comes with each home.",
    "There is a specialist hospital nearby.",
    "The site has security staff all day.",
    "Site visits are free of charge, between 10 am and 5 pm.",
    "प्रोजेक्ट 1 में हर घर के साथ पार्किंग मिलती है।",
    "पास में विशेषज्ञ अस्पताल है।",
    "પ્રોજેક્ટ 2 માં જિમ અને બગીચો છે.",
    "દરેક ઘર સાથે પાર્કિંગ મળે છે.",
    "તમે નીચે મુલાકાતનો સમય પસંદ કરી શકો છો.",
  ])("hears no promise in %s", (reply) => {
    expect(promisesPerson(reply)).toBe(false);
  });
});
