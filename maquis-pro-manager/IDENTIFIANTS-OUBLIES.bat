@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MAQUIS PRO MANAGER - identifiants oublies
echo.
echo  Comptes existants :
echo.
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env scripts/acces.js
echo.
set "QUI="
set /p "QUI=Identifiant a qui donner un nouveau mot de passe (Entree pour quitter) : "
if "%QUI%"=="" exit /b
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env scripts/acces.js %QUI%
echo.
pause
