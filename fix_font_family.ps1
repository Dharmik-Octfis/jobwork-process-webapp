$dir = "e:\octfis-project\jobwork-process-webapp\web\src\features\reports"
$zohoFont = "'`"Zoho Puvi`", -apple-system, BlinkMacSystemFont, `"Segoe UI`", Roboto, `"Helvetica Neue`", Arial, sans-serif'"
Get-ChildItem -Path $dir -Filter "*.tsx" -Recurse | ForEach-Object {
    $content = Get-Content -Raw $_.FullName
    $c2 = $content -replace "'zoho-puvi, sans-serif'", $zohoFont
    
    if ($content -ne $c2) {
        Set-Content -Path $_.FullName -Value $c2 -NoNewline
        Write-Host "Updated $($_.Name)"
    }
}
