const express = require("express");
const puppeteer = require("puppeteer-core");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// TEST
app.get("/", (req, res) => {
    res.send("Server is working 🚀");
});

// ANALYZE
app.get("/analyze", async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: "No URL provided" });
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.CHROME_PATH || undefined,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

    } catch (err) {
        return res.status(500).json({
            error: "Browser failed to start. Chrome not found on server."
        });
    }

    try {
        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        const data = await page.evaluate(() => {
            const elements = document.querySelectorAll("p,h1,h2,h3,span");

            return Array.from(elements).map(el => {
                const style = getComputedStyle(el);

                let text = el.innerText || "";
                text = text.replace(/\s+/g, " ").trim();
                if (!text) text = "[No text]";
                text = text.slice(0, 60);

                return {
                    tag: el.tagName,
                    text,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight
                };
            });
        });

        await browser.close();

        res.json({ elements: data.slice(0, 20) });

    } catch (err) {
        if (browser) await browser.close();
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
