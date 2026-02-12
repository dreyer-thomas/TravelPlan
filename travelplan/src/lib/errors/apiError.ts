export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export const apiError = (code: string, message: string, details?: unknown): ApiError => ({
  code,
  message,
  details,
});
