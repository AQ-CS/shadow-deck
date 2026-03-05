import puppeteer from 'puppeteer';

(async () => {
    console.log('Starting puppeteer...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    page.on('requestfailed', request => console.log('REQ FAIL:', request.url(), request.failure().errorText));

    console.log('Navigating to http://localhost:5173...');
    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 10000 });
        console.log('Page loaded.');
    } catch (e) {
        console.log('Nav error:', e.message);
    }

    await browser.close();
})();
