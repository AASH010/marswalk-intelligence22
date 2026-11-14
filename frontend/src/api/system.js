import { requestJson } from "./client";

/**
 * Backend health — GET /health returns { status: "healthy" }
 * (backend/app/main.py). Anything else counts as not reachable.
 */
export async function getHealth({ signal } = {}) {
  const data = await requestJson("/health", { signal, timeoutMs: 8000 });
  return data?.status === "healthy";
}

/** Resolves true when an image URL loads, false when it fails. */
export function probeImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}
