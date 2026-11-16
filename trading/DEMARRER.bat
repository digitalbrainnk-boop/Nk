@echo off
REM Lancement de NK Trader sous Windows.
REM Double-clic : simulateur. Pour Deriv : DEMARRER.bat --provider deriv
REM Pour MetaTrader 5 : DEMARRER.bat --provider mt5  (pip install MetaTrader5 d'abord)
cd /d "%~dp0"
if not exist .venv (
  echo Premiere installation...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python run.py --open %*
pause
