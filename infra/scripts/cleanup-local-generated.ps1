# Scoped Campus WebGIS cleanup. Preview by default; -Apply permanently removes
# reproducible outputs only. Sources, GLB/Blend assets and reports are preserved.
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$campusRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if (!(Test-Path -LiteralPath (Join-Path $campusRoot 'web/package.json')) -or !(Test-Path -LiteralPath (Join-Path $campusRoot 'output/campus_refined_v005.glb'))) {
    throw 'Cannot identify Campus WebGIS project; nothing removed.'
}
$campusRelativeTargets = @(
    'diagnostics/web_test/node_modules',
    'web/dist',
    'server/target/classes',
    'server/target/test-classes',
    'server/target/generated-sources',
    'server/target/generated-test-sources',
    'server/target/maven-status',
    'server/target/maven-archiver',
    'server/target/campus-webgis-server-0.1.0.jar',
    'server/target/campus-webgis-server-0.1.0.jar.original'
)
# Do not delete generated output that an active local server is using.
$campusActiveProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('java.exe', 'node.exe') -and $_.CommandLine -and
    ($_.CommandLine -like "*$campusRoot*" -or $_.CommandLine -like "*$($campusRoot.Replace('\','/'))*")
}
if ($campusActiveProcesses | Where-Object { $_.CommandLine -match 'server[\\/]target|diagnostics[\\/]web_test|vite preview' }) {
    throw 'A local process is using these outputs. Stop that project process first; nothing removed.'
}
$campusTargets = @($campusRelativeTargets | ForEach-Object { Join-Path $campusRoot $_ })
$campusTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$campusKeepScreenshots = @('campus-sky-public-dashboard.png', 'campus-sky-public-mobile-dashboard.png', 'campus-sky-public-immersive.png')
$campusTargets += @(Get-ChildItem -LiteralPath $campusTempRoot -File | Where-Object {
    ($_.Name -like 'campus-sky-*.png' -or $_.Name -like 'campus-phase8-*.png' -or
     $_.Name -eq 'campus-sky-source.tar.gz' -or $_.Name -eq 'campus-sky-palette.cjs') -and
    $_.Name -notin $campusKeepScreenshots
} | ForEach-Object FullName)
$campusManifest = @(foreach ($campusTarget in $campusTargets) {
    if (!(Test-Path -LiteralPath $campusTarget)) { continue }
    $campusResolved = (Resolve-Path -LiteralPath $campusTarget).Path
    $campusItem = Get-Item -LiteralPath $campusResolved -Force
    $campusInsideProject = $campusResolved.StartsWith($campusRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    $campusTempFile = !$campusItem.PSIsContainer -and (Split-Path -LiteralPath $campusResolved) -eq $campusTempRoot
    if (!$campusInsideProject -and !$campusTempFile) { throw "Unsafe target: $campusResolved" }
    if ($campusItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing link: $campusResolved" }
    $campusFiles = if ($campusItem.PSIsContainer) { @(Get-ChildItem -LiteralPath $campusResolved -Recurse -Force -File) } else { @($campusItem) }
    [pscustomobject]@{ Path = $campusResolved; Bytes = [long]($campusFiles | Measure-Object Length -Sum).Sum; Files = $campusFiles.Count }
})
$campusManifest | Select-Object Path, @{Name='MiB'; Expression={[math]::Round($_.Bytes/1MB,2)}} | Format-Table -AutoSize
$campusTotalBytes = [long]($campusManifest | Measure-Object Bytes -Sum).Sum
Write-Host ('Reproducible output total: {0:N2} MiB' -f ($campusTotalBytes/1MB))
if (!$Apply) { Write-Host 'Preview only. Run this script with -Apply to delete the listed outputs.'; return }
$campusProtectedPaths = @(
    Get-ChildItem -LiteralPath (Join-Path $campusRoot 'output') -Filter '*.glb' -File
    Get-ChildItem -LiteralPath (Join-Path $campusRoot 'blender') -File | Where-Object Name -match '\.blend[0-9]*$'
    Get-Item -LiteralPath (Join-Path $campusRoot 'web/public/models/campus_refined_v005.glb')
)
$campusProtectedHashes = @{}
foreach ($campusProtected in $campusProtectedPaths) { $campusProtectedHashes[$campusProtected.FullName] = (Get-FileHash -LiteralPath $campusProtected.FullName).Hash }
foreach ($campusEntry in $campusManifest) { Remove-Item -LiteralPath $campusEntry.Path -Recurse -Force }
foreach ($campusProtected in $campusProtectedPaths) {
    if ((Get-FileHash -LiteralPath $campusProtected.FullName).Hash -ne $campusProtectedHashes[$campusProtected.FullName]) { throw "Protected asset changed: $($campusProtected.FullName)" }
}
Write-Host ('Removed {0:N2} MiB. Protected assets unchanged.' -f ($campusTotalBytes/1MB))
Write-Host 'Main web dependencies, active Vite cache, historical reports and Blender backups retained.'
Write-Host 'Rebuild web/dist with npm run build; rebuild server output with Maven package.'
Write-Host 'Restore the legacy diagnostic dependency with npm ci in diagnostics/web_test.'
