import crypto from "crypto";

export const CSRF_COOKIE_NAME = "csrf_token";

export const createCsrfToken = () => crypto.randomBytes(32).toString("hex");

export const validateCsrf = (cookieValue?: string, headerValue?: string) => {
  if (!cookieValue || !headerValue) return false;
  return cookieValue === headerValue;
};
