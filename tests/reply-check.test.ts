import { describe, expect, it } from "vitest";
import { checkReply, normaliseDigits } from "../lib/reply-check";

const FACTS = "Project 2 has 2 BHK homes from ₹65 lakh. Prices range up to ₹1.2 crore. 420 homes.";

describe("reply check", () => {
  it.each([
    "Project 2 has 2 BHK homes.",
    "Homes start from ₹65 lakh, and a person will confirm the exact price.",
    "Prices go up to ₹1.2 crore.",
    "प्रोजेक्ट 2 में 2 BHK घर ₹65 लाख से शुरू होते हैं।",
    "પ્રોજેક્ટ ૨ માં ૨ BHK ઘર ૬૫ લાખથી શરૂ થાય છે.",
    "1. Parking\n2. Security",
  ])("allows a grounded reply: %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBeNull();
  });

  it.each([
    "We can give you a discount this week.",
    "I can offer you the best price today.",
    "आपको छूट मिल सकती है।",
    "તમને ડિસ્કાઉન્ટ મળશે.",
  ])("blocks any talk of discounts: %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("discount");
  });

  it.each([
    "For you it would be ₹62 lakh.",
    "आपके लिए ₹60 लाख में हो जाएगा।",
    "તમારા માટે ૬૦ લાખ થશે.",
    "It is about sixty lakh.",
    "करीब साठ लाख में मिल जाएगा।",
    "Only ₹2 lakh down.", // 2 is on the fact sheet, but as "2 BHK", not as money
  ])("blocks a price that is not on the fact sheet: %s", (reply) => {
    expect(checkReply(reply, FACTS)).toBe("unsupported_price");
  });

  it("does not let a buyer's own figure become an agreed price", () => {
    expect(checkReply("Yes, ₹60 lakh works.", FACTS, "Can you do 60 lakh?")).toBe("unsupported_price");
  });

  it("blocks other invented numbers", () => {
    expect(checkReply("The tower has 24 floors.", FACTS)).toBe("unsupported_number");
    expect(checkReply("We have 5 BHK homes.", FACTS)).toBe("unsupported_number");
  });

  it("lets the assistant repeat times from tool results", () => {
    expect(checkReply("Saturday 8 Nov at 11:00 am is free.", FACTS, "8 Nov, 11:00 am")).toBeNull();
  });

  it("converts Hindi and Gujarati digits", () => {
    expect(normaliseDigits("૬૫ और ६५")).toBe("65 और 65");
  });
});
