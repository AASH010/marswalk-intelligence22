/**
 * Shared HTTP access for the existing backend (FastAPI).
 *
 * Network errors, HTTP errors, application errors and malformed payloads are
 * classified separately (handoff §15.1) so the interface can map each to the
 * right user-facing state. Nothing here fabricates a fallback success.
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * kind:
 *   aborted      request cancelled by the application
 *   timeout      no response within the allowed time
 *   network      connection could not be made
 *   validation   400 / 422 — the backend rejected the input
 *   not_found    404
 *   auth         401 / 403
 *   rate_limit   429
 *   unavailable  502 / 503 / 504
 *   server       other 5xx
 *   contract     response did not match the documented schema
 */
export class ApiError extends Error {
  constructor(kind, message, { status = null, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

function kindForStatus(status) {
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  if (status >= 500) return "server";
  return "server";
}

/** FastAPI errors are { detail: string } or { detail: [{ loc, msg, ... }] }. */
async function readErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    const body = JSON.parse(text);
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      return body.detail
        .map((item) => {
          const where = Array.isArray(item?.loc) ? item.loc.filter((part) => part !== "body").join(".") : "";
          return [where, item?.msg].filter(Boolean).join(": ");
        })
        .filter(Boolean)
        .join("; ");
    }
    return null;
  } catch {
    return null;
  }
}

export async function requestJson(path, { method = "GET", body, signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ApiError("timeout", "The request timed out.", { cause });
      if (controller.signal.aborted) throw new ApiError("aborted", "The request was cancelled.", { cause });
      throw new ApiError("network", "The service could not be reached.", { cause });
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new ApiError(kindForStatus(response.status), detail || `Request failed (${response.status}).`, {
        status: response.status,
        detail,
      });
    }

    try {
      return await response.json();
    } catch (cause) {
      if (timedOut) throw new ApiError("timeout", "The request timed out.", { cause });
      if (controller.signal.aborted) throw new ApiError("aborted", "The request was cancelled.", { cause });
      throw new ApiError("contract", "The service returned a response that is not valid JSON.", {
        status: response.status,
        cause,
      });
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

/** True when the failure means the service itself is not usable right now. */
export function isServiceFailure(error) {
  return ["network", "timeout", "unavailable", "server", "auth", "rate_limit"].includes(error?.kind);
}
