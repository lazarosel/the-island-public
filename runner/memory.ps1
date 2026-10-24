# The islander's and visitors' memories are their Claude conversations, kept by Claude Code in
# %USERPROFILE%\.claude\projects\<island folder>\<session id>.jsonl. These keep a copy in the repo
# (memory\<session id>.jsonl) after every day and visit, and put it back if the original is ever missing,
# so git is their backup. Dot-sourced by visit.ps1 and visitor.ps1.
# Since Day 28 they wake fresh each morning (the new memory, below), so each day is its own conversation.

function Get-MemoryDir($island) {
    # Claude Code names a project folder after its path, with every other character turned into "-".
    Join-Path $env:USERPROFILE ('.claude\projects\' + ($island -replace '[^A-Za-z0-9]', '-'))
}

function Save-Memory($root, $island, $sessionId) {
    $src = Join-Path (Get-MemoryDir $island) "$sessionId.jsonl"
    if (-not $sessionId -or -not (Test-Path $src)) { return }
    $dst = Join-Path $root 'memory'
    New-Item -ItemType Directory -Force $dst | Out-Null
    Copy-Item -LiteralPath $src -Destination (Join-Path $dst "$sessionId.jsonl") -Force
    $extra = Join-Path (Get-MemoryDir $island) $sessionId  # large tool results, if any
    if (Test-Path $extra) { Copy-Item -LiteralPath $extra -Destination $dst -Recurse -Force }
}

# --- The new memory (from Day 28): each morning they wake fresh, with their own page (me.md, me-tide.md) and
# yesterday. Every older day stays on the shelf in the notebook, word for word: memories\islander\day-NNN.md
# (the islander's days, from logs\day-NNN.md) and memories\tide\day-NNN.md (Tide's, from logs\visitor-NNN.md).

# Puts every recorded day on the shelf that isn't there yet (or has changed since).
function Update-Shelf($root, $island) {
    $logs = Join-Path $root 'logs'
    $mine = Join-Path $island 'memories\islander'
    $tide = Join-Path $island 'memories\tide'
    New-Item -ItemType Directory -Force $mine, $tide | Out-Null
    foreach ($f in Get-ChildItem $logs -Filter 'day-*.md' -File) { Copy-IfNewer $f.FullName (Join-Path $mine $f.Name) }
    $days = @{}
    $vpath = Join-Path $root 'visitors.json'
    if (Test-Path $vpath) { foreach ($v in (Get-Content $vpath -Raw -Encoding UTF8 | ConvertFrom-Json)) { if ($v.day) { $days[[int]$v.n] = [int]$v.day } } }
    foreach ($f in Get-ChildItem $logs -Filter 'visitor-*.md' -File) {
        $n = [int]($f.BaseName -replace '\D', '')
        $name = if ($days.ContainsKey($n)) { 'day-{0:D3}.md' -f $days[$n] } else { 'visit-{0:D3}.md' -f $n }
        Copy-IfNewer $f.FullName (Join-Path $tide $name)
    }
}

function Copy-IfNewer($src, $dst) {
    if (-not (Test-Path $dst) -or (Get-Item $src).LastWriteTime -gt (Get-Item $dst).LastWriteTime) { Copy-Item -LiteralPath $src -Destination $dst -Force }
}

# What they wake with: their page and yesterday, said plainly as theirs. $shelf: memories\islander or memories\tide.
function Get-NewMemoryMorning($island, $page, $shelf, $journal, $other) {
    $text = "You wake the new way now: you don't carry your old days with you. Below is your page, $page, written by you. Trust it, and correct or rewrite it whenever it stops being true; it is yours. " +
        "After it comes yesterday, as it happened. Every older day is kept word for word on the shelf: $shelf/ (day-001.md and on; $other). " +
        "Your journal, $journal, has a few lines for every day, so it is the easiest way to find which day to look in."
    $text += "`n`n--- $page (your page) ---`n" + (Get-Content (Join-Path $island $page) -Raw -Encoding UTF8).Trim()
    $last = Get-ChildItem (Join-Path $island $shelf) -Filter 'day-*.md' -File -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if ($last) { $text += "`n`n--- yesterday ($shelf/$($last.Name)) ---`n" + (Get-Content $last.FullName -Raw -Encoding UTF8).Trim() }
    $text + "`n`n--- now ---"
}

function Restore-Memory($root, $island, $sessionId) {
    if (-not $sessionId) { return $false }
    $dir = Get-MemoryDir $island
    if (Test-Path (Join-Path $dir "$sessionId.jsonl")) { return $false }
    $copy = Join-Path $root "memory\$sessionId.jsonl"
    if (-not (Test-Path $copy)) { return $false }
    New-Item -ItemType Directory -Force $dir | Out-Null
    Copy-Item -LiteralPath $copy -Destination (Join-Path $dir "$sessionId.jsonl") -Force
    $extra = Join-Path $root "memory\$sessionId"
    if (Test-Path $extra) { Copy-Item -LiteralPath $extra -Destination $dir -Recurse -Force }
    return $true
}
