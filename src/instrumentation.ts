export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validates secrets/URLs and throws on a bad production configuration
    // before the server accepts traffic.
    await import("./server/env");
  }
}