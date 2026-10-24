# Hook run when the islander (or Tide) ends its turn. If the owner or the other one said something, it hears
# that first. Days last until sunset now (the owner's rule): before sunset, ending the turn doesn't end the day;
# it is told how much light is left and that it can rest by listening. If this script fails, the day just ends.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
. (Join-Path $PSScriptRoot 'voice.ps1')
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
$voices = Take-Voices
if ($voices.Count -gt 0) {
    @{ decision = 'block'; reason = (Format-Voices $voices) } | ConvertTo-Json -Compress
    exit 0
}
if ($env:ISLAND_NO_DAYLIGHT_CHECK -or -not $env:ISLAND_SUNSET_AT) { exit 0 }  # a visitor just passing through leaves when it likes
$left = ([datetime]$env:ISLAND_SUNSET_AT - (Get-Date)).TotalMinutes
if ($left -lt 0.5) { exit 0 }
$m = [int][Math]::Ceiling($left)
$reason = "The sun is still up: about $m minute$(if ($m -ne 1) { 's' }) of daylight left. Days here last until sunset, so the day isn't over yet. " +
    "Doing things takes only seconds of island time, so there is room for a lot. What you do with it is up to you: make something, explore, talk, watch, or rest " +
    "(``listen`` lets you sit quietly for up to ten minutes at a time and hear anyone who speaks)."
@{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress
