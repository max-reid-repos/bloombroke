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
// and nothing else, and no other site may frame it.
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://datafa.st https://static.cloudflareinsights.com",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self' https://datafa.st https://cloudflareinsights.com",
      "frame-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ].join('; '),
  };
}
