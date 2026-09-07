# Run after editing union_raid.txt to update the data bundled with the page.
$ErrorActionPreference = 'Stop'
$raw = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'union_raid.txt'), [Text.Encoding]::UTF8)
$json = ConvertTo-Json -InputObject $raw -Compress
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'data.js'), ('window.UNION_RAID_TEXT = ' + $json + ';'), [Text.UTF8Encoding]::new($false))
Write-Output 'Updated data.js from union_raid.txt.'
