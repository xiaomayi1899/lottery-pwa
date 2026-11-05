@echo off
chcp 65001 >nul
title 彩票预测助手 - 本地服务
cd /d "%~dp0"
python -X utf8 server.py
pause
