// The command registry for Node (the server, the MCP tools, tests): public/registry.js
// with HELP's long text (options, source, delay: public/registry-detail.js) merged into
// every entry. The page loads that text only with HELP; code here reads it any time
// (SEO descriptions, provenance, share cards), so it imports the registry from here.

import { mergeDetail } from '../public/registry.js';
import { DETAIL } from '../public/registry-detail.js';

mergeDetail(DETAIL);

export * from '../public/registry.js';
