@echo off
setlocal
REM ====================================================================
REM  NK Trader - lancement sous Windows (double-clic).
REM  Premiere fois : installe tout automatiquement (quelques minutes).
REM  Le telephone peut ensuite ouvrir l'application par le meme Wi-Fi.
REM ====================================================================
chcp 65001 >nul
cd /d "%~dp0"
title NK Trader
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM --- 1. Python est-il installe ? (version 3.11 ou plus recente) ------
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=python"
if not defined PY (
  echo.
  echo  Python 3.11 ou plus recent est introuvable sur cet ordinateur.
  echo.
  echo  1. La page de telechargement va s'ouvrir : installez Python 3.13.
  echo  2. IMPORTANT : cochez la case "Add python.exe to PATH" en bas de la premiere fenetre.
  echo  3. Relancez ensuite DEMARRER.bat.
  echo.
  start "" "https://www.python.org/downloads/windows/"
  pause
  exit /b 1
)

REM --- 2. Installation (seulement la premiere fois) -----------------------
if not exist ".venv\installe.ok" (
  echo.
  echo  Premiere installation de NK Trader : quelques minutes, une connexion internet est necessaire...
  echo.
  if exist ".venv" rmdir /s /q ".venv"
  %PY% -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo  L'installation a echoue. Verifiez la connexion internet puis relancez DEMARRER.bat.
    echo  Si cela recommence, envoyez une photo de cette fenetre.
    pause
    exit /b 1
  )
  echo ok> ".venv\installe.ok"
)

REM --- 3. Lancement direct avec des options (ex. DEMARRER.bat --speed 60) --
if not "%~1"=="" (
  ".venv\Scripts\python.exe" run.py --phone --open %*
  pause
  exit /b
)

REM --- 4. Choix de la source des donnees ---------------------------------
echo.
echo  ====================================================================
echo     NK Trader - choisissez la source des donnees
echo  ====================================================================
echo     1 = Donnees reelles Deriv : indices synthetiques + Forex  [conseille]
echo     2 = Simulateur : demonstration, sans internet
echo     3 = MetaTrader 5 : le terminal MT5 doit etre ouvert sur ce PC
echo.
set "CHOIX=1"
set /p "CHOIX=  Tapez 1, 2 ou 3 puis appuyez sur Entree : "
set "SRC=deriv"
if "%CHOIX%"=="2" set "SRC=simulator"
if "%CHOIX%"=="3" set "SRC=mt5"
if "%SRC%"=="mt5" ".venv\Scripts\python.exe" -m pip install -q MetaTrader5

echo.
".venv\Scripts\python.exe" run.py --provider %SRC% --phone --open
echo.
echo  NK Trader s'est arrete. Si c'est inattendu, envoyez une photo de cette fenetre.
pause
