// Behavior/origin selection precedes this rewrite. Associate on default frontend only.
function handler(event) {
  var request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  var uri = request.uri;
  // Match app.routes.ts explicitly. Do not match Angular's catch-all redirect.
  // Restrict dynamic segments to URL-safe identifiers: no dots, escapes or slashes.
  var fixed = /^\/(?:signup|reservation-confirmed|reservations|waiter-reservations|reports|profile|main|login|menu|tables|waiter-pre-order|guest-pre-order-expired)\/?$/;
  var dynamic = /^\/(?:locations\/[A-Za-z0-9_-]+|join\/[A-Za-z0-9_-]+|reservations\/[A-Za-z0-9_-]+\/group-order)\/?$/;
  if (uri === '/' || fixed.test(uri) || dynamic.test(uri)) request.uri = '/index.html';
  return request;
}
