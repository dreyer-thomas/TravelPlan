import { cookies } from "next/headers";
import { dictionaries, LANGUAGE_COOKIE_NAME, resolveLanguage, translate } from "@/i18n";

export const getServerLanguage = async () => {
  const cookieStore = await cookies();
  const value = cookieStore.get(LANGUAGE_COOKIE_NAME)?.value;
  return resolveLanguage(value);
};

export const getServerT = async () => {
  const language = await getServerLanguage();
  const dictionary = dictionaries[language];
  return (key: string) => translate(dictionary, key);
};
