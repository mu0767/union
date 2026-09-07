$ErrorActionPreference = 'Stop'
$html = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'blabla-dom.html'))
$names = Import-Csv (Join-Path $PSScriptRoot 'union_raid.txt') | ForEach-Object { @($_.'니케1', $_.'니케2', $_.'니케3', $_.'니케4', $_.'니케5') } | Where-Object { $_ } | Sort-Object -Unique
$catalog = @()
$cards = $html -split 'data-cname="all-item"'
foreach ($name in $names) {
  $found = @($cards | Where-Object { $_.Contains(('>' + $name + '</span>')) })
  if ($found.Count -ne 1) { throw "Expected one card for $name, got $($found.Count)" }
  $url = [regex]::Match($found[0], 'https://sg-tools-cdn\.blablalink\.com/[^" ]+\.webp').Value
  if (!$url) { throw "No portrait for $name" }
  $id = 'nikke-' + ($catalog.Count + 1).ToString('00')
  $catalog += [pscustomobject]@{name=$name; image="assets/portraits/$id.webp"; source=$url}
}
$directory = Join-Path $PSScriptRoot 'assets/portraits'
[IO.Directory]::CreateDirectory($directory) | Out-Null
foreach ($character in $catalog) {
  Invoke-WebRequest -UseBasicParsing $character.source -OutFile (Join-Path $PSScriptRoot $character.image)
  Write-Output $character.name
}
$json = ConvertTo-Json -InputObject $catalog -Depth 4
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'characters.js'), "window.NIKKE_CHARACTERS = $json;", [Text.UTF8Encoding]::new($false))
