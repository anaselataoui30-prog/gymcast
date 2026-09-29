export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    status: 'online',
    message: 'Gymcast Pages Function backend is running!',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}