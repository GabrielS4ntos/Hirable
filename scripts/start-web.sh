#!/bin/bash
ulimit -n 10240 2>/dev/null || true
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "/Users/gabriel/Projects/hirable"
exec node src/web/server.js
