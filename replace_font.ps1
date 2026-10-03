$dir = "e:\octfis-project\jobwork-process-webapp\web\src\features\reports"
Get-ChildItem -Path $dir -Filter "*.tsx" -Recurse | ForEach-Object {
    $content = Get-Content -Raw $_.FullName
    $c2 = $content -replace "fontFamily: 'Inter, system-ui, sans-serif',", "fontFamily: 'zoho-puvi, sans-serif',"
    
    $old = "fontFamily:\r?\n\s*'""Open Sans"", ""WebFont"", -apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, ""Helvetica Neue"", Arial, sans-serif',"
    $c2 = $c2 -replace $old, "fontFamily: 'zoho-puvi, sans-serif',"
    
    if ($content -ne $c2) {
        Set-Content -Path $_.FullName -Value $c2 -NoNewline
        Write-Host "Updated $($_.Name)"
    }
}
