[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference='Stop'
$campusRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if(!(Test-Path -LiteralPath (Join-Path $campusRoot 'web/package.json')) -or !(Test-Path -LiteralPath (Join-Path $campusRoot 'output/campus_refined_v005.glb'))){throw 'Unexpected project root'}
$relative=@('web/dist','scripts/__pycache__',
 'output/campus_shape_review_v003.precision-draft.glb','output/campus_shape_review_v003.precision-draft2.glb',
 'output/campus_shape_review_v001_failed_readback.glb','output/campus_shape_review_v001_failed_readback2.glb',
 'reference/buildings/shape_review_v001/draft_before_base_fix')
$targets=@(foreach($name in $relative){
 $candidate=Join-Path $campusRoot $name
 if(!(Test-Path -LiteralPath $candidate)){continue}
 $resolved=(Resolve-Path -LiteralPath $candidate).Path
 if(!$resolved.StartsWith($campusRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Target outside project'}
 $item=Get-Item -LiteralPath $resolved -Force
 $children=@(if($item.PSIsContainer){Get-ChildItem -LiteralPath $resolved -Recurse -Force})
 if(@($item)+$children | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}){throw 'Refusing reparse point'}
 $files=if($item.PSIsContainer){@($children | Where-Object {!$_.PSIsContainer})}else{@($item)}
 [pscustomobject]@{Path=$resolved;Bytes=[long]($files|Measure-Object Length -Sum).Sum}
})
$active=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'campus.*vite preview'}
if($active){throw 'Preview process may be using dist; nothing removed'}
if(!$Apply){$targets|ConvertTo-Json -Compress;return}
$protected=@('output/campus_refined_v005.glb','output/campus_detail_release_v004.glb',
 'output/campus_shape_review_v001.glb','output/campus_shape_review_v002.glb','output/campus_shape_review_v003.glb','output/campus_shape_review_v004.glb',
 'output/geojson/buildings.geojson','web/public/data/buildings.geojson','web/public/models/campus_shape_review_v004.glb',
 'blender/campus_shape_review_v004.blend')
$hashes=@{};foreach($name in $protected){$hashes[$name]=(Get-FileHash -LiteralPath (Join-Path $campusRoot $name)).Hash}
$freeBefore=(Get-PSDrive C).Free
foreach($target in $targets){Remove-Item -LiteralPath $target.Path -Recurse -Force}
foreach($name in $protected){if($hashes[$name] -ne (Get-FileHash -LiteralPath (Join-Path $campusRoot $name)).Hash){throw 'Protected artifact changed'}}
[pscustomobject]@{DeletedBytes=[long]($targets|Measure-Object Bytes -Sum).Sum;RemovedPaths=$targets.Path;
 FreeBeforeBytes=$freeBefore;FreeAfterBytes=(Get-PSDrive C).Free;ProtectedHashesUnchanged=$true}|ConvertTo-Json -Compress
