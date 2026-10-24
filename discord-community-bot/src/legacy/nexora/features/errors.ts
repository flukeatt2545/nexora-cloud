import axios from "axios";

// Log-safe parts of a failure. Never log the error object from axios itself: its request carries the bot secret.

/** The error's message, or the thrown value itself when it is not an Error. */
export function describeError(error: unknown): unknown {
  return (error instanceof Error && error.message) || error;
}

/** HTTP status of a failed API call. */
export function errorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Node or axios error code, such as ECONNREFUSED. */
export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && error.code ? String(error.code) : undefined;
}

/** A field of the JSON body the API answered an error with, such as `error` or `code`. */
export function apiErrorField(error: unknown, field: "error" | "code"): string {
  if (!axios.isAxiosError(error)) return "";
  const data: unknown = error.response?.data;
  if (!data || typeof data !== "object" || !(field in data)) return "";
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
