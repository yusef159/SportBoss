param([Parameter(Mandatory)][string]$Workbook)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem, System.Drawing
$root = Split-Path $PSScriptRoot
$images = Join-Path $root 'public/exercises'
New-Item -ItemType Directory -Force $images | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Workbook))
function Read-Xml([string]$Part) {
    $reader = [IO.StreamReader]::new($archive.GetEntry($Part).Open())
    try { [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Save-Photo($entry, $file) {
    $stream = [IO.MemoryStream]::new()
    $source = $entry.Open()
    try { $source.CopyTo($stream) } finally { $source.Dispose() }
    $stream.Position = 0
    $image = [Drawing.Image]::FromStream($stream)
    try {
        $ratio = [Math]::Min(1.0, 720.0 / [Math]::Max($image.Width, $image.Height))
        $bitmap = [Drawing.Bitmap]::new([Math]::Max(1,[int]($image.Width*$ratio)), [Math]::Max(1,[int]($image.Height*$ratio)))
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.InterpolationMode = 'HighQualityBicubic'
            $graphics.DrawImage($image, 0, 0, $bitmap.Width, $bitmap.Height)
            $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Jpeg)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } finally { $image.Dispose(); $stream.Dispose() }
}
try {
    $strings = @((Read-Xml 'xl/sharedStrings.xml').sst.si | ForEach-Object {
        ($_.SelectNodes(".//*[local-name()='t']") | ForEach-Object InnerText) -join ''
    })
    $metadata = Read-Xml 'xl/metadata.xml'
    $valueMap = @($metadata.metadata.valueMetadata.bk)
    $future = @($metadata.metadata.futureMetadata | Where-Object name -eq XLRICHVALUE)
    $values = @((Read-Xml 'xl/richData/rdrichvalue.xml').rvData.rv)
    $links = @((Read-Xml 'xl/richData/richValueRel.xml').richValueRels.rel)
    $targets = @{}
    (Read-Xml 'xl/richData/_rels/richValueRel.xml.rels').Relationships.Relationship | ForEach-Object { $targets[$_.Id] = $_.Target }
    $rows = foreach ($row in (Read-Xml 'xl/worksheets/sheet1.xml').worksheet.sheetData.row) {
        if ([int]$row.r -le 1) { continue }
        $nameCell = $row.c | Where-Object { $_.r -match '^A[0-9]+$' }
        if (!$nameCell) { continue }
        $name = if ($nameCell.t -eq 's') { $strings[[int]$nameCell.v] } else { $nameCell.is.t }
        if (!$name) { continue }
        $id = $name.ToLowerInvariant() -replace '[^a-z0-9]+','-' -replace '-$',''
        $photo = $row.c | Where-Object { $_.r -match '^B[0-9]+$' }
        $path = $null
        if ($photo.vm) {
            $futureIndex = [int]$valueMap[([int]$photo.vm - 1)].rc.v
            $richIndex = [int]$future.bk[$futureIndex].SelectSingleNode(".//*[local-name()='rvb']").GetAttribute('i')
            $linkIndex = [int]$values[$richIndex].v[0]
            $linkId = $links[$linkIndex].GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
            $target = $targets[$linkId]
            if ($target -notmatch '^\.\./media/[^/]+\.(png|jpg|jpeg)$') { throw "Unsupported embedded image for $name" }
            $entry = $archive.GetEntry('xl/' + $target.Substring(3))
            Save-Photo $entry (Join-Path $images "$id.jpg")
            $path = "/exercises/$id.jpg"
        }
        [ordered]@{ id=$id; name=$name; image=$path }
    }
    if (@($rows).Count -eq 0) { throw 'No exercise rows were found.' }
    if (@($rows.id | Sort-Object -Unique).Count -ne @($rows).Count) { throw 'Duplicate exercise identifiers.' }
    $json = ConvertTo-Json -InputObject @($rows) -Depth 3
    [IO.File]::WriteAllText((Join-Path $root 'catalog.json'), $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Write-Output "Imported $(@($rows).Count) exercises with $(@($rows | Where-Object image).Count) images."
} finally { $archive.Dispose() }
