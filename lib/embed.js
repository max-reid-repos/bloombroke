// DESK panels frame the app itself in embed mode (/?c=AAPL+1D&embed=1). The page gets
// the is-embed class before any script runs (no header, tape or key bar flash), and no
// analytics script: a desk of five panels is one visit, not six.

export function isEmbedQuery(query) {
  return query?.embed === '1';
}

export function embedHtml(html) {
  return String(html)
    .replace(/<html lang="en">/, '<html lang="en" class="is-embed">')
    .replace(/\s*<script\b[^>]*\bsrc="https:\/\/datafa\.st\/[^"]*"[^>]*><\/script>/g, '');
}

// The headers on every response. Framing: this site may frame itself (DESK panels)
// and nothing else, and no other site may frame it (/embed/* sets its own, see
// lib/embed-pages.js). No camera, microphone, location or payment API: Stripe checkout
// is a redirect to its own page, not a form or an API here. Google Analytics 4 (goal.js,
// ga4.js): its script from www.googletagmanager.com, its hits to Google's analytics hosts
// (Google's GA4 CSP list, without the Google Signals hosts: Signals is off). HSTS for 180 days, this host
// only (no includeSubDomains, no preload); Cloudflare does not add one.
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=15552000',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://datafa.st https://analytics.ahrefs.com https://static.cloudflareinsights.com https://www.googletagmanager.com",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com",
      "connect-src 'self' https://datafa.st https://analytics.ahrefs.com https://cloudflareinsights.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
      "frame-src 'self' https://www.youtube-nocookie.com", // GRAVEYARD: the player, only after a click
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  };
}
