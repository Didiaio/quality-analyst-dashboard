# Merge multiple CSV/Excel data files into a single dashboard dataset.
# This script scans the PowerBI_Data folder for all supported source files,
# normalizes the data structure, and writes the final output to data.js.

$workingDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDirectory = Join-Path $workingDir "PowerBI_Data"
$dataJsPath = Join-Path $workingDir "data.js"
$auditLogPath = Join-Path $workingDir "data-merge-log.json"

if (-not (Test-Path $sourceDirectory)) {
    New-Item -ItemType Directory -Path $sourceDirectory -Force | Out-Null
    Write-Warning "Source directory did not exist. Created: $sourceDirectory"
}

function Get-DefaultMetricFromFile {
    param(
        [string]$FileName
    )

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    if ([string]::IsNullOrWhiteSpace($baseName)) {
        return "Uncategorized"
    }

    $cleanName = $baseName -replace '_', ' ' -replace '-', ' '
    $cleanName = ($cleanName -split '\s+' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ' '

    if (-not [string]::IsNullOrWhiteSpace($cleanName)) {
        return $cleanName
    }

    return "Uncategorized"
}

function Get-FieldValue {
    param(
        [psobject]$Row,
        [string[]]$Aliases
    )

    foreach ($alias in $Aliases) {
        $match = $Row.PSObject.Properties | Where-Object { $_.Name -ieq $alias }
        if ($match) {
            return $Row.($match.Name)
        }
    }

    return $null
}

function Convert-ExcelWorkbookToRecords {
    param(
        [string]$FilePath
    )

    if (-not (Test-Path $FilePath)) {
        return @()
    }

    $excel = $null
    $workbook = $null
    $records = @()

    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $workbook = $excel.Workbooks.Open($FilePath)

        foreach ($sheet in $workbook.Worksheets) {
            $usedRange = $sheet.UsedRange
            if (-not $usedRange) { continue }

            $values = $usedRange.Value2
            if (-not $values) { continue }

            $rowCount = $values.GetLength(0)
            $colCount = $values.GetLength(1)

            if ($rowCount -lt 2) { continue }

            $headers = @()
            for ($col = 1; $col -le $colCount; $col++) {
                $header = $values[1, $col]
                $headers += if ($null -ne $header) { [string]$header } else { "Column$col" }
            }

            for ($row = 2; $row -le $rowCount; $row++) {
                $rowObject = [ordered]@{}
                $hasData = $false

                for ($col = 1; $col -le $colCount; $col++) {
                    $value = $values[$row, $col]
                    if ($null -ne $value) {
                        $hasData = $true
                    }
                    $rowObject[$headers[$col - 1]] = $value
                }

                if ($hasData) {
                    $records += [pscustomobject]$rowObject
                }
            }
        }
    }
    catch {
        Write-Warning "Failed to read Excel file '$FilePath': $($_.Exception.Message)"
        $records = @()
    }
    finally {
        if ($workbook) {
            try { $workbook.Close($false) } catch {}
        }

        if ($excel) {
            try { $excel.Quit() } catch {}
            try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}
        }
    }

    return $records
}

function Normalize-Record {
    param(
        [psobject]$Row,
        [string]$SourceName
    )

    $defaultMetric = Get-DefaultMetricFromFile -FileName $SourceName

    $rawId = Get-FieldValue -Row $Row -Aliases @('ID', 'Audit ID', 'Record ID', 'Case ID', 'Request ID', 'Item ID', 'InteractionID', 'Interaction ID')
    $rawDate = Get-FieldValue -Row $Row -Aliases @('Date', 'Audit Date', 'Review Date', 'Created Date', 'Date Created', 'Reviewed Date')
    $rawMetric = Get-FieldValue -Row $Row -Aliases @('Metric', 'KPI', 'KPI Name', 'Category', 'Area', 'Metric Name')
    $rawTeam = Get-FieldValue -Row $Row -Aliases @('Team', 'Department', 'Group', 'Business Unit', 'Audit Team', 'TeamName')
    $rawBrand = Get-FieldValue -Row $Row -Aliases @('Brand', 'Product', 'Customer Brand', 'Portfolio')
    $rawTeamLeader = Get-FieldValue -Row $Row -Aliases @('TeamLeader', 'Team Leader', 'Manager', 'Line Manager')
    $rawAnalyst = Get-FieldValue -Row $Row -Aliases @('Analyst', 'Owner', 'Reviewer', 'QA Analyst', 'Assessor', 'Assigned To', 'Agent', 'TeamMember', 'Agent Name')
    $rawScore = Get-FieldValue -Row $Row -Aliases @('Score', 'Quality Score', 'Pass Rate', 'Average Score', 'Result', 'Metric Score', 'ActualScore', 'Actual Score')
    $rawTarget = Get-FieldValue -Row $Row -Aliases @('Target', 'Target Score', 'Benchmark', 'Target %', 'Required Score', 'TargetScore', 'TargetScore %')
    $rawReason = Get-FieldValue -Row $Row -Aliases @('Markdown Reason', 'Issue', 'Reason', 'Root Cause', 'Finding', 'Comment', 'Notes', 'RootCause')
    $rawSeverity = Get-FieldValue -Row $Row -Aliases @('Severity', 'Priority', 'Risk Level', 'ImpactRating', 'Impact Rating')
    $rawAction = Get-FieldValue -Row $Row -Aliases @('Action', 'Recommended Action', 'Action Plan', 'Remediation', 'Next Step', 'Recommended Action Plan')

    if ($null -eq $rawMetric -or [string]::IsNullOrWhiteSpace([string]$rawMetric)) {
        $rawMetric = $defaultMetric
    }

    $scoreValue = 0
    if ($null -ne $rawScore) {
        try { $scoreValue = [double]$rawScore } catch { $scoreValue = 0 }
    }

    $targetValue = 95.0
    if ($null -ne $rawTarget) {
        try { $targetValue = [double]$rawTarget } catch { $targetValue = 95.0 }
    }

    $normalized = [ordered]@{
        id = if ($null -ne $rawId -and -not [string]::IsNullOrWhiteSpace([string]$rawId)) { [string]$rawId } else { "QA-$([guid]::NewGuid().ToString('N').Substring(0,8))" }
        date = if ($null -ne $rawDate -and -not [string]::IsNullOrWhiteSpace([string]$rawDate)) { [string]$rawDate } else { (Get-Date).ToString('yyyy-MM-dd') }
        metric = [string]$rawMetric
        team = if ($null -ne $rawTeam -and -not [string]::IsNullOrWhiteSpace([string]$rawTeam)) { [string]$rawTeam } else { 'Unassigned' }
        brand = if ($null -ne $rawBrand -and -not [string]::IsNullOrWhiteSpace([string]$rawBrand)) { [string]$rawBrand } else { 'Customer Service' }
        teamLeader = if ($null -ne $rawTeamLeader -and -not [string]::IsNullOrWhiteSpace([string]$rawTeamLeader)) { [string]$rawTeamLeader } else { 'Operations Team' }
        analyst = if ($null -ne $rawAnalyst -and -not [string]::IsNullOrWhiteSpace([string]$rawAnalyst)) { [string]$rawAnalyst } else { 'Unassigned' }
        score = $scoreValue
        target = $targetValue
        markdownReason = if ($null -ne $rawReason -and -not [string]::IsNullOrWhiteSpace([string]$rawReason)) { [string]$rawReason } else { 'None' }
        severity = if ($null -ne $rawSeverity -and -not [string]::IsNullOrWhiteSpace([string]$rawSeverity)) { [string]$rawSeverity } else { 'Low' }
        action = if ($null -ne $rawAction -and -not [string]::IsNullOrWhiteSpace([string]$rawAction)) { [string]$rawAction } else { 'Review required' }
    }

    return [pscustomobject]$normalized
}

$allFiles = Get-ChildItem -Path $sourceDirectory -File | Where-Object {
    $_.Extension -in '.csv', '.xlsx', '.xls'
} | Sort-Object Name

$combinedData = @()
$fileAudit = @()

if ($allFiles.Count -eq 0) {
    Write-Warning "No CSV or Excel files found in '$sourceDirectory'. Creating empty dashboard dataset."
}
else {
    foreach ($file in $allFiles) {
        $records = @()
        $fileMetricName = Get-DefaultMetricFromFile -FileName $file.Name

        switch ($file.Extension.ToLowerInvariant()) {
            '.csv' {
                try {
                    $records = Import-Csv -Path $file.FullName
                }
                catch {
                    Write-Warning "Could not import CSV file '$($file.FullName)': $($_.Exception.Message)"
                }
            }
            '.xlsx' {
                $records = Convert-ExcelWorkbookToRecords -FilePath $file.FullName
            }
            '.xls' {
                $records = Convert-ExcelWorkbookToRecords -FilePath $file.FullName
            }
        }

        if ($null -ne $records -and $records.Count -gt 0) {
            $processedCount = 0

            foreach ($record in $records) {
                $normalizedRecord = Normalize-Record -Row $record -SourceName $file.Name
                if ($normalizedRecord.metric -eq $fileMetricName -or [string]::IsNullOrWhiteSpace((Get-FieldValue -Row $record -Aliases @('Metric', 'KPI', 'KPI Name', 'Category', 'Area', 'Metric Name')))) {
                    $normalizedRecord.metric = $fileMetricName
                }

                $combinedData += $normalizedRecord
                $processedCount++
            }

            $fileAudit += [pscustomobject]@{
                fileName = $file.Name
                fileType = $file.Extension.ToLowerInvariant()
                rowsProcessed = $processedCount
                inferredMetric = $fileMetricName
                generatedAt = (Get-Date).ToString('o')
            }

            Write-Host "Processing $processedCount rows from $($file.Name) into KPI '$fileMetricName'" -ForegroundColor Cyan
        }
        else {
            $fileAudit += [pscustomobject]@{
                fileName = $file.Name
                fileType = $file.Extension.ToLowerInvariant()
                rowsProcessed = 0
                inferredMetric = $fileMetricName
                generatedAt = (Get-Date).ToString('o')
            }

            Write-Warning "No rows were returned from $($file.Name)"
        }
    }
}

$combinedData = @($combinedData | Sort-Object @{Expression = { $_.date }; Descending = $true })

if ($combinedData.Count -eq 0) {
    $jsonData = "[]"
}
else {
    $jsonData = $combinedData | ConvertTo-Json -Depth 6 -Compress
}

$jsContent = "window.dashboardData = $jsonData;"
Set-Content -Path $dataJsPath -Value $jsContent -Encoding UTF8

$auditSummary = [pscustomobject]@{
    generatedAt = (Get-Date).ToString('o')
    totalRecords = $combinedData.Count
    sourceDirectory = $sourceDirectory
    filesProcessed = $fileAudit.Count
    fileBreakdown = $fileAudit
}

Set-Content -Path $auditLogPath -Value ($auditSummary | ConvertTo-Json -Depth 5) -Encoding UTF8

Write-Host "Successfully generated $dataJsPath with $($combinedData.Count) records." -ForegroundColor Green
Write-Host "Merge audit summary saved to $auditLogPath" -ForegroundColor Green
