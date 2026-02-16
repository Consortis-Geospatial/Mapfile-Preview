@echo off
set ZIP_NAME=project.zip
set PROJECT_DIR=%cd%
set SEVENZIP="C:\Program Files\7-Zip\7z.exe"

echo Zipping project folder: %PROJECT_DIR%
echo Excluding: node_modules and %ZIP_NAME%

%SEVENZIP% a -tzip "%ZIP_NAME%" "%PROJECT_DIR%\*" -r -x!%ZIP_NAME% -xr!node_modules

echo Done! Created/updated %ZIP_NAME%
pause
