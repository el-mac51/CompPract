const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');

const BASE_URL = 'https://atlas.herzen.spb.ru';
const END_PAGE = 54;
const DELAY = 500;
const TIMEOUT = 30000;
const CONCURRENCY = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

const OUT_DIR = __dirname;
const CSV_PATH = path.join(OUT_DIR, 'puppeteer.csv');
const LINKS_PATH = path.join(OUT_DIR, 'teachers_links.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getTeachersList(page, pageNum) {
    await page.goto(`${BASE_URL}/teachers?page=${pageNum}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    return page.evaluate(() => {
        const teachers = {};
        document.querySelectorAll('a.text-blue-600').forEach(a => {
            const href = a.getAttribute('href');
            const name = a.innerText.trim();
            if (href && name.length > 3 && href.includes('/teachers/')) {
                teachers[href] = { name, link: href };
            }
        });
        return Object.values(teachers);
    });
}

async function getTeacherDetails(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    return page.evaluate(() => {
        const name = document.querySelector('h2')?.innerText.trim() || 'Не указано';
        const res = { name, email: 'Не указано', phone: 'Не указано' };
        document.querySelectorAll('h1.text-m').forEach(h1 => {
            const t = h1.innerText.trim();
            if (t.includes('@')) res.email = t;
            else if (/^[+78]/.test(t)) res.phone = t;
        });
        return res;
    });
}

async function loadOrCollectLinks(page) {
    try {
        const saved = JSON.parse(await fs.readFile(LINKS_PATH, 'utf-8'));
        if (Array.isArray(saved) && saved.length > 0) {
            console.log(`Загрузка ${saved.length} ссылок...`);
            return saved;
        }
    } catch {}

    const all = [];
    for (let i = 1; i <= END_PAGE; i++) {
        console.log(`Страница ${i}/${END_PAGE}...`);
        const t = await getTeachersList(page, i);
        all.push(...t);
        console.log(`   Найдено: ${t.length}`);
        await sleep(DELAY);
    }
    await fs.writeFile(LINKS_PATH, JSON.stringify(all, null, 2));
    console.log(`Сохранено ${all.length}`);
    return all;
}

async function setupPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on('request', req => {
        const blocked = ['image', 'stylesheet', 'font', 'media', 'prefetch', 'manifest', 'texttrack'];
        blocked.includes(req.resourceType()) ? req.abort() : req.continue();
    });
    return page;
}

async function main() {
    console.log('='.repeat(50) + '\nСкрапинг РГПУ — Puppeteer\n' + '='.repeat(50));

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', `--user-agent=${USER_AGENT}`]
    });

    try {
        const pages = await Promise.all(Array.from({ length: CONCURRENCY }, () => setupPage(browser)));
        const allTeachers = await loadOrCollectLinks(pages[0]);

        const processed = new Set();
        let needHeader = true;
        try {
            const content = await fs.readFile(CSV_PATH, 'utf-8');
            content.split('\n').slice(1).forEach(line => {
                const c = line.split(';');
                if (c[3]) processed.add(c[3].trim());
            });
            needHeader = false;
        } catch {}

        const toProcess = allTeachers.filter(t => !processed.has(t.link));
        console.log(`Осталось: ${toProcess.length}`);
        if (!toProcess.length) return console.log('Все уже обработаны!');

        if (needHeader) await fs.writeFile(CSV_PATH, '\ufeffname;email;phone;link\n');

        let done = 0;
        const total = toProcess.length;
        let idx = 0;

        async function runWorker(page) {
            while (idx < total) {
                const teacher = toProcess[idx++];
                if (!teacher) break;
                await sleep(DELAY);
                try {
                    const d = await getTeacherDetails(page, `${BASE_URL}${teacher.link}`);
                    await fs.appendFile(CSV_PATH, `${d.name};${d.email};${d.phone};${teacher.link}\n`);
                    console.log(`[${++done}/${total}] ${d.name}`);
                } catch (e) {
                    console.error(`${teacher.name}:`, e.message);
                    await fs.appendFile(CSV_PATH, `${teacher.name};Не указано;Не указано;${teacher.link}\n`);
                    done++;
                }
            }
        }

        await Promise.allSettled(pages.map(p => runWorker(p)));
        console.log(`\nГотово! Обработано: ${done}. Файл: ${CSV_PATH}`);
    } finally {
        await browser.close();
    }
}

main().catch(err => { console.error('', err); process.exit(1); });
