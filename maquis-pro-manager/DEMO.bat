@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MAQUIS PRO MANAGER - DEMONSTRATION
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js n'est pas installe : installez la version LTS puis recommencez.
  start https://nodejs.org/fr/download
  pause
  exit /b
)
if not exist node_modules call npm install --no-audit --no-fund
set "DATA_DIR=%~dp0demo-donnees"
set "PORT=3200"
echo.
echo  DEMONSTRATION (donnees fictives) - mot de passe pour tous les comptes : demo1234
echo  Comptes : patron (proprietaire), gerant (tient la caisse), caissier, awa / ali / fatim (serveurs)
echo  Vos vraies donnees ne sont pas touchees. Fermez cette fenetre pour arreter.
echo.
where cloudflared >nul 2>nul
if not errorlevel 1 start "Lien de la demo pour les telephones" cmd /k cloudflared tunnel --url http://localhost:3200 --no-autoupdate
start "" http://localhost:3200
node --disable-warning=ExperimentalWarning scripts/demo.js
pause
