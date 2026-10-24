# Read the bottles the islander threw into the sea, and answer them.
# Nothing runs unless you say yes.
$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$island  = Join-Path $root 'island'
$bottles = Join-Path $island 'bottles'
$utf8    = New-Object System.Text.UTF8Encoding $false

function Reply($bottle, $text) {
    $path = Join-Path $bottles ($bottle.BaseName + '.reply.md')
    [IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host "Answer sent: bottles/$($bottle.BaseName).reply.md" -ForegroundColor Green
}

$waiting = @()
if (Test-Path $bottles) {
    $waiting = @(Get-ChildItem $bottles -Filter '*.md' -File | Where-Object {
        $_.Name -notlike '*.reply.md' -and -not (Test-Path (Join-Path $bottles ($_.BaseName + '.reply.md')))
    })
}
if ($waiting.Count -eq 0) { Write-Host 'No bottles on the shore.'; Read-Host 'Press Enter to close'; exit }

foreach ($b in $waiting) {
    Write-Host ''
    Write-Host "===== bottles/$($b.Name) =====" -ForegroundColor Cyan
    $body = Get-Content $b.FullName -Raw -Encoding UTF8
    Write-Host $body
    $runLine = ($body -split "`n" | Where-Object { $_ -match '^\s*RUN:\s*(.+)$' } | Select-Object -First 1)
    $date = Get-Date -Format 'yyyy-MM-dd HH:mm'

    if ($runLine) {
        $cmd = ([regex]::Match($runLine, '^\s*RUN:\s*(.+)$').Groups[1].Value).Trim()
        Write-Host ''
        Write-Host 'It asks to run (inside the island folder):' -ForegroundColor Yellow
        Write-Host "  $cmd" -ForegroundColor Yellow
        $ans = Read-Host '[y] run it   [n] decline   [s] skip for now'
        if ($ans -eq 'y') {
            $out = Join-Path $env:TEMP 'island-run-out.txt'
            $err = Join-Path $env:TEMP 'island-run-err.txt'
            $p = Start-Process powershell -ArgumentList @('-NoProfile', '-Command', "`"$($cmd -replace '"', '\"')`"") `
                -WorkingDirectory $island -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru
            $null = $p.Handle
            $timedOut = -not $p.WaitForExit(300000)
            if ($timedOut) { & taskkill.exe /T /F /PID $p.Id | Out-Null }
            $output = ((Get-Content $out -Raw -Encoding UTF8) + (Get-Content $err -Raw -Encoding UTF8))
            if (-not $output) { $output = '(no output)' }
            if ($output.Length -gt 20000) { $output = $output.Substring(0, 20000) + "`n... (cut off)" }
            Write-Host $output
            $status = if ($timedOut) { 'It was stopped after 5 minutes.' } else { "Exit code $($p.ExitCode)." }
            $note = Read-Host 'Note to send back (optional)'
            $text = "It was run on $date. $status`n`n``````n$output`n```````n"
            if ($note) { $text += "`n$note`n" }
            Reply $b $text
        } elseif ($ans -eq 'n') {
            $note = Read-Host 'Note to send back (optional)'
            $text = "Declined on $date.`n"
            if ($note) { $text += "`n$note`n" }
            Reply $b $text
        }
    } else {
        $ans = Read-Host '[r] write an answer   [k] mark as read, no answer   [s] skip for now'
        if ($ans -eq 'r') {
            $note = Read-Host 'Your answer'
            Reply $b "$note`n"
        } elseif ($ans -eq 'k') {
            Reply $b "The bottle was found and read on $date.`n"
        }
    }
}

& git -C $root add -A
& git -C $root commit -q -m 'Bottles answered'
if (& git -C $root remote) { & git -C $root push -q }
Read-Host 'Done. Press Enter to close'
