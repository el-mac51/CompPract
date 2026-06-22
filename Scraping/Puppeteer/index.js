const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://atlas.herzen.spb.ru';
const DELAY = 500;        // 0.5 сек
const TIMEOUT = 30000;
const CONCURRENCY = 5;    // 5 параллельных страниц

const OUT_DIR = __dirname;
const CSV_PATH = path.join(OUT_DIR, 'puppeteer.csv');
const LINKS_PATH = path.join(OUT_DIR, 'teachers_links.json');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function getTeachersList(page, pageNum) {
    const url = `${BASE_URL}/teachers?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    return page.evaluate(() => {
        const teachers = [];
        document.querySelectorAll('a.text-blue-600').forEach(a => {
            const href = a.getAttribute('href');
            const name = a.innerText.trim();
            if (href && name && name.length > 3 && href.includes('/teachers/')) {
                teachers.push({ name, link: href });
            }
        });
        const seen = new Set();
        return teachers.filter(t => { if (seen.has(t.link)) return false; seen.add(t.link); return true; });
    });
}

async function getTeacherDetails(page, url) {
    try {
        // domcontentloaded вместо networkidle2 — быстрее
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await sleep(300); // даём React/Vue отрисовать контакты

        return page.evaluate(() => {
            const h2 = document.querySelector('h2');
            const name = h2 ? h2.innerText.trim() : 'Не указано';
            let email = 'Не указано';
            let phone = 'Не указано';
            document.querySelectorAll('h1.text-m').forEach(h1 => {
                const text = h1.innerText.trim();
                if (text.includes('@')) email = text;
                else if (/^[\+78]/.test(text)) phone = text;
            });
            return { name, email, phone };
        });
    } catch (err) {
        console.error(`  ⚠️ ${url}:`, err.message);
        return { name: 'Не указано', email: 'Не указано', phone: 'Не указано' };
    }
}

async function loadOrCollectLinks(page) {
    if (fs.existsSync(LINKS_PATH)) {
        try {
            const saved = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf-8'));
            if (Array.isArray(saved) && saved.length > 0) {
                console.log(`📂 Загрузка ${saved.length} ссылок...`);
                return saved;
            }
        } catch {}
    }
    const all = [];
    for (let i = 1; i <= 54; i++) {
        console.log(`🔍 Страница ${i}/54...`);
        const t = await getTeachersList(page, i);
        all.push(...t);
        console.log(`   Найдено: ${t.length}`);
        await sleep(DELAY);
    }
    fs.writeFileSync(LINKS_PATH, JSON.stringify(all, null, 2));
    console.log(`💾 Сохранено ${all.length}`);
    return all;
}

async function main() {
    console.log('='.repeat(50));
    console.log('Скрапинг РГПУ — Puppeteer (ускоренный, 5 страниц)');
    console.log('='.repeat(50));

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Создаем пул из 5 страниц с отключенными картинками/CSS
        const pages = [];
        for (let i = 0; i < CONCURRENCY; i++) {
            const p = await browser.newPage();
            await p.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
            );
            await p.setRequestInterception(true);
            p.on('request', req => {
                const type = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            pages.push(p);
        }

        // Собираем ссылки (одной страницей)
        const allTeachers = await loadOrCollectLinks(pages[0]);

        // Уже обработанные
        const processed = new Set();
        let needHeader = true;
        if (fs.existsSync(CSV_PATH)) {
            const lines = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').slice(1);
            lines.forEach(line => { const c = line.split(';'); if (c[3]) processed.add(c[3].trim()); });
            needHeader = false;
        }

        const toProcess = allTeachers.filter(t => !processed.has(t.link));
        console.log(`⏳ Осталось: ${toProcess.length}`);

        if (needHeader) fs.writeFileSync(CSV_PATH, '\ufeffname;email;phone;link\n');

        // Параллельные воркеры
        let done = 0;
        const total = toProcess.length;
        const queue = [...toProcess];

        async function runWorker(page) {
            while (queue.length > 0) {
                const teacher = queue.shift();
                if (!teacher) break;
                await sleep(DELAY);
                try {
                    const d = await getTeacherDetails(page, teacher.link);
                    fs.appendFileSync(CSV_PATH, `${d.name};${d.email};${d.phone};${teacher.link}\n`);
                    done++;
                    console.log(`[${done}/${total}] ${d.name}`);
                } catch (e) {
                    console.error(`⚠️ ${teacher.name}:`, e.message);
                    fs.appendFileSync(CSV_PATH, `${teacher.name};Не указано;Не указано;${teacher.link}\n`);
                }
            }
        }

        await Promise.all(pages.map(p => runWorker(p)));
        console.log('\n✅ Готово! Файл:', CSV_PATH);
    } finally {
        await browser.close();
    }
}

main().catch(err => { console.error('❌', err); process.exit(1); });