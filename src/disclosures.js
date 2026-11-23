;(function () {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const detailControllers = new WeakMap()
    const allControllers = new Set()
    const duration = 280
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'

    function createController(element, hooks) {
        const parts = hooks.parts
        const original = { height: element.style.height, overflow: element.style.overflow }
        let expanded = hooks.read()
        let animation = null
        let fades = []
        let resolvePending = null
        let completion = null

        function clearEffects(result) {
            if (animation) { animation.onfinish = null; animation.cancel(); animation = null }
            fades.forEach(function (fade) { fade.cancel() })
            fades = []
            if (resolvePending) { const resolve = resolvePending; resolvePending = null; resolve(result) }
            completion = null
        }
        function restore() {
            element.style.height = original.height
            element.style.overflow = original.overflow
            parts.forEach(function (part) { part.inert = false })
        }
        function finish() {
            hooks.write(expanded)
            hooks.render(expanded)
            restore()
            clearEffects(true)
        }
        function setOpen(next, options = {}) {
            next = Boolean(next)
            if (next === expanded && !animation) return Promise.resolve(true)
            const wasOpen = hooks.read()
            const startHeight = element.getBoundingClientRect().height
            const startOpacity = parts.map(function (part) { return getComputedStyle(part).opacity })
            const startStyle = getComputedStyle(element)
            const startMargins = { marginTop: wasOpen ? startStyle.marginTop : '0px', marginBottom: wasOpen ? startStyle.marginBottom : '0px' }
            clearEffects(false)
            restore()
            expanded = next
            hooks.render(expanded)
            if (!expanded && element.contains(document.activeElement) && document.activeElement !== hooks.trigger) {
                hooks.trigger.focus({ preventScroll: true })
            }
            hooks.write(true)
            const targetHeight = expanded ? element.getBoundingClientRect().height : hooks.closedHeight()
            if (options.animate === false || reducedMotion.matches || typeof element.animate !== 'function' || !element.getClientRects().length) {
                finish()
                return Promise.resolve(true)
            }
            const from = { height: startHeight + 'px' }
            const to = { height: targetHeight + 'px' }
            if (hooks.animateMargins) {
                const natural = getComputedStyle(element)
                Object.assign(from, startMargins)
                Object.assign(to, { marginTop: expanded ? natural.marginTop : '0px', marginBottom: expanded ? natural.marginBottom : '0px' })
            }
            element.style.height = startHeight + 'px'
            element.style.overflow = 'hidden'
            if (!expanded) parts.forEach(function (part) { part.inert = true })
            completion = new Promise(function (resolve) {
                resolvePending = resolve
                animation = element.animate([from, to], { duration, easing, fill: 'forwards' })
                fades = parts.map(function (part, index) {
                    return part.animate([{ opacity: wasOpen ? startOpacity[index] : 0 }, { opacity: expanded ? 1 : 0 }], {
                        duration: expanded ? 220 : 180, easing, fill: 'forwards',
                    })
                })
                animation.onfinish = finish
            })
            return completion
        }
        const controller = { setOpen, finish, isOpen: () => expanded, isAnimating: () => Boolean(animation), pending: () => completion }
        hooks.render(expanded)
        allControllers.add(controller)
        return controller
    }

    function getDetailsController(details) {
        if (detailControllers.has(details)) return detailControllers.get(details)
        const summary = details.querySelector(':scope > summary')
        if (!summary) return null
        const parts = Array.from(details.children).filter(child => child !== summary)
        const controller = createController(details, {
            parts,
            trigger: summary,
            read: () => details.open,
            write: open => { details.open = open },
            closedHeight: () => {
                const style = getComputedStyle(details)
                const summaryStyle = getComputedStyle(summary)
                return summary.getBoundingClientRect().height +
                    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
                    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) +
                    parseFloat(summaryStyle.marginTop) + parseFloat(summaryStyle.marginBottom)
            },
            render: open => {
                details.dataset.disclosureOpen = String(open)
                summary.setAttribute('aria-expanded', String(open))
            },
        })
        detailControllers.set(details, controller)
        const icon = document.createElement('span')
        icon.className = 'disclosure-icon'
        icon.setAttribute('aria-hidden', 'true')
        const iconHost = summary.querySelector('.pub-year-title') || summary
        if (details.classList.contains('home-news-year')) iconHost.appendChild(icon)
        else iconHost.prepend(icon)
        details.classList.add('animated-disclosure')
        summary.addEventListener('click', function (event) {
            if (event.defaultPrevented || event.button !== 0 || event.target.closest('a, button, input, select, textarea')) return
            event.preventDefault()
            controller.setOpen(!controller.isOpen())
        })
        details.addEventListener('toggle', function () {
            if (!controller.isAnimating() && details.open !== controller.isOpen()) {
                controller.setOpen(details.open, { animate: false })
            }
        })
        return controller
    }

    window.SiteDisclosures = {
        setOpen: function (details, open, options) {
            const controller = getDetailsController(details)
            if (controller) return controller.setOpen(open, options)
            details.open = open
            return Promise.resolve(true)
        },
        isOpen: function (details) { return getDetailsController(details)?.isOpen() ?? details.open },
        whenSettled: function (details) {
            const controllers = Array.from(details, getDetailsController).filter(Boolean)
            function wait() {
                const pending = controllers.map(controller => controller.pending()).filter(Boolean)
                return pending.length ? Promise.all(pending).then(wait) : Promise.resolve()
            }
            return wait()
        },
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('details').forEach(getDetailsController)
        const nav = document.getElementById('site-nav')
        const button = document.getElementById('mobile-nav-button')
        const desktop = window.matchMedia('(min-width: 768px)')
        if (!nav || !button) return
        const controller = createController(nav, {
            parts: Array.from(nav.children),
            trigger: button,
            read: () => !nav.classList.contains('hidden'),
            write: open => { nav.classList.toggle('hidden', !open) },
            closedHeight: () => 0,
            animateMargins: true,
            render: open => {
                button.setAttribute('aria-expanded', String(open))
                button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
            },
        })
        nav.classList.add('animated-mobile-nav')
        button.addEventListener('click', function () {
            if (!desktop.matches) controller.setOpen(!controller.isOpen())
        })
        nav.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape' || desktop.matches || !controller.isOpen()) return
            event.preventDefault()
            controller.setOpen(false)
            button.focus({ preventScroll: true })
        })
        desktop.addEventListener('change', function () {
            controller.setOpen(false, { animate: false })
        })
    })

    function finishAnimations() {
        allControllers.forEach(function (controller) {
            if (controller.isAnimating()) controller.finish()
        })
    }
    reducedMotion.addEventListener('change', finishAnimations)
    window.addEventListener('resize', finishAnimations)
})()
