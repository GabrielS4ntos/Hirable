#!/bin/bash
ulimit -n 10240 2>/dev/null || true
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "/Users/gabriel/Documents/Codex/2026-08-04/linkedin-plugin-app-69949aa62bf48191be5e57a01202beca-openai-curated/work/linkedin-local-agent"
exec node src/web/server.js
