const crypto = require('node:crypto');

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function doiFor(paper) {
    const links = paper.links || {};
    for (const value of [paper.doi, links.doi, links.url, links.pdf]) {
        let candidate = clean(value);
        try { candidate = decodeURIComponent(candidate); } catch (_) { /* Validate the original below. */ }
        candidate = candidate
            .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
            .replace(/^https?:\/\/(?:dl|doi)\.acm\.org\/(?:doi\/(?:(?:full|abs|pdf|epdf)\/)?)?/i, '')
            .replace(/^doi:\s*/i, '')
            .split(/[?#]/)[0];
        if (/^10\.\d{4,9}\/\S+$/i.test(candidate)) return candidate.toLowerCase();
    }
    return '';
}

function paperUrlFor(paper) {
    const links = paper.links || {};
    const doi = doiFor(paper);
    return [links.url, links.pdf, doi && `https://doi.org/${doi}`, links['read more']]
        .find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || '';
}

function authorsFor(paper) {
    if (Array.isArray(paper.authors) && paper.authors.length) return paper.authors.map(clean);
    const abbreviated = /(?:\.{3}|…|et al\.?)\s*$/i.test(clean(paper.authorLine));
    let line = clean(paper.authorLine)
        .replace(/,?\s*(?:\.{3}|…|et al\.?)\s*$/i, '')
        .replace(/\s*\(equal contribution\)/gi, '')
        .replace(/\*/g, '')
        .replace(/,?\s+(?:and|&)\s+/g, ', ');
    // Repair the omitted separator only in APA-style lists, not names such as Jason I. Hong.
    if (/^[^,]+,\s*\p{Lu}\./u.test(line)) {
        line = line.replace(/(\p{Lu}\.)\s+(?=\p{Lu}\p{Ll}[\p{L}-]*,\s*\p{Lu})/gu, '$1, ');
    }
    const tokens = line.split(',').map(clean).filter(Boolean);
    const initials = /^(?:[\p{Lu}.\s-]+|(?:\p{Lu}[\p{Ll}]*\.(?:\s*|-))*\p{Lu}[\p{Ll}]*\.)$/u;
    if (tokens.length % 2 === 0 && tokens.filter((_, i) => i % 2).every((token) => initials.test(token))) {
        const names = tokens.filter((_, i) => i % 2 === 0).map((surname, i) => `${surname}, ${tokens[i * 2 + 1]}`);
        return abbreviated ? [...names, 'others'] : names;
    }
    // The newer Scholar records store each author as "K Yuan", not "Yuan, K.".
    if (tokens.length && tokens.every((token) => /^[\p{Lu}\s.-]+\s+[\p{L}'’-]+$/u.test(token))) {
        return abbreviated ? [...tokens, 'others'] : tokens;
    }
    const fullName = /^\p{L}[\p{L}\p{M}.'’\p{Pd}]*(?:\s+(?:\p{Lu}[\p{L}\p{M}.'’\p{Pd}]*|van|von|de|del|da|di|den|der|dos|du|la|le))+\s*$/u;
    if (tokens.length && tokens.every((token) => fullName.test(token))) {
        return abbreviated ? [...tokens, 'others'] : tokens;
    }
    return null;
}

function tex(value) {
    const replacements = {
        '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&',
        '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
    };
    return clean(value).replace(/[\\{}&%$#_~^]/g, (character) => replacements[character]);
}

function citationFor(paper, year, id) {
    const authors = authorsFor(paper);
    const title = clean(paper.title) || clean(paper.venue);
    if (!title || !authors || !authors.length) return '';
    const rawVenue = clean(paper.venue);
    const journal = /^journal$/i.test(clean(paper.category)) ||
        /journal|transactions|proceedings of the acm on human-computer interaction|acm hum\.-comput\. interact|^artificial intelligence$|^information$|^interacting with computers/i.test(rawVenue);
    const chapter = /^book chapter$/i.test(clean(paper.category));
    const book = /book/i.test(paper.category || '');
    const type = chapter ? 'incollection' : book ? (/\/book\//.test(paperUrlFor(paper)) ? 'book' : 'misc') : journal ? 'article' : 'inproceedings';
    let venue = rawVenue.replace(/,\s*(?:vol\.|no\.|pp\.|Article)\s*.*$/i, '');
    if (/proceedings of the acm on human-computer interaction|acm hum\.-comput\. interact/i.test(venue)) {
        venue = 'Proceedings of the ACM on Human-Computer Interaction';
    }
    const fields = [
        ['title', `{${tex(title)}}`],
        ['author', authors.map(tex).join(' and ')],
        ['year', String(year)],
    ];
    if (venue && (chapter || !book)) fields.push([journal && !chapter ? 'journal' : 'booktitle', tex(venue)]);
    if (chapter && paper.publisher) fields.push(['publisher', tex(paper.publisher)]);
    const volume = rawVenue.match(/\bvol\.\s*([\w.-]+)/i);
    const number = rawVenue.match(/\bno\.\s*([\w.-]+)/i);
    const pages = clean(paper.pages).match(/^(\d+(?:[-–]\d+)?)$/) || rawVenue.match(/\bpp\.\s*(\d+(?:[-–]\d+)?)/i);
    if (volume) fields.push(['volume', volume[1]]);
    if (number) fields.push(['number', number[1]]);
    if (pages) fields.push(['pages', pages[1].replace(/[-–]/g, '--')]);
    const doi = doiFor(paper);
    if (doi) fields.push(['doi', doi]);
    const url = paperUrlFor(paper);
    if (url) fields.push(['url', url.replace(/[{}]/g, (character) => `\\${character}`)]);
    return `@${type}{${id},\n${fields.map(([key, value]) => `  ${key} = {${value}}`).join(',\n')}\n}`;
}

const PACMHCI = /proceedings of the acm on human[- ]computer interaction|\bacm hum\.-comput\. interact\.?|\bpacmhci\b/i;
// Issue or conference program verified for records whose source omits the track.
const CSCW_TRACKS = new Map([
    ['10.1145/3449083', 'CSCW1'], ['10.1145/3449086', 'CSCW1'],
    ['10.1145/3555084', 'CSCW2'], ['10.1145/3555124', 'CSCW2'],
    ['10.1145/3555210', 'CSCW2'], ['10.1145/3555553', 'CSCW2'],
    ['10.1145/3555555', 'CSCW2'], ['10.1145/3555597', 'CSCW2'],
    ['10.1145/3711087', 'CSCW'], ['10.1145/3757461', 'CSCW'],
    ['10.1145/3816913', 'CSCW'],
]);

function trackFor(paper, venue) {
    if (!PACMHCI.test(venue)) return '';
    return venue.match(/\b(?:CSCW[12]?|ISS)\b/i)?.[0].toUpperCase() || CSCW_TRACKS.get(doiFor(paper)) || '';
}

const VENUE_MARKS = [
    [/\bISS\b|interactive surfaces and spaces/i, ['iss-{year}', 'acm']],
    [/computer[- ]supported cooperative work|\bCSCW\d*\b/i, ['cscw-{year}', 'acm']],
    [PACMHCI, ['pacmhci', 'acm']],
    [/transactions on computer-human interaction|\bTOCHI\b/i, ['tochi', 'acm']],
    [/transactions on interactive intelligent systems|\bTiiS\b/i, ['tiis', 'acm']],
    [/computing and cultural heritage|\bJOCCH\b/i, ['jocch', 'acm']],
    [/user interface software and technology|\bUIST\b/i, ['uist-{year}', 'acm']],
    [/intelligent user interfaces|\bIUI\d*\b/i, ['iui-{year}', 'acm']],
    [/creativity and cognition/i, ['cc-{year}', 'acm']],
    [/designing interactive systems|\bDIS\s?\d{0,4}\b/i, ['dis-{year}', 'acm']],
    [/mobile human-computer interaction|MobileHCI/i, ['mobilehci-{year}', 'acm']],
    [/human factors in computing systems|\bCHI\s?\d{0,4}\b|alt\.chi/i, ['chi-{year}', 'acm']],
    [/learning at scale|L@S/i, ['las-{year}', 'acm']],
    [/computers and accessibility|SIGACCESS|\bASSETS\d*/i, ['assets-{year}', 'sigaccess', 'acm']],
    [/the web conference|\bWWW\s?\d{0,4}\b/i, ['www-{year}', 'acm']],
    [/ubicomp/i, ['ubicomp-{year}', 'acm']],
    [/SIGGRAPH Asia/i, ['siggraph-asia-{year}', 'acm']],
    [/ACM Multimedia/i, ['acmmm-{year}', 'acm']],
    [/EMNLP/i, ['emnlp-{year}', 'acl']],
    [/COLING|PEOPLES/i, ['coling-{year}', 'acl']],
    [/ICWSM/i, ['icwsm-{year}', 'aaai']],
    [/\bAAAI/i, ['aaai-{year}', 'aaai']],
    [/association for computational linguistics|\bACL\s?\d{0,4}\b/i, ['acl-{year}', 'acl']],
    [/ECCV/i, ['eccv-{year}', 'springer']],
    [/IJCAI/i, ['ijcai-{year}', 'ijcai']],
    [/pacific ?vis/i, ['pacificvis-{year}', 'pacificvis', 'ieee']],
    [/EuroVis/i, ['eurovis-{year}', 'eurographics']],
    [/computer graphics forum/i, ['cgf-logo', 'cgf', 'eurographics']],
    [/visualization and computer graphics|\bTVCG\b/i, ['tvcg', 'ieee']],
    [/\bVIS\b|\bVAST\d*|visualization and visual analytics/i, ['vis-{year}', 'ieee']],
    [/cognitive and developmental systems/i, ['tcds', 'ieee']],
    [/intelligent transportation systems/i, ['t-its', 'ieee-itss', 'ieee']],
    [/information forensics/i, ['tifs', 'ieee']],
    [/industrial informatics/i, ['tii', 'ieee']],
    [/multimedia and expo|\bICME\b/i, ['icme-{year}', 'ieee']],
    [/\bICDM\d*/i, ['icdm-{year}', 'ieee']],
    [/\bUIC\d*/i, ['uic-{year}', 'ieee']],
    [/human\s*-\s*computer studies|\bIJHCS\b/i, ['ijhcs-logo', 'ijhcs', 'elsevier']],
    [/^artificial intelligence$/i, ['aij', 'elsevier']],
    [/international journal of human-computer interaction|\bIJHCI\b/i, ['ijhci', 'taylor-francis']],
    [/interacting with computers/i, ['iwc']],
    [/social robotics/i, ['ijsr', 'springer']],
    [/language resources and evaluation/i, ['lre', 'springer']],
    [/information design journal/i, ['idj']],
    [/^information$/i, ['information']],
    [/design (?:&|and) emotion/i, ['design-emotion-{year}', 'central-saint-martins']],
    [/cuteness engineering/i, ['springer']],
    [/cartography and geographic information science|^data analytics applications in gaming and entertainment$/i, ['taylor-francis']],
    [/\bIEEE\b/i, ['ieee']],
    [/\bACM\b/i, ['acm']],
];

function venueMatch(paper, year, marks) {
    const venue = clean(paper.venue);
    const track = trackFor(paper, venue);
    const rule = VENUE_MARKS.find(([pattern]) => pattern.test(track || venue));
    if (!rule) return { key: '', track };
    const [, keys] = rule;
    const key = keys.map((candidate) => candidate.replace('{year}', year))
        .find((candidate) => marks[candidate]?.src) || '';
    return { key, track };
}

function venueKeyFor(paper, year, marks = {}) {
    return venueMatch(paper, year, marks).key;
}

function publicationView(paper, year, marks = {}, images = {}) {
    const title = clean(paper.title) || clean(paper.venue);
    const identity = doiFor(paper) || `${year}|${title}`;
    const id = `pub-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
    const { key, track } = venueMatch(paper, year, marks);
    const mark = marks[key];
    const replacement = images[id];
    const media = replacement && replacement.src
        ? { src: replacement.src, alt: replacement.alt || `Figure from ${title}`, isLogo: false }
        : mark
            ? { src: mark.src, alt: mark.label, isLogo: true, tone: mark.tone || 'light' }
            : null;
    const venue = clean(paper.venue);
    let displayVenue = clean(paper.title) ? venue : '';
    if (displayVenue && track && !displayVenue.toUpperCase().includes(track)) {
        displayVenue = `${track} ${year} · ${displayVenue}`;
    }
    if (/^CHI Conference on Human Factors in Computing Systems\b/i.test(displayVenue)) {
        displayVenue = `Proceedings of the ${year} ${displayVenue}`;
    }
    if (displayVenue && paper.publisher) displayVenue = `${displayVenue} · ${paper.publisher}`;
    return {
        id,
        displayTitle: title,
        paperUrl: paperUrlFor(paper),
        bibtex: citationFor(paper, year, id),
        media,
        venueKey: key,
        displayVenue,
    };
}

module.exports = { publicationView, authorsFor, doiFor, paperUrlFor, citationFor, venueKeyFor };
