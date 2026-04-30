$body = @{
    name = "Test Lead"
    mobile = "9876512345"
    email = "test@example.com"
    campaign_name = "Test Campaign"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:3000/webhook/make" -Method Post -ContentType "application/json" -Body $body

$response
