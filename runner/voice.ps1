# Messages waiting for this body: from the owner's live viewer, or from someone else on the island who
# used `say` (world\inbox.jsonl for the islander, world\inbox-<who>.jsonl for a visitor; written by world.mjs).
# Dot-sourced by the hooks. They aren't told the owner can do this; a message simply reaches them at their
# next action, or when they try to end their day. (The owner's words are written into the day's record by
# world.mjs when they are sent, once, however many hear them.)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Take-Voices {
    $inbox = $env:ISLAND_INBOX
    if (-not $inbox -or -not (Test-Path $inbox)) { return ,@() }
    $taking = "$inbox.taking"
    try { Move-Item -LiteralPath $inbox -Destination $taking -Force -ErrorAction Stop } catch { return ,@() }
    $lines = [IO.File]::ReadAllLines($taking, $utf8NoBom) | Where-Object { $_.Trim() }
    Remove-Item -LiteralPath $taking -ErrorAction SilentlyContinue
    $msgs = @()
    foreach ($l in $lines) {
        try { $m = $l | ConvertFrom-Json } catch { continue }
        if (-not $m.text) { continue }
        $msgs += $m
    }
    return ,$msgs
}

function Format-Voices($msgs) {
    $names = @{ islander = 'The islander'; visitor = 'Tide' }
    ($msgs | ForEach-Object {
        if ($_.from -eq 'island') { [string]$_.text }  # the island telling what happens (someone left, fell asleep)
        elseif ($_.from) { "$(if ($names[$_.from]) { $names[$_.from] } else { $_.from }) says: `"$($_.text)`"" }
        else { "A voice carries across the water. It is the person who looks after the island, and they say: `"$($_.text)`"" }
    }) -join "`n"
}
