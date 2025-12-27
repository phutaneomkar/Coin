const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/debug/orders',
    method: 'GET',
};

console.log("Fetching Orders...");

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
    });

    res.on('end', () => {
        try {
            const orders = JSON.parse(body);
            console.log("Found " + orders.length + " recent orders:");
            orders.forEach(o => {
                console.log(`[${o.order_type.toUpperCase()}] ${o.coin_symbol} - Status: ${o.order_status} - Price: ${o.price_per_unit} - Qty: ${o.quantity}`);
            });
        } catch (e) {
            console.log("Raw Body:", body);
        }
    });
});

req.on('error', (error) => {
    console.error("Error:", error);
});

req.end();
