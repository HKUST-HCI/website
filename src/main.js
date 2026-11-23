const themeStorageKey = 'hci-initiative-theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: light)')

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

    const switchingToLight = document.documentElement.dataset.theme === 'dark'
    toggle.setAttribute('aria-live', 'polite')
    toggle.setAttribute('aria-label', switchingToLight ? 'Switch to day mode' : 'Switch to night mode')
    toggle.title = switchingToLight ? 'Day mode' : 'Night mode'
    toggle.innerHTML = switchingToLight
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z"></path></svg>'
}

function switchTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
    saveTheme(nextTheme)
    renderThemeToggle()
}

applyTheme(readRequestedTheme() || readSavedTheme() || (systemTheme.matches ? 'light' : 'dark'))

// Event delegation works even if the header button is rendered later.
document.addEventListener('click', function (event) {
    const target = event.target.closest ? event.target.closest('#theme-toggle') : null
    if (!target) return
    event.preventDefault()
    switchTheme()
})

document.addEventListener('DOMContentLoaded', function () {
    const nav = document.getElementById('site-nav')
    const mobileNavButton = document.getElementById('mobile-nav-button')

    if (nav && mobileNavButton) {
        mobileNavButton.addEventListener('click', function () {
            nav.classList.toggle('hidden')
        })
    }

    if (nav && nav.querySelector('ul') && !document.getElementById('theme-toggle')) {
        const toggleItem = document.createElement('li')
        toggleItem.className = 'theme-toggle-item'
        toggleItem.innerHTML = '<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to day mode"><span aria-hidden="true">&#9675;</span></button>'
        nav.querySelector('ul').appendChild(toggleItem)
    }

    renderThemeToggle()
})

function followSystemTheme(event) {
    if (readSavedTheme()) return
    applyTheme(event.matches ? 'light' : 'dark')
    renderThemeToggle()
}

if (typeof systemTheme.addEventListener === 'function') {
    systemTheme.addEventListener('change', followSystemTheme)
} else if (typeof systemTheme.addListener === 'function') {
    systemTheme.addListener(followSystemTheme)
}
