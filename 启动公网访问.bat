@echo off
chcp 65001 >nul
title 彩票预测助手 - 公网访问
cd /d "%~dp0"
echo [1/2] 启动本地服务（保持弹出的服务窗口开着）...
start "彩票服务" cmd /k "python -X utf8 server.py"
timeout /t 2 /nobreak >nul
echo [2/2] 启动公网隧道，请稍候 10~20 秒...
echo.
echo ==================================================
echo  出现形如 https://xxxx.trycloudflare.com 的地址后，
echo  手机浏览器（Wi-Fi / 流量均可）直接打开它，
echo  再「添加到主屏幕」即可离线使用。
echo  地址每次启动会变化，以窗口显示为准。
echo  关闭本窗口即停止公网访问；请勿把链接发给别人。
echo ==================================================
echo.
if exist "..\竞彩赔率分析\cloudflared.exe" (
  "..\竞彩赔率分析\cloudflared.exe" tunnel --url http://127.0.0.1:8788
) else if exist ".\cloudflared.exe" (
  cloudflared.exe tunnel --url http://127.0.0.1:8788
) else (
  echo 未找到 cloudflared.exe（应位于 竞彩赔率分析 文件夹）。
)
pause
