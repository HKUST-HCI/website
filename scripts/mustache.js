const fs = require('fs');
const mustache = require('mustache');

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

const PEOPLE = JSON.parse(fs.readFileSync(`./src/data/people.json`, 'utf8').toString());
const PEOPLE_NAME_BY_URL = PEOPLE.reduce((acc, {members}) => {
    const group = members.reduce((accMembers, {name, url}) => ({
        ...accMembers,
        [name]: url,
    }), {})
    return {
        ...acc,
        ...group
    }
}, {})

const dataPreprocessors = {
    publications: (data) => {
        data.forEach(year => {
            year.papers.forEach(publication => {
                if (!publication.authorLine && !!publication.authors) {
                    publication.authorLine = publication.authors.join(', ');
                }
            })
        });
        return data;
    },
    people: (data) => {
        data.forEach(group => {
            group.members.forEach(person => {
                person.color = classColor[person.class] || classColor.default;
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
        data.maintainers.forEach(p => {
            if (!p.url) {
                p.url = PEOPLE_NAME_BY_URL[p.name] || '#'
            }
        })
        return data
    }
    // ongoingProjects: (data) => {
    //     data.forEach(op => {
    //         if (!op.url)
    //     })
    // }
}

const data = fs.readdirSync('./src/data')
    .filter(file => file.endsWith('.json') && file != 'people.json')
    .reduce((acc, file) => {
        const name = file.split('.')[0];
        let d = JSON.parse(fs.readFileSync(`./src/data/${file}`, 'utf8').toString());
        if (dataPreprocessors[name]) {
            d = dataPreprocessors[name](d);
        }
        return { ...acc, [name]: d }
    }, {});

// }}}

pages.forEach(page => {
    const name = page.split('.')[0];
    const template = fs.readFileSync(`./src/${page}`).toString();
    const html = mustache.render(template, data, partials);
    fs.writeFileSync(`./build/${name}.html`, html);
});
