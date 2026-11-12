@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist frontend\dist (
  echo [1/2] 构建前端...
  cd frontend && call npm install && call npm run build && cd ..
)
echo [2/2] 启动服务 http://127.0.0.1:8000
start "" http://127.0.0.1:8000
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
