$dir = "e:\octfis-project\jobwork-process-webapp\web\src\features\reports"
Get-ChildItem -Path $dir -Filter "*.tsx" -Recurse | ForEach-Object {
    $content = Get-Content -Raw $_.FullName
    $c2 = $content -replace "fontWeight: 600", "fontWeight: 700"
    $c2 = $c2 -replace "fontWeight: 500", "fontWeight: 600"
    $c2 = $c2 -replace "fontWeight: 400", "fontWeight: 500"
    
    if ($content -ne $c2) {
        Set-Content -Path $_.FullName -Value $c2 -NoNewline
        Write-Host "Updated $($_.Name)"
    }
}
