const themeStorageKey = 'hci-initiative-theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

function readSavedTheme() {
    try {
        const savedTheme = window.localStorage.getItem(themeStorageKey)
        return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null
    } catch (error) {
        return null
    }
}

function saveTheme(theme) {
    try {
        window.localStorage.setItem(themeStorageKey, theme)
    } catch (error) {
        // The theme still applies to the current page when storage is unavailable.
    }
}

function readRequestedTheme() {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme')
    return requestedTheme === 'light' || requestedTheme === 'dark' ? requestedTheme : null
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
}

function renderThemeToggle() {
    const toggle = document.getElementById('theme-toggle')
    if (!toggle) return

    if (!toggle.querySelector('.theme-toggle-icon')) {
        toggle.innerHTML = `
            <svg class="theme-toggle-icon theme-toggle-icon--sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path>
            </svg>
            <svg class="theme-toggle-icon theme-toggle-icon--moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path>
            </svg>`
    }

    const switchingToLight = document.documentElement.dataset.theme === 'dark'
    const label = switchingToLight ? 'Switch to day mode' : 'Switch to night mode'
    toggle.setAttribute('aria-label', label)
    toggle.title = label
}

function switchTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
    saveTheme(nextTheme)
    renderThemeToggle()
}

applyTheme(readRequestedTheme() || readSavedTheme() || (systemTheme.matches ? 'dark' : 'light'))

// Event delegation works even if the header button is rendered later.
document.addEventListener('click', function (event) {
    const target = event.target.closest ? event.target.closest('#theme-toggle') : null
    if (!target) return
    event.preventDefault()
    switchTheme()
})

document.addEventListener('DOMContentLoaded', function () {
    const scrollRegion = document.getElementById('site-scroll')
    if (scrollRegion) {
        function syncScrollGutter() {
            const width = scrollRegion.offsetWidth - scrollRegion.clientWidth
            document.documentElement.style.setProperty('--site-scrollbar-width', `${width}px`)
        }
        syncScrollGutter()
        if ('ResizeObserver' in window) new ResizeObserver(syncScrollGutter).observe(scrollRegion)
        else window.addEventListener('resize', syncScrollGutter, { passive: true })
    }
    const nav = document.getElementById('site-nav')

    if (nav) {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html'
        nav.querySelectorAll('a[href]').forEach(function (link) {
            if (link.getAttribute('href') === currentPage) link.setAttribute('aria-current', 'page')
        })
    }

    if (nav && nav.querySelector('ul') && !document.getElementById('theme-toggle')) {
        const toggleItem = document.createElement('li')
        toggleItem.className = 'theme-toggle-item'
        toggleItem.innerHTML = '<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to day mode"></button>'
        nav.querySelector('ul').appendChild(toggleItem)
    }

    renderThemeToggle()
})

function followSystemTheme(event) {
    if (readSavedTheme()) return
    applyTheme(event.matches ? 'dark' : 'light')
    renderThemeToggle()
}

if (typeof systemTheme.addEventListener === 'function') {
    systemTheme.addEventListener('change', followSystemTheme)
} else if (typeof systemTheme.addListener === 'function') {
    systemTheme.addListener(followSystemTheme)
}
