import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/errors/apiError";

export type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

export const ok = <T>(data: T, init?: ResponseInit) =>
  NextResponse.json<ApiEnvelope<T>>({ data, error: null }, init);

export const fail = (error: ApiError, status = 400, init?: ResponseInit) =>
  NextResponse.json<ApiEnvelope<null>>({ data: null, error }, { ...init, status });
