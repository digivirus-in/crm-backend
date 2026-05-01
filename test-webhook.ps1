# Test Webhook Script for CRM Backend
# Run from crm-backend folder: .\test-webhook.ps1

Write-Host "Testing CRM Backend Webhook..." -ForegroundColor Cyan

# Ensure we're in the right directory
Set-Location "C:\Users\Lenovo\Documents\Codex\2026-04-29\crm-backend"

# First, check if server is running
Write-Host "`n1. Testing health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
    Write-Host "Health Check: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Server not responding!" -ForegroundColor Red
    Write-Host "Make sure you ran 'npm run dev' in a separate terminal" -ForegroundColor Red
    exit 1
}

# Now test the webhook
Write-Host "`n2. Sending test lead to webhook..." -ForegroundColor Yellow

$body = @{
    name = "Test Lead"
    mobile = "9876512345"
    email = "test@example.com"
    campaign_name = "Test Campaign"
} | ConvertTo-Json -Compress

Write-Host "Request body: $body" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/webhook/make" -Method Post -ContentType "application/json" -Body $body

    Write-Host "`nResponse:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10

    if ($response.success -eq $true) {
        Write-Host "`nSUCCESS! Lead created with ID: $($response.lead_id)" -ForegroundColor Green
    } else {
        Write-Host "`nFailed: $($response.error)" -ForegroundColor Red
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $responseText = ""

    try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseText = $reader.ReadToEnd()
        $reader.Close()
    } catch {}

    Write-Host "`nHTTP Status Code: $statusCode" -ForegroundColor Red
    Write-Host "Response Body: $responseText" -ForegroundColor Red
    Write-Host "`nFull Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nDone!" -ForegroundColor Cyan