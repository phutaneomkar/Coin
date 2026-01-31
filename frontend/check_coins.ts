
import * as fs from 'fs';

async function main() {
    try {
        const tRes = await fetch('https://api.coindcx.com/exchange/ticker');
        const tickers = await tRes.json();

        let debugInfo = `Total Tickers: ${tickers.length}\n`;
        if (tickers.length > 0) {
            debugInfo += 'Sample Ticker 0:\n' + JSON.stringify(tickers[0], null, 2) + '\n';

            // Find a futures ticker if possible
            const futuresTicker = tickers.find((t: any) => t.market && t.market.startsWith('B-'));
            if (futuresTicker) {
                debugInfo += 'Sample Futures Ticker:\n' + JSON.stringify(futuresTicker, null, 2) + '\n';
            } else {
                debugInfo += 'No ticker starting with B- found.\n';
            }
        }

        const fRes = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT');
        const instruments = await fRes.json();
        debugInfo += `Total Instruments: ${instruments.length}\n`;
        if (instruments.length > 0) {
            debugInfo += `Sample Instrument: ${instruments[0]}\n`;
        }

        fs.writeFileSync('volume_debug.txt', debugInfo);
        console.log('Debug info written to volume_debug.txt');

    } catch (err) {
        console.error(err);
        fs.writeFileSync('volume_debug.txt', 'Error: ' + err);
    }
}
main();
