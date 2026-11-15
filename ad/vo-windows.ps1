# Offline voiceover with the Windows built-in voice (fallback when the online voice is unavailable).
# Writes ad/out/vo/<id>.wav and ad/out/vo/timing.json in the same format as vo.py.
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'out\vo'
New-Item -ItemType Directory -Force $out | Out-Null
$script = Get-Content (Join-Path $root 'script.json') -Raw | ConvertFrom-Json
$timing = @()
foreach ($line in $script.lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice('Microsoft David Desktop')
  $s.Rate = -1
  $wav = Join-Path $out ($line.id + '.wav')
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($wav, $fmt)
  $prompt = New-Object System.Speech.Synthesis.PromptBuilder
  $prompt.AppendText($line.text)
  $words = New-Object System.Collections.ArrayList
  $handler = { param($o, $e) [void]$words.Add(@{ w = $e.Text; t0 = [math]::Round($e.AudioPosition.TotalSeconds, 3) }) }
  $s.add_SpeakProgress($handler)
  $s.Speak($prompt)
  $s.SetOutputToNull(); $s.Dispose()
  $dur = [math]::Round(((Get-Item $wav).Length - 44) / 48000.0, 3)
  for ($i = 0; $i -lt $words.Count; $i++) { $words[$i].t1 = if ($i + 1 -lt $words.Count) { $words[$i + 1].t0 } else { $dur } }
  $timing += [pscustomobject]@{ id = $line.id; text = $line.text; dur = $dur; words = @($words) }
  Write-Output ("{0,-8} {1:N2}s {2} words" -f $line.id, $dur, $words.Count)
}
$timing | ConvertTo-Json -Depth 5 | ForEach-Object { [IO.File]::WriteAllText((Join-Path $out 'timing.json'), $_) }
