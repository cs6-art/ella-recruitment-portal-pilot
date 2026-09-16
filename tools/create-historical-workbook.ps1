# Generates the import-ready six-month workbook from retained exports plus
# clearly marked synthetic records. It never overwrites an existing workbook.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$sourceCall = @(Import-Csv "docs/HR Resume Screening - Call_Logs.csv")
$sourceProfile = @(Import-Csv "docs/HR Resume Screening - High_Match_Profile.csv")
$callHeaders = @($sourceCall[0].PSObject.Properties.Name)
$profileHeaders = @($sourceProfile[0].PSObject.Properties.Name)
$outputDir = Join-Path (Get-Location) "docs/historical-data"
$outputPath = Join-Path $outputDir "HR Resume Screening - 6 Month Import.xlsx"
if (Test-Path -LiteralPath $outputPath) { throw "Output already exists: $outputPath" }
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$random = [System.Random]::new(260817)
$names = @("Amelia Santos", "Brandon Lim", "Carla Mendoza", "Darren Cruz", "Elise Tan", "Fiona Reyes", "Gabriel Ong", "Hannah Villanueva", "Ivan Chua", "Jasmine Flores", "Kenji Ramos", "Leah Navarro", "Marco Dela Cruz", "Nina Bautista", "Owen Yap", "Patricia Go", "Quinn Mercado", "Rafael Tan", "Sofia Garcia", "Theo Lim", "Uma Santos", "Victor Choi", "Wendy Ramos", "Xavier Flores", "Yasmin Ong", "Zachary Cruz", "Bianca Lee", "Caleb Tan", "Diana Reyes", "Ethan Garcia")
$roles = @(
  @{ Name = "Junior Web Developer"; Question = "How have you built and maintained a production website?"; Skills = "HTML, CSS, JavaScript, troubleshooting, and SAP B1 eCommerce integration." },
  @{ Name = "Senior AI Engineer"; Question = "Describe a production LLM or RAG system you designed."; Skills = "LLM architecture, RAG, vector databases, Python, and API development." },
  @{ Name = "SAP Business One Functional Consultant"; Question = "Describe an SAP Business One implementation using ASAP methodology."; Skills = "SAP B1, SQL, HANA, business analysis, and end-user training." },
  @{ Name = "HR Generalist"; Question = "Describe a challenging employee-relations case you handled."; Skills = "Recruitment, employee relations, compliance, and HR operations." },
  @{ Name = "AI Operations Coordinator"; Question = "Describe a workflow automation project and its measurable impact."; Skills = "Automation, n8n, process design, documentation, and stakeholder support." },
  @{ Name = "Digital Marketing Specialist"; Question = "How have you improved campaign performance using analytics?"; Skills = "Campaign planning, content, paid media, SEO, and reporting." }
)
$months = @("2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01") | ForEach-Object { Get-Date $_ }
$syntheticProfiles = @()
$syntheticCalls = @()
$profileIndex = 0

foreach ($monthStart in $months) {
  $lastDay = [DateTime]::DaysInMonth($monthStart.Year, $monthStart.Month)
  if ($monthStart.Month -eq 8) { $lastDay = 17 }
  for ($j = 1; $j -le 15; $j++) {
    $profileIndex++
    $role = $roles[($profileIndex - 1) % $roles.Count]
    $name = $names[($profileIndex - 1) % $names.Count]
    $day = $random.Next(1, $lastDay + 1)
    $date = Get-Date -Year $monthStart.Year -Month $monthStart.Month -Day $day -Hour ($random.Next(8, 18)) -Minute ($random.Next(0, 60)) -Second 0
    $id = "APP-SYN-$($date.ToString("yyyyMM"))-$($profileIndex.ToString("0000"))"
    $email = "synthetic.$($profileIndex.ToString("0000"))@example.invalid"
    $phone = "+63917$($random.Next(1000000, 9999999))"
    $score = $random.Next(58, 96)
    if ($score -ge 82) {
      $recommendation = "Strongly recommend for an interview due to relevant experience and skills fit."
      $resumeStatus = "Processed"; $voiceStatus = "Interviewed"; $finalStatus = if ($profileIndex % 4 -eq 0) { "Interview Scheduled" } else { "" }
    } elseif ($score -ge 70) {
      $recommendation = "Recommend for recruiter review based on transferable skills and role alignment."
      $resumeStatus = "Processed"; $voiceStatus = if ($profileIndex % 3 -eq 0) { "Interviewed" } else { "" }; $finalStatus = ""
    } else {
      $recommendation = "Manual review recommended before progressing the candidate."
      $resumeStatus = if ($profileIndex % 5 -eq 0) { "Rejected" } else { "Processed" }; $voiceStatus = ""; $finalStatus = ""
    }

    $profile = [ordered]@{}
    foreach ($header in $profileHeaders) { $profile[$header] = "" }
    $profile["Date of Application"] = $date.ToString("yyyy-MM-dd hh:mm tt")
    $profile["Application ID"] = $id
    $profile["Candidate Name"] = $name
    $profile["Email"] = $email
    $profile["Contact Number"] = $phone
    $profile["Selected Role"] = $role.Name
    $profile["Match Score"] = "$score%"
    $profile["Recommendation"] = $recommendation
    $profile["AI Analysis Summary"] = "$name demonstrates a realistic synthetic match profile for $($role.Name), with evidence related to $($role.Skills)"
    $profile["Interview Questions"] = "1. $($role.Question)`n2. What is one measurable result from your recent work?`n3. How do you troubleshoot when a project does not perform as expected?"
    $profile["Resume/CV"] = "Synthetic historical record; no resume file attached."
    $profile["voice_interview_email_sent"] = if ($voiceStatus) { "TRUE" } else { "" }
    $profile["rejection_email_sent"] = if ($resumeStatus -eq "Rejected") { "TRUE" } else { "" }
    $profile["rejection_email_sent_time"] = if ($resumeStatus -eq "Rejected") { $date.AddHours(2).ToString("yyyy-MM-ddTHH:mm:ssZ") } else { "" }
    $profile["final_interview_reschedule_sent"] = ""
    $profile["Status (Resume Processing)"] = $resumeStatus
    $profile["Status 2 (Voice Interview)"] = $voiceStatus
    $profile["Status 3 (Final Interview)"] = $finalStatus
    $syntheticProfiles += [pscustomobject]$profile

    $callDate = $date.AddHours($random.Next(1, 96))
    $outcomes = @("customer-ended-call", "customer-ended-call", "customer-busy", "no-answer", "customer-ended-call")
    $outcome = $outcomes[($profileIndex + $random.Next(0, $outcomes.Count)) % $outcomes.Count]
    if ($outcome -eq "customer-ended-call" -and $score -ge 72) {
      $callStatus = "Interview_Scheduled"; $appointment = $callDate.AddDays(1).ToString("yyyy-MM-dd HH:mm"); $callbackSent = ""; $callbackScheduled = ""; $attempts = ""; $booked = "FALSE"
    } elseif ($outcome -eq "customer-busy" -or $outcome -eq "no-answer") {
      $callStatus = "Call Back"; $appointment = ""; $callbackSent = "TRUE"; $callbackScheduled = "TRUE"; $attempts = "1"; $booked = "FALSE"
    } else {
      $callStatus = "Completed"; $appointment = ""; $callbackSent = ""; $callbackScheduled = ""; $attempts = ""; $booked = "FALSE"
    }
    $call = [ordered]@{}
    foreach ($header in $callHeaders) { $call[$header] = "" }
    $call["Date"] = $callDate.ToString("yyyy-MM-dd h:mm tt")
    $call["Application ID"] = $id
    $call["Name"] = $name
    $call["Phone"] = $phone.TrimStart("+")
    $call["Email"] = $email
    $call["Role"] = $role.Name
    $call["Match Score"] = [string]$score
    $call["Transcript"] = "SYNTHETIC CALL LOG. Smile introduced the role, confirmed candidate availability, and discussed $($role.Skills) Candidate provided concise examples and requested next-step details."
    $call["Recording_URL"] = "https://example.invalid/synthetic-call/$id"
    $call["Call Outcome"] = $outcome
    $call["Appointment Details"] = $appointment
    $call["Reschedule_Details"] = if ($callStatus -eq "Call Back") { "Synthetic callback requested after first attempt." } else { "" }
    $call["email_sent_time"] = $callDate.AddMinutes(4).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $call["parsed_datetime"] = $callDate.ToString("yyyy-MM-dd HH:mm:ss")
    $call["status"] = $callStatus
    $call["callback_email_sent"] = $callbackSent
    $call["callback_scheduled"] = $callbackScheduled
    $call["call_attempts"] = $attempts
    $call["is_fully_booked"] = $booked
    $syntheticCalls += [pscustomobject]$call
  }
}

$allProfiles = @($sourceProfile) + @($syntheticProfiles)
$allCalls = @($sourceCall) + @($syntheticCalls)

function XmlEscape([string]$value) { if ($null -eq $value) { return "" }; return [System.Security.SecurityElement]::Escape($value) }
function ColumnLetter([int]$index) { $value = $index + 1; $result = ""; while ($value -gt 0) { $remainder = ($value - 1) % 26; $result = [char](65 + $remainder) + $result; $value = [math]::Floor(($value - 1) / 26) }; return $result }
function CellXml([int]$row, [int]$column, [string]$value, [bool]$header) {
  $ref = (ColumnLetter $column) + $row
  $style = if ($header) { ' s="1"' } else { "" }
  if ([string]::IsNullOrEmpty($value)) { return '<c r="' + $ref + '"' + $style + '/>' }
  return '<c r="' + $ref + '"' + $style + ' t="inlineStr"><is><t xml:space="preserve">' + (XmlEscape $value) + '</t></is></c>'
}
function WorksheetXml($headers, $rows, [bool]$freeze) {
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  if ($freeze) { [void]$builder.Append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>') }
  [void]$builder.Append('<sheetFormatPr defaultRowHeight="15"/><sheetData><row r="1">')
  for ($column = 0; $column -lt $headers.Count; $column++) { [void]$builder.Append((CellXml 1 $column ([string]$headers[$column]) $true)) }
  [void]$builder.Append('</row>')
  $rowNumber = 2
  foreach ($item in $rows) {
    [void]$builder.Append('<row r="' + $rowNumber + '">')
    for ($column = 0; $column -lt $headers.Count; $column++) {
      $property = $item.PSObject.Properties[[string]$headers[$column]]
      $value = if ($property) { [string]$property.Value } else { "" }
      [void]$builder.Append((CellXml $rowNumber $column $value $false))
    }
    [void]$builder.Append('</row>')
    $rowNumber++
  }
  [void]$builder.Append('</sheetData></worksheet>')
  return $builder.ToString()
}
function WriteZipEntry($archive, [string]$path, [string]$content) {
  $entry = $archive.CreateEntry($path)
  $stream = $entry.Open()
  try { $bytes = [System.Text.Encoding]::UTF8.GetBytes($content); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

$readmeHeaders = @("Item", "Details")
$readmeRows = @(
  [pscustomobject]@{ Item = "Purpose"; Details = "Six-month historical import for Google Sheets: Call_Logs and High_Match_Profile." },
  [pscustomobject]@{ Item = "Date range"; Details = "March 1, 2026 through August 17, 2026." },
  [pscustomobject]@{ Item = "Source records"; Details = "$($sourceCall.Count) call-log rows and $($sourceProfile.Count) high-match rows retained from the project exports." },
  [pscustomobject]@{ Item = "Synthetic records"; Details = "$($syntheticCalls.Count) call-log rows and $($syntheticProfiles.Count) high-match rows generated for demonstration/testing." },
  [pscustomobject]@{ Item = "Synthetic identification"; Details = "Synthetic applications use APP-SYN- IDs, example.invalid emails, and example.invalid recording URLs. Do not treat them as applicant records." },
  [pscustomobject]@{ Item = "Import note"; Details = "Import the Call_Logs and High_Match_Profile worksheets into their matching Google Sheets tabs. The README sheet is documentation only." }
)

$files = [ordered]@{}
$files["[Content_Types].xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
$files["_rels/.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
$files["xl/workbook.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="README" sheetId="1" r:id="rId1"/><sheet name="High_Match_Profile" sheetId="2" r:id="rId2"/><sheet name="Call_Logs" sheetId="3" r:id="rId3"/></sheets></workbook>'
$files["xl/_rels/workbook.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
$files["xl/styles.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E4471"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'
$files["docProps/core.xml"] = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>HR Resume Screening - Six Month Historical Import</dc:title><dc:subject>Synthetic demonstration history from March through August 2026</dc:subject><dc:creator>McLink Recruitment Portal</dc:creator></cp:coreProperties>'
$files["docProps/app.xml"] = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>McLink Recruitment Portal</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop></Properties>'
$files["xl/worksheets/sheet1.xml"] = WorksheetXml $readmeHeaders $readmeRows $false
$files["xl/worksheets/sheet2.xml"] = WorksheetXml $profileHeaders $allProfiles $true
$files["xl/worksheets/sheet3.xml"] = WorksheetXml $callHeaders $allCalls $true

$archive = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Create)
try { foreach ($file in $files.GetEnumerator()) { WriteZipEntry $archive $file.Key $file.Value } } finally { $archive.Dispose() }
[pscustomobject]@{ Output = $outputPath; CallLogRows = $allCalls.Count; HighMatchRows = $allProfiles.Count; SyntheticCallRows = $syntheticCalls.Count; SyntheticHighMatchRows = $syntheticProfiles.Count; DateRange = "2026-03-01 through 2026-08-17" } | Format-List
