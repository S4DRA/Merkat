# The managed Windows sandbox denies workspace junction creation. Compile in order
# and synchronize package copies for this checkout only. Normal npm installs keep links.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:PATH = 'C:\Users\s4dra\AppData\Local\npm-cache\_npx\e30f327554399115\node_modules\node\bin;' + $env:PATH
Push-Location $projectRoot
try {
  npm run generate -w '@merkat/database'
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  foreach ($workspaceName in @('contracts','backend','database')) {
    npm run build -w "@merkat/$workspaceName"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $copyRoot = Join-Path $projectRoot "node_modules\@merkat\$workspaceName"
    Copy-Item -LiteralPath (Join-Path $projectRoot "packages\$workspaceName\dist") -Destination $copyRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot "packages\$workspaceName\package.json") -Destination $copyRoot -Force
  }
} finally { Pop-Location }
