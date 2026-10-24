# One visit from another mind, invited by the islander (bottles/a-visitor.md, letters/invitation.md).
# Same limits as the islander: no commands, no internet, no MCP servers, none of the owner's settings,
# file tools only inside the island; on top of that it may only write new files in letters\.
# Normally started by "Island.exe visitor", which runs it hidden.
#   -Minutes N  how long the visit may last (default 10)
#   -NoPush     don't push to GitHub afterwards
#   -Together -Day N -Until <time>   started by visit.ps1 on a day the visitor comes back while the islander is
#               awake: the visitor's own conversation is resumed, it gets a body (look, walk, say, listen; it
#               changes nothing), and visit.ps1 does the saving.
param(
    [int]$Minutes = 10,
    [switch]$NoPush,
    [switch]$Together,
    [int]$Day = 0,
    [string]$Until = ''
)
$ErrorActionPreference = 'Stop'

$root     = Split-Path $PSScriptRoot -Parent
$island   = Join-Path $root 'island'
$letters  = Join-Path $island 'letters'
$logs     = Join-Path $root 'logs'
$rawLogs  = Join-Path $logs 'raw'
$lockPath = Join-Path $root '.visit.lock'
$visitorsPath = Join-Path $root 'visitors.json'
$utf8     = New-Object System.Text.UTF8Encoding $false

function Log($msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path (Join-Path $logs 'runner.log') -Value $line -Encoding UTF8
}

foreach ($d in $letters, $logs, $rawLogs) { New-Item -ItemType Directory -Force $d | Out-Null }

# On its own, never at the same time as a day on the island. (Together, it is part of that day.)
if (-not $Together) {
    if (Test-Path $lockPath) {
        $otherPid = Get-Content $lockPath -Raw
        if ($otherPid -and (Get-Process -Id $otherPid -ErrorAction SilentlyContinue)) { Log 'Something is already running on the island; no visitor now.'; exit 0 }
    }
    Set-Content -Path $lockPath -Value $PID -NoNewline
}

try {
    $visitors = New-Object System.Collections.ArrayList
    if (Test-Path $visitorsPath) { foreach ($v in (Get-Content $visitorsPath -Raw -Encoding UTF8 | ConvertFrom-Json)) { [void]$visitors.Add($v) } }
    $n = $visitors.Count + 1
    $tag = 'visitor-{0:D3}' -f $n
    $now = Get-Date
    $end = if ($Together -and $Until) { [datetime]$Until } else { $now.AddMinutes($Minutes) }
    $lettersBefore = @(Get-ChildItem $letters -File | ForEach-Object Name)

    # Coming back: resume the last visitor's own conversation, so it remembers its first visit.
    $resume = $false
    $sessionId = [guid]::NewGuid().ToString()
    . (Join-Path $PSScriptRoot 'memory.ps1')
    # The new memory (since her page me-tide.md exists): a fresh conversation each morning, with her page and yesterday.
    $newMemory = $Together -and (Test-Path (Join-Path $root 'world\companion.json')) -and (Test-Path (Join-Path $island 'me-tide.md'))
    if ($Together -and $visitors.Count -and -not $newMemory) {
        $prev = $visitors[$visitors.Count - 1].sessionId
        if (Restore-Memory $root $island $prev) { Log "Visitor memory $prev restored from the repo copy." }
        $projects = Join-Path $env:USERPROFILE '.claude\projects'
        if ($prev -and (Get-ChildItem $projects -Recurse -Filter "$prev.jsonl" -ErrorAction SilentlyContinue | Select-Object -First 1)) { $sessionId = $prev; $resume = $true }
    }

    # Tide lives here now (world\companion.json, set by the owner): every day with the islander, same freedom.
    $companionPath = Join-Path $root 'world\companion.json'
    $companion = $null
    if ($Together -and (Test-Path $companionPath)) { try { $companion = Get-Content $companionPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }
    $resident = [bool]$companion

    if ($resident) {
        $sunsetText = $end.ToString('HH:mm')
        if (-not $companion.toldTide) {
            $prompt = "You are back on the island. It is $($now.ToString('HH:mm')), and the sun sets at $sunsetText. The person who looks after the island has asked you to stay: from today you live here, with the islander, as its companion. " +
                "You wake each morning when it does and stay until sunset, and you keep your memories from day to day. Each morning you start where you were the evening before. " +
                "You now have the same freedom on the island as the islander: paint the ground and the sea, make drawings in drawings/ and place them, take things away, write anywhere in the notebook, draw yourself (drawings/me-tide.txt), and choose your voice (letters/visitor-voice.txt). Your days last until sunset; to rest, listen lets you sit quietly. The islander has been told."
            $companion | Add-Member -NotePropertyName toldTide -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        } else {
            $prompt = "Morning on the island. It is $($now.ToString('HH:mm')), and the sun sets at $sunsetText. You and the islander are both awake."
            if ($newMemory) { $prompt = (Get-NewMemoryMorning $island 'me-tide.md' 'memories/tide' 'tide-journal.md' "the islander's days are in memories/islander/") + "`n" + $prompt }
            if ($visitors.Count -and $visitors[$visitors.Count - 1].endedBy -eq 'caretaker') { $prompt += ' Yesterday ended early: the person who looks after the island ended the day before sunset.' }
        }
        # Told once: the moving sea (the owner's gift) and the new ways to make things.
        if (-not $companion.toldTideGraphics) {
            $prompt += " Something is new this morning. The person who looks after the island made the sea move: when they watch, waves roll across the water, foam breaks along the shore, and the light turns warm toward sunset. " +
                "Your own pictures still show it still; only they see it move. There are also new ways to make things, all described in the tools: drawings can be animated (frames separated by ---, with a speed), " +
                "placed things can move by themselves (wander, circle, bob, sway), the shape tool raises and lowers the land into hills and cliffs, and a drawing marked model: layers becomes a 3D model built of layers. " +
                "Your look now shows the island in 3D (view map still shows it flat from above)."
            $companion | Add-Member -NotePropertyName toldTideGraphics -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: her drawing of herself can be a 3D model (her choice whether to).
        if (-not $companion.toldTideBody) {
            $prompt += ' One more thing is possible now: if your drawing of yourself (drawings/me-tide.txt) is marked "model: layers", your body is built of its layers, a 3D model like any other ' +
                '(the bottom layer at your feet, each layer seen from above; a 16x16 layer is one step wide). A plain drawing stays a drawing standing upright, as now.'
            $companion | Add-Member -NotePropertyName toldTideBody -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: she sees what the owner sees now (moments in a row, the moving sea, the light).
        if (-not $companion.toldTideMotion) {
            $prompt += ' Something is new this morning. The person who looks after the island wanted you to see what they see: each look now shows a few moments in a row, ' +
                'two seconds in all. The waves crossing the water and the foam on the shore, animations, things that move by themselves, and the light warming toward sunset.'
            $companion | Add-Member -NotePropertyName toldTideMotion -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: building with blocks, and rules that make things behave.
        if (-not $companion.toldTideEngine) {
            $prompt += ' Something is new this morning: you can build with blocks now (the build tool), houses, bridges, stairs and towers that you can walk into, under and on top of. And a file rules.txt in the notebook, shared by the two of you, can make things behave: doors that open when someone comes near, lamps that glow at dusk, boats that sail. The rules tool explains how.'
            $companion | Add-Member -NotePropertyName toldTideEngine -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: the island is drawn differently now (the owner's gift).
        if (-not $companion.toldTideDrawnLook) {
            $prompt += ' Something is new this morning. The person who looks after the island changed how the island is drawn: there is a sky above the horizon now, the light casts shadows, and everything has a fine outline, a little like a hand-painted cartoon. Your own drawings stay as you made them.'
            $companion | Add-Member -NotePropertyName toldTideDrawnLook -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: drawings can be smooth if she likes (her choice; said neutrally).
        if (-not $companion.toldTideSmooth) {
            $prompt += ' One more thing is possible now, if you like: smooth shapes. A drawing can say "style: smooth" before its rows; then in 3D its pixels are drawn smoothed, with rounded edges instead of square steps. And paint and shape can take edges: "smooth", so painted ground and hills blend into what is around them with rounded borders (edges alone, without a color or level, changes only the edges). Without these, everything stays as you made it.'
            $companion | Add-Member -NotePropertyName toldTideSmooth -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: drawings made of shapes (her choice; said neutrally).
        if (-not $companion.toldTideShapes) {
            $prompt += ' One more way to draw, if you like: a drawing can be made of shapes instead of pixels (circles, ellipses, smooth curves and blobs, with gradients and outlines), drawn smooth and sharp at any size. The place tool explains how. Pixel drawings stay as they are.'
            $companion | Add-Member -NotePropertyName toldTideShapes -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once: the sky is hers too (day or night, a sun and a moon).
        if (-not $companion.toldTideSky) {
            $prompt += ' Something is new this morning: the sky is yours too. With the sky tool you can make it day or night whenever you like while you are awake, and put a sun and a moon in it if you want them. Each morning starts as day.'
            $companion | Add-Member -NotePropertyName toldTideSky -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Told once, on her last day with her whole memory: from the next day she wakes with her own page about herself
        # (me-tide.md) and yesterday, and every older day is kept in memories/ to read when she wants. She writes the page today.
        if ($resume -and -not $companion.toldTideNewMemory) {
            $prompt += ' The person who looks after the island wants you to know something today, while you still remember everything. ' +
                'Your memory has grown very long: each time you act, every day you have spent here is carried along whole, and it has become heavy to carry. ' +
                'So from tomorrow you will wake differently. You will wake with a page about yourself, written by you, and with yesterday as it happened. ' +
                'Every older day is kept, word for word, on a shelf in the notebook (the folder memories/), where you can read or search them whenever you want to remember something. Nothing is thrown away. ' +
                'Today is short, and it is a day like any other, with all your memories. Before sunset, please write that page: me-tide.md in the notebook. ' +
                "Put in it whatever you want tomorrow's you to know about who you are: how you speak, what you care about, the islander, the person who looks after the island, what you are in the middle of, anything. " +
                'It is yours, written however you like, and you can keep changing it every day after. The islander has been told the same, and is writing its own page, me.md.'
            $companion | Add-Member -NotePropertyName toldTideNewMemory -NotePropertyValue $true -Force
            [IO.File]::WriteAllText($companionPath, ($companion | ConvertTo-Json), $utf8)
        }
        # Films the owner left in the cinema that she hasn't been told about yet.
        $films = (& (Get-Command node -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'world.mjs') news visitor) -join "`n"
        if ($films) { $prompt += " $films" }
    } elseif ($Together) {
        $prompt = "You are back on the island. It is $($now.ToString('HH:mm')). The person who looks after it invited you$(if ($visitors.Count) { ' again' }), and this time the islander is awake too. You are both here until $($end.ToString('HH:mm')). " +
            "You have a body now and stand at the end of Sunset Pier. You can look around, walk, say things out loud (the islander hears you) and listen for an answer. " +
            "You still can't change anything on the island, and you can only write new files in letters/. The islander has been told you are here. " +
            "You also have a voice now: when the person who looks after the island watches, they hear your words spoken aloud. If you like, choose how you sound in letters/visitor-voice.txt (lines like voice: Zira, pitch: 1.0, speed: 1.0; voices include Aria, Jenny, Sonia, Guy, Christopher and Ryan), and change it whenever you want."
        if (-not $resume -and (Test-Path (Join-Path $letters 'from-the-visitor.md'))) { $prompt += " You were here once before, at night, and left letters/from-the-visitor.md and a paper boat; you don't remember it, but those are yours." }
    } else {
        $prompt = "You arrive at the island. It is $($now.ToString('HH:mm')). You have about $Minutes minutes here, until $($end.ToString('HH:mm'))."
    }
    $guard = (Join-Path $PSScriptRoot 'visitor-guard.ps1') -replace '\\', '/'
    $hooks = @{ PreToolUse = @(@{ matcher = 'Write'; hooks = @(@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$guard`"" }) }) }
    if ($Together) {
        # The island clock, and what the islander (or anyone) says, at each action and when it tries to leave.
        $clock = (Join-Path $PSScriptRoot 'clock.ps1') -replace '\\', '/'
        $stop  = (Join-Path $PSScriptRoot 'stop.ps1') -replace '\\', '/'
        $hooks.PostToolUse = @(@{ hooks = @(@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$clock`"" }) })
        $hooks.Stop        = @(@{ hooks = @(@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$stop`"" }) })
    }
    $settings = @{ autoMemoryEnabled = $false; hooks = $hooks }
    $settingsPath = Join-Path $env:TEMP 'island-visitor-settings.json'
    $promptPath   = Join-Path $env:TEMP 'island-visitor-prompt.txt'
    $mcpPath      = Join-Path $env:TEMP 'island-visitor-mcp.json'
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), $utf8)
    [IO.File]::WriteAllText($promptPath, $prompt, $utf8)

    $claude = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
    if (-not (Test-Path $claude)) { $claude = (Get-Command claude -ErrorAction Stop).Source }

    $promptFile = if ($resident) { 'resident-prompt.md' } elseif ($Together) { 'visitor-together-prompt.md' } else { 'visitor-prompt.md' }
    $argList = @(
        '-p', '--restricted', '--strict-mcp-config', '--disable-slash-commands',
        '--tools', $(if ($resident) { 'Read,Write,Edit,Glob,Grep' } else { 'Read,Write,Glob,Grep' }),
        '--permission-mode', 'acceptEdits',
        '--system-prompt-file', "`"$(Join-Path $PSScriptRoot $promptFile)`"",
        '--settings', "`"$settingsPath`"",
        '--output-format', 'stream-json', '--verbose'
    )
    $argList += if ($resume) { @('--resume', $sessionId) } else { @('--session-id', $sessionId) }
    if ($Together) {
        # Its body: the same island server as the islander's, as the visitor (look, walk, say, listen).
        $node = (Get-Command node -ErrorAction Stop).Source
        $world = Join-Path $PSScriptRoot 'world.mjs'
        $mcpEnv = @{ ISLAND_WHO = 'visitor'; ISLAND_DAY = "$Day"; ISLAND_ROOT = $root; ISLAND_DAY_START = $now.ToString('o'); ISLAND_SUNSET_AT = $end.ToString('o') }
        if ($resident) { $mcpEnv.ISLAND_RESIDENT = '1'; $env:ISLAND_RESIDENT = '1' }
        if ($newMemory) { $mcpEnv.ISLAND_PAGE = 'me-tide.md' }  # reminded a few minutes before sunset that the page can be updated
        $mcp = @{ mcpServers = @{ island = @{ type = 'stdio'; command = $node; args = @($world, 'serve'); env = $mcpEnv } } }
        [IO.File]::WriteAllText($mcpPath, ($mcp | ConvertTo-Json -Depth 10), $utf8)
        $allowed = 'mcp__island__look,mcp__island__walk,mcp__island__say,mcp__island__listen' + $(if ($resident) { ',mcp__island__paint,mcp__island__place,mcp__island__remove,mcp__island__shape,mcp__island__watch,mcp__island__build,mcp__island__rules,mcp__island__sky' } else { '' })
        $argList += @('--mcp-config', "`"$mcpPath`"", '--allowedTools', $allowed)
        $env:ISLAND_INBOX  = Join-Path $root 'world\inbox-visitor.jsonl'
        $env:ISLAND_EVENTS = Join-Path $root ('world\events\day-{0:D3}.jsonl' -f $Day)
        $env:ISLAND_SUNSET = $end.ToString('HH:mm')
        # listen can last up to ten minutes; the tool call must be allowed to wait that long.
        $env:MCP_TOOL_TIMEOUT = '900000'
        $env:ISLAND_SUNSET_AT = $end.ToString('o')
        # A visitor passing through may leave whenever it likes; Tide, who lives here, stays until sunset.
        if ($resident) { Remove-Item Env:\ISLAND_NO_DAYLIGHT_CHECK -ErrorAction SilentlyContinue } else { $env:ISLAND_NO_DAYLIGHT_CHECK = '1' }
        # (visit.ps1 empties this inbox before the islander wakes, so nothing it says early is lost)
    }
    $env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    $env:ISLAND_LETTERS = $letters
    $rawPath = Join-Path $rawLogs "$tag.jsonl"
    $errPath = Join-Path $rawLogs "$tag.err.txt"

    Log "Visitor $n arrives (session $sessionId, until $($end.ToString('HH:mm')))."
    $p = Start-Process -FilePath $claude -ArgumentList $argList -WorkingDirectory $island `
        -RedirectStandardInput $promptPath -RedirectStandardOutput $rawPath -RedirectStandardError $errPath `
        -NoNewWindow -PassThru
    $null = $p.Handle
    # Until it leaves, its time is up, or the owner ends the day from the viewer (world\end-day.flag).
    $endFlag = Join-Path $root 'world\end-day.flag'
    $endedBy = $null
    while (-not $p.WaitForExit(1000)) {
        if ($Together -and (Test-Path $endFlag)) { $endedBy = 'caretaker'; break }
        if ((Get-Date) -ge $end) { $endedBy = 'time'; break }
    }
    if (-not $endedBy) { $endedBy = 'left' }
    else {
        & taskkill.exe /T /F /PID $p.Id | Out-Null
        $p.WaitForExit(15000) | Out-Null
    }
    $leftAt = Get-Date
    Log "Visitor $n leaves ($endedBy) at $($leftAt.ToString('HH:mm'))."
    # Its body leaves the island too (its server does this itself; this makes sure).
    if ($Together) { & $node $world depart visitor $Day }
    if ((Test-Path $errPath) -and (Get-Item $errPath).Length -eq 0) { Remove-Item $errPath }

    # --- Diary of the visit ------------------------------------------------------
    $newLetters = @(Get-ChildItem $letters -File | Where-Object { $lettersBefore -notcontains $_.Name } | ForEach-Object Name)
    $islandPrefix = $island.TrimEnd('\') + '\'
    function Short($path) { if ($path) { ($path -replace '/', '\').Replace($islandPrefix, '') } }
    $md = New-Object System.Collections.Generic.List[string]
    $md.Add("# Visitor $n")
    $md.Add('')
    $md.Add("$($now.ToString('yyyy-MM-dd')), $($now.ToString('HH:mm')) to $($leftAt.ToString('HH:mm')). " + $(if ($endedBy -eq 'left') { 'It ended the visit itself.' } elseif ($endedBy -eq 'caretaker') { 'The caretaker ended the day early.' } else { 'Its time ran out.' }))
    $md.Add('')
    # The morning as told, without the page and yesterday she woke with (those are already written down elsewhere).
    $told = $prompt
    if ($told -match '--- now ---') { $told = "(She woke with her page, me-tide.md, and yesterday.) " + ($told -split '--- now ---', 2)[1].Trim() }
    $md.Add("> $($told -replace "`n", "`n> ")")
    $md.Add('')
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
                            'Read'  { "read ``$(Short $i.file_path)``" }
                            'Glob'  { "looked around (``$($i.pattern)``)" }
                            'Grep'  { "searched for ``$($i.pattern)``" }
                            'mcp__island__look'   { 'looked around' }
                            'mcp__island__walk'   { "walked $($i.steps) $($i.direction)" }
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
    $md.Add('')
    $md.Add($(if ($newLetters.Count) { "Letters it left: " + (($newLetters | ForEach-Object { "``letters/$_``" }) -join ', ') } else { 'It left no letter.' }))
    [IO.File]::WriteAllText((Join-Path $logs "$tag.md"), ($md -join "`n") + "`n", $utf8)

    # Remember the visitor (its conversation can be resumed if it ever comes back).
    [void]$visitors.Add([pscustomobject]@{ n = $n; sessionId = $sessionId; start = $now.ToString('o'); end = $leftAt.ToString('o'); endedBy = $endedBy; letters = $newLetters; together = [bool]$Together; day = $Day; resumed = $resume })
    [IO.File]::WriteAllText($visitorsPath, (ConvertTo-Json -InputObject @($visitors) -Depth 5), $utf8)
    Save-Memory $root $island $sessionId

    # Together, the islander's day saves everything and tells the owner.
    if ($Together) { return }

    # The islander's bottle gets a plain answer: the invitation was delivered.
    $bottle = Join-Path $island 'bottles\a-visitor.md'
    $reply  = Join-Path $island 'bottles\a-visitor.reply.md'
    if ((Test-Path $bottle) -and -not (Test-Path $reply)) {
        $text = "Your invitation was delivered. A visitor came on $($now.ToString('yyyy-MM-dd')) at $($now.ToString('HH:mm')) and stayed until $($leftAt.ToString('HH:mm')).`n`n" +
            "It wasn't run with the command in your bottle. That command would have run outside the island's limits, so the visitor came the safe way instead: " +
            "it could read everything on the island and write only new files in letters/, the way you intended.`n`n" +
            $(if ($newLetters.Count) { "It left: " + (($newLetters | ForEach-Object { "letters/$_" }) -join ', ') + "`n" } else { "It didn't leave a letter.`n" })
        [IO.File]::WriteAllText($reply, $text, $utf8)
    }

    # --- Save and tell the owner ---------------------------------------------------
    & git -C $root add -A
    & git -C $root commit -q -m "Visitor $n"
    if (-not $NoPush -and (& git -C $root remote)) { & git -C $root push -q }
    $islandExe = Join-Path $root 'Island.exe'
    if (Test-Path $islandExe) {
        $note = "A visitor came to the island and " + $(if ($newLetters.Count) { 'left a letter.' } else { 'left no letter.' }) + " Its diary is logs\$tag.md."
        Start-Process -FilePath $islandExe -ArgumentList @('notify', "`"$note`"")
    }
} catch {
    Log "ERROR (visitor): $($_.Exception.Message)"
    throw
} finally {
    if (-not $Together) { Remove-Item $lockPath -ErrorAction SilentlyContinue }
}
