import { cookies } from "next/headers";
import { LANGUAGES, type Language } from "./i18n";

export async function getLanguage(): Promise<Language> {
  const value = (await cookies()).get("lang")?.value;
  return LANGUAGES.find((language) => language === value) ?? "en";
}
