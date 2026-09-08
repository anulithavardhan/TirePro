param(
  [string]$At = '07:00'
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $ProjectDir 'run-daily.ps1'
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
$Trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $At
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'Tireworks GT Radial Weekday Scrape' -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Scrape GT Radial tire prices from Tireworks into a dated CSV each weekday.' -Force
Write-Host "Installed weekday task (Monday-Friday) for $At."
