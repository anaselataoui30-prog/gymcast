// NO PASSWORD MODE (temporary, for building).
// Every admin request is allowed through.
// Real security will be added later with Cloudflare Access (no code needed).
export async function onRequest(context) {
  return context.next();
}
