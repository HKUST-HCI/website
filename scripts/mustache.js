const fs = require('fs');
const mustache = require('mustache');
const { publicationView } = require('./publication-view');
const venueMarks = require('../src/data/publication-venues.json');
const publicationImages = require('../src/data/publication-images.json');

// Define colors {{{

const classColor = {
    faculty_in: "#DC3912",
    faculty_out: "#3366CC",
    staff: "#7C90EC",
    phd: "#49B4ff",
    mphil: "#ffa810",
    intern: "#00C012",
    ug: "#d1b68f",
    default: "#AAAAAA",
}

const projectColor = Object.values(classColor)
projectColor.index = 0
projectColor.next = function() {
    const color = this[this.index]
    this.index = (this.index + 1 + this.length) % this.length
    return color
}

// }}}

// Load mustache files {{{

const partials = fs.readdirSync('./src/partials')
    .filter(file => file.endsWith('.mustache'))
    .reduce((acc, file) => {
        const name = file.split('.')[0];
        acc[name] = fs.readFileSync(`./src/partials/${file}`, 'utf8').toString();
        return acc;
    }, {});

const pages = fs.readdirSync('./src', { withFileTypes: true })
    .filter(dirent => dirent.isFile() && dirent.name.endsWith('.mustache'))
    .map(dirent => dirent.name)

// }}}

// Load data {{{

// Load people data first. It may be needed in other files

let PEOPLE = JSON.parse(fs.readFileSync(`./src/data/people.json`, 'utf8').toString());

const dataPreprocessors = {
    news: (items) => {
        const years = [];
        const byYear = new Map();
        items.forEach(item => {
            const match = String(item.time || '').match(/\b(20\d{2})\b/);
            const year = match ? match[1] : 'Other';
            if (!byYear.has(year)) {
                const group = { year, count: 0, items: [], open: years.length === 0 };
                byYear.set(year, group);
                years.push(group);
            }
            const group = byYear.get(year);
            group.items.push(item);
            group.count += 1;
        });
        return years;
    },
    publications: (data) => {
        data.forEach((year, idx) => {
            year.count = year.papers.length;
            year.open = idx === 0;
            year.papers.forEach(publication => {
                if (!publication.authorLine && !!publication.authors) {
                    publication.authorLine = publication.authors.join(', ');
                }
                publication.categoryLower = (publication.category || '').toLowerCase();
                Object.assign(publication, publicationView(publication, year.year, venueMarks, publicationImages));
            })
        });
        return data;
    },
    people: (data) => {
        data.forEach(group => {
            group.members.forEach(person => {
                person.color = classColor[person.class] || classColor.default;
                // person.url = person.url || '#'
                person.image = person.image || "img/people/default.jpg"
            })
        })
        return data;
    },
    projects: (data) => {
        data.forEach(project => {
            if (!project.color) {
                project.color = projectColor.next()
            }
        })
        return data
    },
    maintainer: (data) => {
        data.authors.forEach(p => {
            if (!p.url) {
                p.url = PEOPLE_NAME_BY_URL[p.name] || '#'
            }
        })
        data.maintainers.forEach((p, index) => {
            if (!p.url) {
                p.url = PEOPLE_NAME_BY_URL[p.name] || '#'
            }
            p.separator = index === 0 ? '' : index === data.maintainers.length - 1 ? ' and ' : ', ';
        })
        return data
    }
    // ongoingProjects: (data) => {
    //     data.forEach(op => {
    //         if (!op.url)
    //     })
    // }
}

if (dataPreprocessors.people) {
    PEOPLE = dataPreprocessors.people(PEOPLE)
}
const PEOPLE_NAME_BY_URL = PEOPLE.reduce((acc, { members }) => {
    const group = members.reduce((accMembers, { name, url }) => ({
        ...accMembers,
        [name]: url,
    }), {})
    return {
        ...acc,
        ...group
    }
}, {})

const data = fs.readdirSync('./src/data')
    .filter(file => file.endsWith('.json') && file != 'people.json')
    .reduce((acc, file) => {
        const name = file.split('.')[0];
        let d = JSON.parse(fs.readFileSync(`./src/data/${file}`, 'utf8').toString());
        if (dataPreprocessors[name]) {
            d = dataPreprocessors[name](d);
        }
        return { ...acc, [name]: d }
    }, { people: dataPreprocessors.people ? dataPreprocessors.people(PEOPLE) : PEOPLE });

// Derived view-models for clean multi-column layouts
const currentGroup = data.people.find(g => /current/i.test(g.type)) || data.people[0];
const pastGroup = data.people.find(g => /past|alumni/i.test(g.type));
const peopleSections = [];
if (currentGroup) {
    const faculty = currentGroup.members.filter(m => m.class === 'faculty_in' || m.class === 'faculty_out');
    const postdocs = currentGroup.members.filter(m => m.class === 'staff');
    const students = currentGroup.members.filter(m => m.class !== 'faculty_in' && m.class !== 'faculty_out' && m.class !== 'staff');
    if (faculty.length) peopleSections.push({ id: 'faculty', title: 'Faculty', count: faculty.length, isAlumni: false, lazyImg: false, members: faculty });
    if (postdocs.length) peopleSections.push({ id: 'postdocs', title: 'Postdoctoral Fellows', count: postdocs.length, isAlumni: false, lazyImg: true, members: postdocs });
    if (students.length) peopleSections.push({ id: 'students', title: 'Students & Members', count: students.length, isAlumni: false, lazyImg: true, members: students });
}
if (pastGroup && pastGroup.members.length) {
    peopleSections.push({ id: 'alumni', title: 'Alumni & Past Members', count: pastGroup.members.length, isAlumni: true, lazyImg: true, members: pastGroup.members });
}
data.peopleSections = peopleSections;

const allPapers = (data.publications || []).flatMap(y => y.papers || []);
const pubYears = (data.publications || []).map(y => Number(y.year)).filter(Boolean);
data.publicationSummary = {
    total: allPapers.length,
    minYear: pubYears.length ? Math.min(...pubYears) : '',
    maxYear: pubYears.length ? Math.max(...pubYears) : '',
    conferenceCount: allPapers.filter(p => (p.category || '').toLowerCase() === 'conference').length,
    journalCount: allPapers.filter(p => (p.category || '').toLowerCase() === 'journal').length,
    bookCount: allPapers.filter(p => (p.category || '').toLowerCase().includes('book')).length,
};
data.newsCount = (data.news || []).reduce((sum, g) => sum + (g.count || 0), 0);

// }}}

const siteOrigin = 'https://hci.cse.ust.hk';
const siteName = 'HKUST HCI Initiative';
const homeUrl = `${siteOrigin}/`;
const pageDetails = {
    index: ['Human-Computer Interaction Initiative at HKUST', 'The HKUST HCI Initiative brings together researchers in human-computer interaction at the Hong Kong University of Science and Technology. Explore our research, people, and publications.'],
    people: [`People | ${siteName}`, 'Meet the faculty, postdoctoral fellows, students, and alumni of the HKUST Human-Computer Interaction Initiative.'],
    publications: [`Publications | ${siteName}`, 'Browse publications from the HKUST HCI Initiative by year, with links to papers and BibTeX citations.'],
    life: [`Life | ${siteName}`, 'See photographs from conferences, lab visits, and community activities at the HKUST HCI Initiative.'],
    contact: [`Join Us | ${siteName}`, 'Explore research opportunities with faculty in the HKUST Human-Computer Interaction Initiative.'],
    projects: [`Projects | ${siteName}`, 'Explore research projects and demos from the HKUST Human-Computer Interaction Initiative.'],
    'research-private-policy': [`Research Privacy Policy | ${siteName}`, 'Read the general privacy policy for research projects at the HKUST HCI Initiative.'],
};
const canonicalUrls = [];

pages.forEach(page => {
    const name = page.split('.')[0];
    const template = fs.readFileSync(`./src/${page}`).toString();
    const details = pageDetails[name];
    const pageMeta = details
        ? { title: details[0], description: details[1], canonical: name === 'index' ? homeUrl : `${siteOrigin}/${name}.html` }
        : { title: name === 'supporters' ? `Supporters | ${siteName}` : siteName, noindex: name !== 'advanced', canonical: name === 'advanced' ? homeUrl : '' };
    if (details) canonicalUrls.push(pageMeta.canonical);
    const html = mustache.render(template, { ...data, pageMeta }, partials);
    fs.writeFileSync(`./build/${name}.html`, html);
});

fs.writeFileSync('./build/sitemap.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...canonicalUrls.sort().map(url => `  <url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
].join('\n'));
fs.writeFileSync('./build/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${siteOrigin}/sitemap.xml\n`);
