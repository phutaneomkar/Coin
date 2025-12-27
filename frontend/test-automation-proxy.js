const http = require('http');

const data = JSON.stringify({
    amount: "100.50",
    profit_percentage: "1.5",
    total_iterations: 1,
    duration_minutes: 10
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/automation/start',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Cookie': 'app_access=true'
    }
};

console.log("Testing Automation Start via Proxy (Native HTTP)...");

const req = http.request(options, (res) => {
    console.log(`Response Status: ${res.statusCode}`);

    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
    });

    res.on('end', () => {
        console.log(`Response Body: ${body}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log("✅ SUCCESS: Strategy started!");
        } else {
            console.log("❌ FAILED: API returned error.");
        }
    });
});

req.on('error', (error) => {
    console.error("❌ ERROR: Connection failed", error);
});

req.write(data);
req.end();
