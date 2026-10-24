# Hook run after each thing the islander does: tells it the time on the island,
# and hands over anything the owner said in the live viewer.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
. (Join-Path $PSScriptRoot 'voice.ps1')
$now = Get-Date -Format 'HH:mm'
$text = "Island clock: $now. The sun sets at $env:ISLAND_SUNSET."
$voices = Take-Voices
if ($voices.Count -gt 0) { $text += "`n" + (Format-Voices $voices) }
@{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $text } } | ConvertTo-Json -Compress
