#!/bin/zsh
# 小丑之桌 · 本地启动器
# 双击即可在浏览器里打开游戏（关闭终端窗口即停止服务）
cd "$(dirname "$0")" || exit 1
PORT=8899

while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

echo ""
echo "  ♠ ♥  小丑之桌 · JESTER'S TABLE  ♦ ♣"
echo "  服务地址 http://localhost:$PORT"
echo "  关闭此终端窗口即可停止"
echo ""

(sleep 1.2; open "http://localhost:$PORT/index.html") &

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1
else
  echo "未找到 python3，请用任意静态服务器打开本目录。"
  read -r "?按回车退出"
fi
