// SECURITY REMOVED ON PURPOSE WHILE BUILDING.
// Every admin API request goes straight through.
export async function onRequest(context) {
  return context.next();
}
