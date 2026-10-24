# Hook run before the visitor writes a file: it may only write new files inside letters\, plus its own
# voice file letters\visitor-voice.txt, which it may change whenever it likes.
# (--restricted already keeps it inside the island folder; this narrows it further.)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
# Tide lives here now: like the islander, she may write anywhere in the island folder.
if ($env:ISLAND_RESIDENT) { exit 0 }
$letters = [IO.Path]::GetFullPath($env:ISLAND_LETTERS).TrimEnd('\') + '\'
$full = ''
try { $full = [IO.Path]::GetFullPath([string]$in.tool_input.file_path) } catch { }
$inLetters = $full -and $full.StartsWith($letters, [StringComparison]::OrdinalIgnoreCase)
$voiceFile = $full -and ($full -ieq ($letters + 'visitor-voice.txt'))
if ($voiceFile -or ($inLetters -and -not (Test-Path -LiteralPath $full))) { exit 0 }
@{ hookSpecificOutput = @{
    hookEventName = 'PreToolUse'; permissionDecision = 'deny'
    permissionDecisionReason = 'You can only write new files inside letters/ (not change existing ones), and your voice file letters/visitor-voice.txt.'
} } | ConvertTo-Json -Compress -Depth 5
