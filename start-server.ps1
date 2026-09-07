$ErrorActionPreference = 'Stop'
$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython) { $pythonPath = $venvPython }
else {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (!$pythonCommand) { throw 'Python 3.10 이상을 설치한 뒤 requirements.txt를 설치해 주세요.' }
  $pythonPath = $pythonCommand.Source
}
& $pythonPath (Join-Path $PSScriptRoot 'server.py')
