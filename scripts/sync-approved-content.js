const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataPath = (...parts) => path.join(root, ...parts);
const readJson = (file, fallback) => fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : fallback;
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`, 'utf8');

const hasValue = (value) => value !== null && value !== undefined && value !== ''
    && (!Array.isArray(value) || value.length > 0)
    && (typeof value !== 'object' || Object.keys(value).length > 0);
const doiKey = (item) => {
    const links = item.links || {};
    for (const value of [item.doi, links.doi, item.publicationUrl, links.url, item.url]) {
        let doi = String(value || '').trim();
        try { doi = decodeURIComponent(doi); } catch (_) { /* Keep undecodable input for validation below. */ }
        doi = doi.toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/, '');
        if (/^10\.\d{4,9}\/\S+$/.test(doi)) return doi;
    }
    return '';
};
const titleKey = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const samePublication = (left, right) => {
    const leftDoi = doiKey(left), rightDoi = doiKey(right);
    if (leftDoi && rightDoi) return leftDoi === rightDoi;
    const title = titleKey(left.title);
    return !!title && title === titleKey(right.title) && Number(left.year) === Number(right.year);
};
const mergePaper = (existing, incoming) => {
    const merged = {
        ...existing,
        ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => hasValue(value))),
    };
    const links = { ...(existing.links || {}), ...(incoming.links || {}) };
    if (Object.keys(links).length) merged.links = links;
    return merged;
};

const approvedNews = readJson(dataPath('automation', 'data', 'approved-news.json'), {items: []}).items || [];
const news = approvedNews
    .filter((item) => item && item.time && item.content && !item.systemNotice)
    .map(({time, content}) => ({time, content}));
writeJson(dataPath('src', 'data', 'news.json'), news);

const excludedPublicationDois = new Set(['10.1080/15230406.2025.2543483']);
const approvedPublications = (readJson(dataPath('automation', 'data', 'approved-publications.json'), {items: []}).items || [])
    .filter((item) => !excludedPublicationDois.has(doiKey(item)));
const publicationsFile = dataPath('src', 'data', 'publications.json');
const existingYears = readJson(publicationsFile, []);
const records = existingYears.flatMap((entry) =>
    (entry.papers || []).map((paper) => ({ year: Number(entry.year), paper }))
);
for (const item of approvedPublications) {
    const year = Number(item.year);
    if (!Number.isInteger(year) || year <= 0 || !String(item.title || '').trim()) continue;
    const doi = doiKey(item);
    const venueUrl = item.publicationUrl || (doi ? `https://doi.org/${doi}` : item.url) || '';
    const sourceUrl = item.scholarUrl || item.sourceUrl || '';
    const links = {};
    if (venueUrl) links.url = venueUrl;
    if (doi) links.doi = `https://doi.org/${doi}`;
    if (sourceUrl) links.source = sourceUrl;
    const paper = Object.fromEntries(Object.entries({
        category: item.category,
        title: item.title,
        authorLine: item.authorLine,
        venue: item.venue,
        year,
        links,
        image: item.image,
    }).filter(([, value]) => hasValue(value)));
    const index = records.findIndex((record) => samePublication({ ...record.paper, year: record.year }, paper));
    if (index < 0) {
        if (!paper.category) paper.category = /journal/i.test(item.venue || '') ? 'Journal' : 'Conference';
        records.push({ year, paper });
    } else {
        records[index] = { year, paper: mergePaper(records[index].paper, paper) };
    }
}
const grouped = new Map();
for (const { year, paper } of records) {
    if (!grouped.has(year)) {
        const original = existingYears.find((entry) => Number(entry.year) === year);
        grouped.set(year, { ...original, year, papers: [] });
    }
    grouped.get(year).papers.push(paper);
}
const merged = [...grouped.values()].sort((a, b) => Number(b.year) - Number(a.year));
writeJson(publicationsFile, merged);

console.log(`Synced ${news.length} news items and ${approvedPublications.length} approved publications.`);
