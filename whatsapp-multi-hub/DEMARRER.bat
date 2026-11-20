@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Multi-Lignes

where node >nul 2>nul
if errorlevel 1 goto pas_de_node

if exist node_modules\baileys goto lancer
echo.
echo  Premiere installation, patiente 1 a 3 minutes...
call npm install --no-audit --no-fund
if errorlevel 1 goto echec

:lancer
if not exist .env copy .env.example .env >nul
echo.
echo  Demarrage... ton navigateur va s ouvrir tout seul.
echo  NE FERME PAS cette fenetre tant que tu veux suivre tes lignes.
echo.
set OPEN_BROWSER=1
node server.js
pause
exit /b

:pas_de_node
echo.
echo  Node.js n est pas installe sur cet ordinateur.
echo  La page de telechargement va s ouvrir : installe la version LTS,
echo  puis double-clique de nouveau sur DEMARRER.
start https://nodejs.org/fr/download
pause
exit /b

:echec
echo.
echo  L installation a echoue. Fais une capture de cette fenetre.
pause
exit /b
