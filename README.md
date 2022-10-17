# HKUST HCI Website

## For maintainer

### What to edit

All content data are abstracted into `src/data/*.json`.
To change the content without modifying the page structures,

* Edit corresponding JSON files
* Git commit, push.
* Monitor the progress at GitHub Action

### Secrets and credentials

Automatic CD is configured using GitHub Actions.
When a new maintainer takes over this website, he/she should do the following:
* Go ask for access to the HCI website directory on the departmental ras server. (CS System will add your account to an authorized user group; prior endorsement email from prof may be needed)
* Create an SSH keypair on your local machine by `ssh-keygen` command
  * It is suggested to generate a *dedicated keypair for CI/CD platforms* instead of using the same keypair at your local device by your own
  * Example command of my keypair generation: `ssh-keygen -f ~/.ssh/hci_ras_ed25519 -t ed25519 -C "Created by email@connect.ust.hk SURNAME First Name for CI tools to access HCI Lab content at HKUST CSE ras server"`
* Copy the SSH key to the server by `ssh-copy-id`
  * Example command: `ssh-copy-id -i .ssh/hci_ras_ed25519 username@ras.server.url`
* Test SSH connection via the keypair
  * Example command: `ssh -i .ssh/hci_ras_ed25519 username@ras.server.url`
* At the GitHub repository page, goto Settings – Security:Actions and change the following repository secrets
  * RAS_DEPLOY_USER: your username to log in to ras server
  * RAS_DEPLOY_KEY: your private key (`.ssh/hci_ras_ed25519` in the above example) content (yes, it is pure text. Just open it and copy-paste)

## For developer

### Specs

The project currently uses
* [pnpm](https://pnpm.io/) **instead of** npm for node package management. Please install it and use `pnpm i`, etc. instead of `npm i`.
* [Mustache](https://github.com/janl/mustache.js) for content templating and data management
* [Tailwindcss](https://tailwindcss.com/docs) for styling
* [Popper](https://popper.js.org/) library for tooltip
* No framework
* [Grunt](https://gruntjs.com/) to manage build tasks (mustache, tailwind, etc.)
* [GitHub Actions](https://docs.github.com/cn/actions/quickstart) for CI/CD.

The current philosophy is as follows
* Since the content is rather static, bake as many data at build-time as possible.
For example, don't host a `news.json` on the server and let the website fetch it on every refresh.
Instead, compile a mustache template HTML with `news.json` to get a static HTML.
* Since content data are mostly compiled, use JS mainly for interactive widgets.

### Get it running

* Install node environment
* Install pnpm
  * If you don't have node installed, you can also install pnpm as standable app, then install node environment from pnpm
* Run `pnpm i` to install dependencies
* Run `pnpm run build` or `pnpm grunt` or `npx grunt` or `npm run build` (They are the same) to build changes on local machine
* Run `pnpm run watch` or `pnpm grunt watch` or `npx grunt watch` or `npm run watch` (they are the same) to watch changes and build on save
* Local builds are at `build/`. View it with your preferred tools (e.g., VS Code Live preview extension)

### Notes

There is an `html` VS Code snippet.

Mustache is a logic-less template language. The only *if* is whether a variable is falsy or empty.
For other conditional logics (assign a color to each role),
add a `dataPreprocessor` at `scripts/mustache.js` with the corresponding JSON file's name,
where you can change value or add fields.
Examples include
* generating `maintainer.json`s' `url` fields from `people.json` (to ensure single source of truth)
* generating `publications.json`'s `authorLine` fields from `authors` (to add commas and "and"s)

Tailwindcss is a utility-first CSS library.
**It encourages you to write bunches of utility classes instead of a single named class with complex CSS definitions.**
This makes issues easier to track, and styling more straightforward.
Many redundant code issue can be solved by templating (mustache in this case).
Custom utility classes can be added in `tailwind.config.js` (refer to [their doc here](https://tailwindcss.com/docs/adding-custom-styles)).
Custom named classes are defined in `src/tailwind.css`.
Examples are
* `card` for white shadowed area
  * because it is too common and not templatable (not gathering at one place)
* `link` for normal `<a>` hyperlinks, and `list` for normal bullet point `ul`, `ol`.
  * Because they are too common. Didn't apply to all a's an ul's because some are used as buttons, navs, etc. with alternative styling.
* `tooltips` for popper tooltips
  * Because they are library related. Should be defined for once are don't care at all.
Refer to their website for [more tailwindcss philosophy](https://tailwindcss.com/docs/utility-first).

**You can visit the JSON data file inside mustache template by their file names.**
The build script provides the JSON data as-is by file names.

**Use camelCases for any content data file in `data/*.json`.**
This ensures the build script to make data visible to mustache without any accident.
But **use kebab-cases for any other resource files** (images, folders, JS, HTML/mustache...) to avoid unexpectedly broken URL on case-sensitive systems.

`main.js` is included on every page. Other `.js` files are named after HTML/mustache files and imported by each page.

### Current performance compromises

At build time
- [ ] In grunt, the `mustache` task always compiles all pages. Perhaps grunt-newer can somehow tell the task about the modified pages.

At runtime
- [ ] ...