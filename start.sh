#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d frontend/dist ] || (cd frontend && npm install && npm run build)
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
