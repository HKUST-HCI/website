const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataPath = (...parts) => path.join(root, ...parts);
const readJson = (file, fallback) => fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : fallback;
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`, 'utf8');

const approvedNews = readJson(dataPath('automation', 'data', 'approved-news.json'), {items: []}).items || [];
const news = approvedNews
    .filter((item) => item && item.time && item.content && !item.systemNotice)
    .map(({time, content}) => ({time, content}));
writeJson(dataPath('src', 'data', 'news.json'), news);

const approvedPublications = readJson(dataPath('automation', 'data', 'approved-publications.json'), {items: []}).items || [];
const publicationsFile = dataPath('src', 'data', 'publications.json');
const existingYears = readJson(publicationsFile, []);
const approvedYears = new Set(approvedPublications.map((item) => Number(item.year)).filter(Boolean));
const retainedYears = existingYears.filter((entry) => !approvedYears.has(Number(entry.year)));
const grouped = new Map();

for (const item of approvedPublications) {
    const year = Number(item.year);
    if (!year || !item.title) continue;
    if (!grouped.has(year)) grouped.set(year, []);
    const venueUrl = item.publicationUrl || item.url || '';
    const sourceUrl = item.scholarUrl || item.sourceUrl || '';
    const links = {};
    if (venueUrl) links.url = venueUrl;
    if (item.doi) links.doi = /^https?:\/\//i.test(item.doi) ? item.doi : `https://doi.org/${item.doi}`;
    if (sourceUrl) links.source = sourceUrl;
    const paper = {
        category: item.category || (/journal/i.test(item.venue || '') ? 'Journal' : 'Conference'),
        title: item.title,
        authorLine: item.authorLine || '',
        venue: item.venue || '',
        year,
        links,
    };
    if (item.image) paper.image = item.image;
    grouped.get(year).push(paper);
}

const approvedYearEntries = [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, papers]) => ({year, papers}));
const merged = [...approvedYearEntries, ...retainedYears]
    .sort((a, b) => Number(b.year) - Number(a.year));
writeJson(publicationsFile, merged);

console.log(`Synced ${news.length} news items and ${approvedPublications.length} approved publications.`);
