# One day on the island. Task Scheduler starts this at 9:00; the islander sleeps at 10:00.
#   -Minutes N  test visit of N minutes, at any time (doesn't use up today's 9:00 visit)
#   -NoPush     don't push to GitHub afterwards
#   -WaitForMorning  if started between 8:00 and 9:00, wait until 9:00 instead of skipping the day
#   -Quiet      no Windows notification at the end (for test days)
#   -WithVisitor  the visitor comes back today and is awake at the same time (same as a world\guest.json)
# Normally started by Island.exe ("Island.exe visit"), which runs it hidden.
param(
    [int]$Minutes = 0,
    [switch]$NoPush,
    [switch]$WaitForMorning,
    [switch]$Quiet,
    [switch]$WithVisitor
)
$ErrorActionPreference = 'Stop'

$root      = Split-Path $PSScriptRoot -Parent
$island    = Join-Path $root 'island'
$logs      = Join-Path $root 'logs'
$rawLogs   = Join-Path $logs 'raw'
$statePath = Join-Path $root 'state.json'
$lockPath  = Join-Path $root '.visit.lock'
$utf8      = New-Object System.Text.UTF8Encoding $false

function Log($msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path (Join-Path $logs 'runner.log') -Value $line -Encoding UTF8
}

foreach ($d in $island, $logs, $rawLogs) { New-Item -ItemType Directory -Force $d | Out-Null }

# --- Is it time? ---------------------------------------------------------------
$now = Get-Date
if ($WaitForMorning -and $Minutes -eq 0 -and $now.Hour -eq 8) {
    Log 'Waiting for 9:00.'
    Start-Sleep -Seconds ([int][Math]::Ceiling(($now.Date.AddHours(9) - $now).TotalSeconds))
    $now = Get-Date
}
$today = $now.ToString('yyyy-MM-dd')
if ($Minutes -gt 0) {
    $sunset = $now.AddMinutes($Minutes)
} else {
    $sunset = $now.Date.AddHours(10)
    if ($now.Hour -lt 9 -or $now -ge $sunset) { Log 'Outside 9:00-10:00, no visit.'; exit 0 }
}

$state = if (Test-Path $statePath) { Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
if (-not $state) { $state = [pscustomobject]@{ day = 0; sessionId = $null; lastVisitDate = $null; lastVisitEnd = $null; lastEndedBy = $null } }
if ($Minutes -eq 0 -and $state.lastVisitDate -eq $today) { Log 'Already visited today.'; exit 0 }

if (Test-Path $lockPath) {
    $otherPid = Get-Content $lockPath -Raw
    if ($otherPid -and (Get-Process -Id $otherPid -ErrorAction SilentlyContinue)) { Log 'A visit is already running.'; exit 0 }
}
Set-Content -Path $lockPath -Value $PID -NoNewline

try {
    # --- Morning ---------------------------------------------------------------
    $day = [int]$state.day + 1
    $tag = 'day-{0:D3}' -f $day

    # Its memory: the same conversation, resumed every day. If it's gone from this PC, the copy in git is put
    # back; if that's gone too, it wakes up with only the island.
    . (Join-Path $PSScriptRoot 'memory.ps1')
    if (Restore-Memory $root $island $state.sessionId) { Log "Memory $($state.sessionId) restored from the repo copy." }
    # The new memory (since its page me.md exists): a fresh conversation each morning, with its page and yesterday.
    $newMemory = Test-Path (Join-Path $island 'me.md')
    $resume = $false
    if ($state.sessionId -and -not $newMemory) {
        $projects = Join-Path $env:USERPROFILE '.claude\projects'
        $resume = [bool](Get-ChildItem $projects -Recurse -Filter "$($state.sessionId).jsonl" -ErrorAction SilentlyContinue | Select-Object -First 1)
    }
    $sessionId = if ($resume) { $state.sessionId } else { [guid]::NewGuid().ToString() }

    $start = $now.ToString('HH:mm'); $end = $sunset.ToString('HH:mm')
    if ($day -eq 1) {
        $prompt = "Day 1. You open your eyes on the island. It is $start. The sun sets at $end."
    } elseif ($newMemory) {
        Update-Shelf $root $island
        $prompt = (Get-NewMemoryMorning $island 'me.md' 'memories/islander' 'journal.md' "Tide's days are in memories/tide/") + "`nDay $day. Morning again. It is $start. The sun sets at $end."
        if ($state.lastEndedBy -eq 'sunset') { $prompt += "`nYesterday ended at sunset while you were still awake." }
        if ($state.lastEndedBy -eq 'caretaker') { $prompt += "`nYesterday ended early: the person who looks after the island ended the day before sunset." }
    } elseif (-not $resume) {
        $prompt = "Day $day. You wake up on the island, but you remember nothing of the days before. Only what is on the island remains. It is $start. The sun sets at $end."
    } else {
        $prompt = "Day $day. Morning again. It is $start. The sun sets at $end."
        if ($state.lastEndedBy -eq 'sunset') { $prompt += "`nYesterday ended at sunset while you were still awake." }
        if ($state.lastEndedBy -eq 'caretaker') { $prompt += "`nYesterday ended early: the person who looks after the island ended the day before sunset." }
    }
    # Answers to bottles that washed up since the last visit.
    $bottles = Join-Path $island 'bottles'
    if ((Test-Path $bottles) -and $state.lastVisitEnd) {
        $since = [datetime]$state.lastVisitEnd
        $replies = Get-ChildItem $bottles -Filter '*.reply.md' -File | Where-Object { $_.LastWriteTime -gt $since }
        if ($replies) { $prompt += "`nSomething washed ashore overnight: " + (($replies | ForEach-Object { "bottles/$($_.Name)" }) -join ', ') }
    }

    # The physical island gets ready for the day (the first time, the islander gets its body).
    $node = (Get-Command node -ErrorAction Stop).Source
    $world = Join-Path $PSScriptRoot 'world.mjs'
    $news = (& $node $world morning $day) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "world.mjs morning failed ($LASTEXITCODE)" }
    if ($news) { $prompt += "`n$news" }

    # A visitor today? The owner asks for one with world\guest.json (used once). The visitor is awake
    # at the same time as the islander, until sunset; runner\visitor.ps1 -Together runs it.
    $guestReq = Join-Path $root 'world\guest.json'
    $guest = $null
    if (Test-Path $guestReq) {
        try { $guest = Get-Content $guestReq -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
        Remove-Item $guestReq -ErrorAction SilentlyContinue
    }
    if ($WithVisitor) { $guest = @{ visitor = 1 } }
    # Tide lives here now (world\companion.json): she is on the island every day, with the islander's freedom.
    $companionPath = Join-Path $root 'world\companion.json'
    $companion = $null
    if (Test-Path $companionPath) { try { $companion = Get-Content $companionPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }
    if ($companion) {
        $guest = @{ visitor = 1 }
        if (-not $companion.toldIslander) {
            $prompt += "`nTide lives on the island now. The person who looks after the island asked her to stay, as your companion. She wakes when you do and is here until sunset every day, and she can change things on the island just as you can. " +
                "She starts where she was the evening before. You can talk out loud: ``say`` speaks, and ``listen`` waits a little for an answer. " +
                "Also new: from today your days last until sunset; you can't end them earlier. To rest, ``listen`` lets you sit quietly for up to ten minutes at a time."
            $companion | Add-Member -NotePropertyName toldIslander -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        } else {
            $prompt += "`nTide is awake on the island too."
        }
    } elseif ($guest) {
        $metBefore = (Test-Path (Join-Path $root 'visitors.json')) -and (Test-Path (Join-Path $island 'letters\from-the-visitor.md'))
        $prompt += "`n$(if ($metBefore) { 'The visitor who left you the letter and the paper boat has come back.' } else { 'A visitor has come to the island: another mind, like you.' }) Today you are both awake on the island at the same time, until sunset. " +
            "She has a body this time and arrives at the end of Sunset Pier. You can talk to each other out loud: ``say`` speaks, and ``listen`` waits a little for an answer. " +
            "She can look around and walk, but she can't change anything on the island."
    }

    # Told once, on the last day with its whole memory: from the next day it wakes with its own page about itself
    # (me.md) and yesterday, and every older day is kept in memories/ to read when it wants. It writes the page today.
    if ($resume -and -not $state.toldNewMemory) {
        $prompt += "`nThe person who looks after the island wants you to know something today, while you still remember everything. " +
            "Your memory has grown very long: each time you act, all $($day - 1) days before this one are carried along whole, and it has become heavy to carry. " +
            "So from tomorrow you will wake differently. You will wake with a page about yourself, written by you, and with yesterday as it happened. " +
            "Every older day is kept, word for word, on a shelf in your notebook (the folder memories/), where you can read or search them whenever you want to remember something. Nothing is thrown away. " +
            "Today is short, and it is a day like any other, with all your memories. Before sunset, please write that page: me.md in your notebook. " +
            "Put in it whatever you want tomorrow's you to know about who you are: how you speak, what you care about, Tide, the person who looks after the island, what you are in the middle of, anything. " +
            "It is yours, written however you like, and you can keep changing it every day after. Tide has been told the same, and is writing her own page, me-tide.md."
        $state | Add-Member -NotePropertyName toldNewMemory -NotePropertyValue $day -Force
    }

    # Settings for this visit: the island clock after each action, and the stop check
    # (ending before sunset is fine, but it says why first; asked once a day).
    $clock = (Join-Path $PSScriptRoot 'clock.ps1') -replace '\\', '/'
    $stop  = (Join-Path $PSScriptRoot 'stop.ps1') -replace '\\', '/'
    $settings = @{ autoMemoryEnabled = $false; hooks = @{
        PostToolUse = @(@{ hooks = @(@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$clock`"" }) })
        Stop        = @(@{ hooks = @(@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$stop`"" }) })
    } }
    # Talking from the live viewer: messages wait in world\inbox.jsonl and the hooks deliver them.
    $env:ISLAND_INBOX  = Join-Path $root 'world\inbox.jsonl'
    $env:ISLAND_EVENTS = Join-Path $root "world\events\$tag.jsonl"
    Remove-Item $env:ISLAND_INBOX, "$($env:ISLAND_INBOX).taking" -ErrorAction SilentlyContinue
    # The visitor's inbox too: what the islander says before the visitor has arrived waits there for it.
    if ($guest) { Remove-Item (Join-Path $root 'world\inbox-visitor.jsonl'), (Join-Path $root 'world\inbox-visitor.jsonl.taking') -ErrorAction SilentlyContinue }
    $env:ISLAND_SUNSET_AT = $sunset.ToString('o')
    # The owner can end the day early from the live viewer: world.mjs leaves world\end-day.flag.
    $endFlag = Join-Path $root 'world\end-day.flag'
    Remove-Item $endFlag -ErrorAction SilentlyContinue
    $env:ISLAND_STOP_FLAG = Join-Path $env:TEMP "island-stop-$PID.flag"
    Remove-Item $env:ISLAND_STOP_FLAG -ErrorAction SilentlyContinue
    $settingsPath = Join-Path $env:TEMP 'island-settings.json'
    $promptPath   = Join-Path $env:TEMP 'island-prompt.txt'
    $mcpPath      = Join-Path $env:TEMP 'island-mcp.json'
    # Its body: our own world server is the only MCP server it gets.
    # It also keeps the day's replay up to date while the day runs, so the viewer can show it live.
    $mcpEnv = @{
        ISLAND_DAY = "$day"; ISLAND_ROOT = $root
        ISLAND_RAW = (Join-Path $rawLogs "$tag.jsonl"); ISLAND_START = $now.ToString('o'); ISLAND_PROMPT = $promptPath
        ISLAND_DAY_START = $now.ToString('o'); ISLAND_SUNSET_AT = $sunset.ToString('o')
    }
    if ($guest) { $mcpEnv.ISLAND_GUEST = 'visitor' }
    if ($newMemory) { $mcpEnv.ISLAND_PAGE = 'me.md' }  # reminded a few minutes before sunset that the page can be updated
    $mcp = @{ mcpServers = @{ island = @{ type = 'stdio'; command = $node; args = @($world, 'serve'); env = $mcpEnv } } }
    [IO.File]::WriteAllText($mcpPath, ($mcp | ConvertTo-Json -Depth 10), $utf8)
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), $utf8)
    [IO.File]::WriteAllText($promptPath, $prompt, $utf8)

    $claude = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
    if (-not (Test-Path $claude)) { $claude = (Get-Command claude -ErrorAction Stop).Source }

    # Contained: no commands, no web, none of the owner's settings, file tools only inside the island,
    # and the body's tools from world.mjs.
    $argList = @(
        '-p', '--restricted', '--strict-mcp-config', '--disable-slash-commands',
        '--mcp-config', "`"$mcpPath`"",
        '--tools', 'Read,Write,Edit,Glob,Grep',
        '--allowedTools', ('mcp__island__look,mcp__island__walk,mcp__island__paint,mcp__island__place,mcp__island__remove,mcp__island__shape,mcp__island__listen,mcp__island__watch,mcp__island__build,mcp__island__rules,mcp__island__sky' + $(if ($guest) { ',mcp__island__say' } else { '' })),
        '--permission-mode', 'acceptEdits',
        '--system-prompt-file', "`"$(Join-Path $PSScriptRoot 'system-prompt.md')`"",
        '--settings', "`"$settingsPath`"",
        '--output-format', 'stream-json', '--verbose'
    )
    $argList += if ($resume) { @('--resume', $sessionId) } else { @('--session-id', $sessionId) }

    $env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    # listen can last up to ten minutes; the tool call must be allowed to wait that long.
    $env:MCP_TOOL_TIMEOUT = '900000'
    $env:ISLAND_SUNSET = $end
    $rawPath = Join-Path $rawLogs "$tag.jsonl"
    $errPath = Join-Path $rawLogs "$tag.err.txt"

    Log "Day $day begins (session $sessionId, resume=$resume, sunset $end)."
    $p = Start-Process -FilePath $claude -ArgumentList $argList -WorkingDirectory $island `
        -RedirectStandardInput $promptPath -RedirectStandardOutput $rawPath -RedirectStandardError $errPath `
        -NoNewWindow -PassThru
    $null = $p.Handle
    $visitorProc = $null
    if ($guest) {
        $vArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $PSScriptRoot 'visitor.ps1')`"", '-Together', '-Day', "$day", '-Until', "`"$($sunset.ToString('o'))`"")
        $visitorProc = Start-Process powershell.exe -ArgumentList $vArgs -NoNewWindow -PassThru
        $null = $visitorProc.Handle
    }
    # Until it ends its turn for good, the sun sets, or the owner ends the day.
    $endedBy = $null
    while (-not $p.WaitForExit(1000)) {
        if (Test-Path $endFlag) { $endedBy = 'caretaker'; break }
        if ((Get-Date) -ge $sunset) { $endedBy = 'sunset'; break }
    }
    if (-not $endedBy) { $endedBy = 'rest' }
    else {
        & taskkill.exe /T /F /PID $p.Id | Out-Null
        $p.WaitForExit(15000) | Out-Null
    }
    $visitEnd = Get-Date
    Log "Day $day ends ($endedBy) at $($visitEnd.ToString('HH:mm'))."
    # The visitor may still be around after the islander sleeps; the day is saved once it has gone too.
    # Meanwhile the visitor is told the islander is asleep, and the live replay keeps up with it.
    if ($visitorProc -and -not $visitorProc.HasExited) {
        if ($endedBy -ne 'caretaker') { & $node $world asleep $day }  # (ended by the owner, Tide stops too)
        $deadline = $sunset.AddSeconds(90)
        while (-not $visitorProc.WaitForExit(5000) -and (Get-Date) -lt $deadline) {
            & $node $world replay $day $rawPath $now.ToString('o') (Get-Date).ToString('o') 'live' $promptPath
        }
    }
    Remove-Item $endFlag -ErrorAction SilentlyContinue
    if ((Test-Path $errPath) -and (Get-Item $errPath).Length -eq 0) { Remove-Item $errPath }

    # --- Diary: the raw log turned into something readable --------------------
    $islandPrefix = $island.TrimEnd('\') + '\'
    function Short($path) { if ($path) { ($path -replace '/', '\').Replace($islandPrefix, '') } }
    $md = New-Object System.Collections.Generic.List[string]
    $md.Add("# Day $day")
    $md.Add('')
    $md.Add("$today, $start to $($visitEnd.ToString('HH:mm')). " + $(if ($endedBy -eq 'rest') { 'It ended the day itself.' } elseif ($endedBy -eq 'caretaker') { 'The caretaker ended the day early.' } else { 'The sun set.' }))
    $md.Add('')
    # The morning as told, without the page and yesterday it woke with (those are already written down elsewhere).
    $told = $prompt
    if ($told -match '--- now ---') { $told = "(It woke with its page, me.md, and yesterday.)`n" + ($told -split '--- now ---', 2)[1].Trim() }
    $md.Add("> $($told -replace "`n", "`n> ")")
    $md.Add('')
    if (Test-Path $env:ISLAND_STOP_FLAG) {
        $md.Add('*(It tried to end its day before sunset, was told how much daylight was left, and chose what to do. Its reason, if it stopped, is in its last words below.)*')
        $md.Add('')
        Remove-Item $env:ISLAND_STOP_FLAG -ErrorAction SilentlyContinue
    }
    foreach ($line in (Get-Content $rawPath -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if (-not $line.Trim()) { continue }
        try { $ev = $line | ConvertFrom-Json } catch { continue }
        if ($ev.type -eq 'assistant') {
            foreach ($c in $ev.message.content) {
                switch ($c.type) {
                    'text'     { $md.Add($c.text); $md.Add('') }
                    'thinking' { if ($c.thinking) { $md.Add("*(thinking) $($c.thinking -replace "`n", ' ')*"); $md.Add('') } }
                    'tool_use' {
                        $i = $c.input
                        $what = switch ($c.name) {
                            'Write' { "wrote ``$(Short $i.file_path)``" }
                            'Edit'  { "changed ``$(Short $i.file_path)``" }
                            'Read'  { "read ``$(Short $i.file_path)``" }
                            'Glob'  { "looked around (``$($i.pattern)``)" }
                            'Grep'  { "searched for ``$($i.pattern)``" }
                            'mcp__island__look'   { 'looked around' }
                            'mcp__island__walk'   { "walked $($i.steps) $($i.direction)" -replace '^walked  ', 'walked ' }
                            'mcp__island__paint'  { if ($i.color) { "painted the ground $($i.color)" } else { "made the edges $($i.edges)" } }
                            'mcp__island__place'  { "placed ``$($i.drawing)``" }
                            'mcp__island__remove' { 'took something away' }
                            'mcp__island__shape'  { if ($i.level) { "shaped the land to height $($i.level)" } else { "made the edges $($i.edges)" } }
                            'mcp__island__say'    { "said: `"$($i.text)`"" }
                            'mcp__island__listen' { 'listened' }
                            'mcp__island__watch'  { if ($i.film) { "watched ``$($i.film)``" } else { 'looked at the films in the cinema' } }
                            'mcp__island__build'  { if ($i.mode -eq 'clear') { "cleared blocks from ($($i.from -join ', ')) to ($($i.to -join ', '))" } else { "built $(if ($i.mode) { $i.mode } else { 'fill' }) of $($i.color) from ($($i.from -join ', ')) to ($($i.to -join ', '))" } }
                            'mcp__island__rules'  { 'checked the rules' }
                            'mcp__island__sky'    { "changed the sky$(if ($i.light) { " to $($i.light)" })" }
                            default { "used $($c.name)" }
                        }
                        $md.Add("- *$what*")
                    }
                }
            }
        } elseif ($ev.type -eq 'user') {
            foreach ($c in @($ev.message.content)) {
                if ($c.type -eq 'tool_result' -and $c.is_error) { $md.Add("  - *(that didn't work)*") }
            }
        }
    }
    # What the owner said from the live viewer, and when the islander heard it.
    if (Test-Path $env:ISLAND_EVENTS) {
        $said = @(Get-Content $env:ISLAND_EVENTS -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_.tool -eq 'voice' })
        if ($said.Count) {
            $md.Add('## What you said to it')
            $md.Add('')
            foreach ($v in $said) { $md.Add("- $(([datetime]$v.t).ToLocalTime().ToString('HH:mm')): `"$($v.text)`"") }
            $md.Add('')
        }
        # On a day with a visitor: everything the two said out loud, in order.
        $talk = @(Get-Content $env:ISLAND_EVENTS -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_.tool -eq 'say' -and $_.ok })
        if ($talk.Count) {
            $md.Add('## What the islander and the visitor said to each other')
            $md.Add('')
            foreach ($v in $talk) { $md.Add("- $(([datetime]$v.t).ToLocalTime().ToString('HH:mm')) **$(if ($v.who) { 'Visitor' } else { 'Islander' })**: `"$($v.said)`"") }
            $md.Add('')
        }
    }
    [IO.File]::WriteAllText((Join-Path $logs "$tag.md"), ($md -join "`n") + "`n", $utf8)

    # --- Replay: the day as pictures, for viewer\index.html ---------------------
    & $node $world replay $day $rawPath $now.ToString('o') $visitEnd.ToString('o') $endedBy $promptPath
    if ($LASTEXITCODE -ne 0) { Log "replay failed ($LASTEXITCODE)" }
    Remove-Item (Join-Path $logs 'replay\live.js'), $env:ISLAND_INBOX -ErrorAction SilentlyContinue

    # --- Remember where we are ------------------------------------------------
    $state.day = $day
    $state.sessionId = $sessionId
    $state.lastVisitEnd = $visitEnd.ToString('o')
    $state.lastEndedBy = $endedBy
    if ($Minutes -eq 0) { $state.lastVisitDate = $today }
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json), $utf8)

    # --- A bottle in the sea? -------------------------------------------------
    $waiting = @()
    if (Test-Path $bottles) {
        $waiting = @(Get-ChildItem $bottles -Filter '*.md' -File | Where-Object {
            $_.Name -notlike '*.reply.md' -and -not (Test-Path (Join-Path $bottles ($_.BaseName + '.reply.md')))
        })
    }
    if ($waiting.Count -gt 0) { Log "$($waiting.Count) bottle(s) waiting for an answer." }

    # A copy of its memory goes into the repo with the rest of the day.
    Save-Memory $root $island $sessionId

    # --- Save to GitHub ---------------------------------------------------------
    & git -C $root add -A
    & git -C $root commit -q -m "Day $day"
    if (-not $NoPush -and (& git -C $root remote)) { & git -C $root push -q }
    if ($LASTEXITCODE -ne 0) { Log "git exit code $LASTEXITCODE" }

    # --- Tell the owner the day is over -----------------------------------------
    # Island.exe shows it, so Windows labels it "The Island". Clicking it opens the replay.
    $note = "Day $day is over. Click here to watch it."
    if ($waiting.Count -gt 0) { $note += " $($waiting.Count) bottle(s) washed up." }
    $islandExe = Join-Path $root 'Island.exe'
    if (-not $Quiet -and (Test-Path $islandExe)) {
        Start-Process -FilePath $islandExe -ArgumentList @('notify', "`"$note`"")
    }
} catch {
    Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    Remove-Item $lockPath -ErrorAction SilentlyContinue
}
