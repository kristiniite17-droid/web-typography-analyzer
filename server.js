const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
    res.send("AI Analyzer Running 🚀");
});

app.get("/analyze", async (req, res) => {
    const url = req.query.url;

    if (!url) return res.json({ error: "No URL provided" });

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        const raw = await page.evaluate(() => {

            function describeElement(el) {
                if (el.innerText && el.innerText.trim()) {
                    return el.innerText.trim().slice(0, 100);
                }
                if (el.alt) return `Image alt: ${el.alt}`;
                if (el.href) return `Link: ${el.href}`;
                if (el.id) return `ID: ${el.id}`;
                if (el.className) return `Class: ${el.className}`;
                return `<${el.tagName}>`;
            }

            const elements = document.querySelectorAll("p,h1,h2,h3,span,img,a");

            return Array.from(elements).map(el => {
                const style = getComputedStyle(el);

                return {
                    tag: el.tagName,
                    text: describeElement(el),
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    alignment: style.textAlign,
                    color: style.color,
                    background: style.backgroundColor
                };
            });
        });

        // 🧠 CHATGPT ANALYSIS
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-5.3",
            messages: [
                {
                    role: "system",
                    content: "You are a UX and typography expert. Analyze elements and give short, clear recommendations."
                },
                {
                    role: "user",
                    content: JSON.stringify(raw.slice(0, 20)) // limit for cost
                }
            ]
        });

        await browser.close();

        res.json({
            elements: raw,
            ai: aiResponse.choices[0].message.content
        });

    } catch (err) {
        res.json({ error: err.message });
    }
});

app.listen(3000);
