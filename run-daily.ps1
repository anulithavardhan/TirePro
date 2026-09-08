$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeExe = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules\playwright'))) {
  Push-Location $ProjectDir
  try {
    npm install
    npx playwright install chromium
  } finally {
    Pop-Location
  }
}
$Date = Get-Date -Format 'yyyy-MM-dd'
& $NodeExe (Join-Path $ProjectDir 'scrape.mjs') `
  --input (Join-Path $ProjectDir 'input.tsv') `
  --output (Join-Path $ProjectDir "tireworks-prices-$Date.csv")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
