const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { authorsFor, doiFor, publicationView, citationFor } = require('./publication-view');
const groups = require('../src/data/publications.json');
const marks = require('../src/data/publication-venues.json');

test('citation author names preserve APA pairs and Scholar initials', () => {
    assert.deepEqual(authorsFor({ authorLine: 'Peng, Z., Chen, Q., & Oulasvirta, A.' }),
        ['Peng, Z.', 'Chen, Q.', 'Oulasvirta, A.']);
    assert.deepEqual(authorsFor({ authorLine: 'K Yuan, G Chen, X Ma' }), ['K Yuan', 'G Chen', 'X Ma']);
    assert.deepEqual(authorsFor({ authorLine: 'Haichang Li, Arpit Narechania, Cindy Xiong Bearfield, Huamin Qu' }),
        ['Haichang Li', 'Arpit Narechania', 'Cindy Xiong Bearfield', 'Huamin Qu']);
    assert.deepEqual(authorsFor({ authorLine: 'Jason I. Hong, Brian A. Smith, Lik–Hang Lee, lvmin Zhang' }),
        ['Jason I. Hong', 'Brian A. Smith', 'Lik–Hang Lee', 'lvmin Zhang']);
    assert.deepEqual(authorsFor({ authorLine: 'Shi, Y., Yan, X. Ma, X., Lou, Y., and Cao, N.' }),
        ['Shi, Y.', 'Yan, X.', 'Ma, X.', 'Lou, Y.', 'Cao, N.']);
    assert.deepEqual(authorsFor({ authorLine: 'Sun, Z., Yürüten, O, and Ma, X.' }),
        ['Sun, Z.', 'Yürüten, O', 'Ma, X.']);
    assert.deepEqual(authorsFor({ authorLine: 'Kang, Y.*, Sun, Z.*, and Ma, X. (equal contribution)' }),
        ['Kang, Y.', 'Sun, Z.', 'Ma, X.']);
    assert.deepEqual(authorsFor({ authorLine: 'Zhao, Z., Yu, Mo., and Ma, X.' }),
        ['Zhao, Z.', 'Yu, Mo.', 'Ma, X.']);
    assert.deepEqual(authorsFor({ authorLine: 'R Zhang, R Wan, H Qu, ...' }),
        ['R Zhang', 'R Wan', 'H Qu', 'others']);
    assert.equal(authorsFor({ authorLine: 'Unstructured unknown author data' }), null);
});

test('DOI identity handles resolver and ACM full-text URLs without guessing identifiers', () => {
    assert.equal(doiFor({ links: { doi: 'https://doi.org/10.1234/%43ase' } }), '10.1234/case');
    assert.equal(doiFor({ links: { url: 'https://dl.acm.org/doi/full/10.1145/3613904.3642960' } }),
        '10.1145/3613904.3642960');
    assert.equal(doiFor({ links: { pdf: 'https://example.org/paper.pdf' } }), '');
});

test('BibTeX retains known fields, journal type and title capitalization', () => {
    const paper = {
        title: 'AI & Human_Centered Research',
        authorLine: 'K Yuan, X Ma',
        category: 'Conference',
        venue: 'Proceedings of the ACM on Human-Computer Interaction, vol. 10, no. 6, pp. 1-36',
        links: { doi: 'https://doi.org/10.1145/3816913' },
    };
    assert.equal(citationFor(paper, 2026, 'sample'), [
        '@article{sample,',
        '  title = {{AI \\& Human\\_Centered Research}},',
        '  author = {K Yuan and X Ma},',
        '  year = {2026},',
        '  journal = {Proceedings of the ACM on Human-Computer Interaction},',
        '  volume = {10},',
        '  number = {6},',
        '  pages = {1--36},',
        '  doi = {10.1145/3816913},',
        '  url = {https://doi.org/10.1145/3816913}',
        '}',
    ].join('\n'));
    assert.equal(citationFor({ title: 'Unknown', authorLine: '' }, 2026, 'unknown'), '');
    assert.match(citationFor({
        category: 'Journal',
        title: 'Exploropleth',
        authorLine: 'Arpit Narechania, Alex Endert, Clio Andris',
        venue: 'Cartography and Geographic Information Science, vol. 53, no. 6, pp. 659-674',
    }, 2026, 'exploropleth'), /^@article\{/);
});

test('current publications have unique IDs and citations and use local assets when an image is shown', () => {
    const before = JSON.stringify(groups);
    const records = groups.flatMap((group) => group.papers.map((paper) => publicationView(paper, group.year, marks)));
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
    for (const record of records) {
        assert.ok(record.displayTitle, record.id);
        assert.ok(record.bibtex, record.displayTitle);
        assert.doesNotMatch(record.displayTitle, /^Exploropleth:/i);
        assert.ok(record.media?.src, record.displayTitle);
        assert.ok(fs.existsSync(path.join(__dirname, '../src', record.media.src)), record.media.src);
    }
    assert.equal(JSON.stringify(groups), before);
});

test('edition and journal images resolve for the previously missed records', () => {
    const cases = [
        ['10.1145/3637321', 'cscw-2024'], ['10.1145/3610063', 'cscw-2023'],
        ['10.1145/3555084', 'cscw-2022', 'CSCW2 2022'],
        ['10.1145/3449086', 'cscw-2021', 'CSCW1 2021'],
        ['10.1145/3698130', 'iss-2024'], ['10.1111/cgf.14299', 'cgf'],
        ['10.1201/9780429286490-12', 'taylor-francis'],
    ];
    for (const [doi, key, prefix] of cases) {
        const group = groups.find(({ papers }) => papers.some((paper) => doiFor(paper) === doi));
        assert.ok(group, doi);
        const paper = group.papers.find((record) => doiFor(record) === doi);
        const result = publicationView(paper, group.year, marks);
        assert.equal(result.venueKey, key, paper.title);
        assert.equal(result.media.src, marks[key].src);
        if (key === 'taylor-francis') { assert.match(result.bibtex, /^@incollection\{/); assert.match(result.bibtex, /booktitle = \{Data Analytics Applications in Gaming and Entertainment\}/); }
        if (prefix) {
            assert.ok(result.displayVenue.startsWith(prefix));
            assert.match(result.bibtex, /journal = \{Proceedings of the ACM on Human-Computer Interaction\}/);
        }
    }
});

test('unknown PACMHCI issues and missing annual marks do not inherit unrelated artwork', () => {
    const pacm = { title: 'An unrelated track', venue: 'Proceedings of the ACM on Human-Computer Interaction, vol. 8, no. EICS' };
    assert.equal(publicationView(pacm, 2024, marks).venueKey, 'acm');
    const dis = publicationView({ title: 'A paper', venue: 'Proc. ACM DIS2022' }, 2022, marks);
    assert.equal(dis.venueKey, 'acm');
    assert.equal(dis.media.alt, marks.acm.label);
    assert.equal(publicationView({ title: 'New venue', venue: 'Unknown Venue' }, 2026, marks).media, null);
});

test('reviewed paper images can replace venue marks without changing citation identity', () => {
    const paper = groups[0].papers[3];
    const initial = publicationView(paper, groups[0].year, marks);
    const replacement = { src: 'img/publications/verified.webp', alt: 'Verified paper figure' };
    const updated = publicationView(paper, groups[0].year, marks, { [initial.id]: replacement });
    assert.equal(initial.media.isLogo, true);
    assert.deepEqual(updated.media, { ...replacement, isLogo: false });
    assert.equal(updated.id, initial.id);
    assert.equal(updated.bibtex, initial.bibtex);
});
