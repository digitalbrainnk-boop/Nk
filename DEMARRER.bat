@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mon agent IA

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe sur cet ordinateur.
  echo  La page de telechargement va s'ouvrir : installe la version LTS,
  echo  puis double-clique de nouveau sur DEMARRER.
  start https://nodejs.org/fr/download
  pause
  exit /b
)

if not exist node_modules (
  echo.
  echo  Premiere installation, patiente 1 a 2 minutes...
  call npm install
  if errorlevel 1 (
    echo  L'installation a echoue. Fais une capture de cette fenetre.
    pause
    exit /b
  )
)

if not exist .env copy .env.example .env >nul

findstr /r /c:"^ANTHROPIC_API_KEY=..*" .env >nul
if not errorlevel 1 goto lancer

:demander_cle
echo.
echo  Il faut ta cle Claude (elle commence par sk-ant-).
echo  Cree-la sur https://console.anthropic.com  rubrique "API Keys".
echo  Copie-la, puis fais un CLIC DROIT dans cette fenetre pour la coller, et appuie sur Entree.
echo.
set "KEY="
set /p "KEY=Ta cle : "
if "%KEY%"=="" goto demander_cle
powershell -NoProfile -Command "(Get-Content .env) -replace '^ANTHROPIC_API_KEY=.*','ANTHROPIC_API_KEY=%KEY%' | Set-Content -Encoding ASCII .env"

:lancer
echo.
echo  Demarrage... ton navigateur va s'ouvrir sur http://localhost:3000
echo  Le MOT DE PASSE s'affiche juste en dessous.
echo  NE FERME PAS cette fenetre tant que tu veux que l'agent reponde.
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3000"
call npm start
pause
