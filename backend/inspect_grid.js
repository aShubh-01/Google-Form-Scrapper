import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  
  await page.goto("https://docs.google.com/forms/d/e/1FAIpQLSeTQQK-MvB3vxaEn5Gfan7JGzrU06D1GJv00mYI8EAJtLKlfg/viewform", { waitUntil: "networkidle2" });
  
  const questions = await page.evaluate(() => {
    const blocks = document.querySelectorAll('[jsmodel="CP1oW"][data-params]');
    return Array.from(blocks).map(block => {
      const dataStr = block.getAttribute('data-params');
      return {
        title: block.querySelector('.M7eMe')?.innerText,
        data: dataStr
      };
    });
  });

  console.log(JSON.stringify(questions, null, 2));
  await browser.close();
})();
