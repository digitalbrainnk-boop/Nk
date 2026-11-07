@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MAQUIS PRO MANAGER - TEST

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe sur cet ordinateur.
  echo  La page de telechargement va s'ouvrir : installez la version LTS,
  echo  puis double-cliquez de nouveau sur DEMARRER-TEST.
  start https://nodejs.org/fr/download
  pause
  exit /b
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo  Votre Node.js est trop ancien : installez la derniere version LTS depuis nodejs.org.
  start https://nodejs.org/fr/download
  pause
  exit /b
)

if not exist node_modules (
  echo.
  echo  Premiere installation, patientez 1 a 2 minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  L'installation a echoue. Faites une capture de cette fenetre.
    pause
    exit /b
  )
)
if not exist .env (
  echo DATA_DIR=%~dp0donnees> .env
  echo PORT=3100>> .env
)

where cloudflared >nul 2>nul
if not errorlevel 1 (
  start "Lien pour les autres telephones" cmd /k cloudflared tunnel --url http://localhost:3100 --no-autoupdate
  echo  Le lien pour les telephones s'affiche dans l'autre fenetre (adresse en .trycloudflare.com^).
) else (
  echo  Pour tester depuis des telephones : installez cloudflared (commande : winget install Cloudflare.cloudflared^)
)
echo.
echo  Le code d'installation est dans le dossier "donnees", fichier CODE-INSTALLATION.txt
echo  Laissez cette fenetre ouverte. Fermez-la pour arreter l'application.
start "" http://localhost:3100
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env serveur.js
pause
