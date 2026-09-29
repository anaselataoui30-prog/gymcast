export async function createSessionCookie(env, secure = true) {
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const signature = await sign(env, expires);

  return [
    `${COOKIE_NAME}=${expires}.${signature}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Strict", // <--- CHANGE THIS LINE
    "Max-Age=604800",
  ]
    .filter(Boolean)
    .join("; ");
}
