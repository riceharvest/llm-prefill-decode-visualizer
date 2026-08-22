// Catch-all router for Vercel Hobby plan (12-function limit).
// All /api/* requests route through this single serverless function,
// which dispatches to the individual endpoint handlers.

const handlers = {};

function register(method, pattern, handler) {
  if (!handlers[method]) handlers[method] = [];
  // Convert :param syntax to regex
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '/?$');
  handlers[method].push({ regex, keys, handler });
}

function match(method, pathname) {
  const list = handlers[method] || [];
  for (const route of list) {
    const m = pathname.match(route.regex);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
  }
  return null;
}

export { register, match };
