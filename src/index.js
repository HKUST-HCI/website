document.addEventListener('DOMContentLoaded', function () {
    const root = document.querySelector('.community-gallery')
    if (!root || typeof EmblaCarousel !== 'function' || typeof EmblaCarouselAutoScroll !== 'function') return

    const viewport = root.querySelector('.community-viewport')
    const controls = root.querySelector('.community-controls')
    const toggle = root.querySelector('[data-gallery-toggle]')
    const toggleIcon = toggle.querySelector('i')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let paused = motion.matches
    let hovered = false
    let focused = false
    let dragging = false
    let inView = true
    const autoScroll = EmblaCarouselAutoScroll({
        speed: 0.45,
        startDelay: 0,
        playOnInit: false,
        stopOnInteraction: true,
        stopOnMouseEnter: false,
        stopOnFocusIn: false,
    })
    const carousel = EmblaCarousel(viewport, {
        loop: true,
        align: 'start',
        dragFree: true,
        containScroll: false,
    }, [autoScroll])
    root.classList.add('is-enhanced')
    controls.hidden = false

    function updatePlayback() {
        const shouldPlay = !paused && !hovered && !focused && !dragging && inView && !document.hidden
        if (shouldPlay) autoScroll.play()
        else autoScroll.stop()
        toggleIcon.className = paused ? 'fa-solid fa-play' : 'fa-solid fa-pause'
        toggle.setAttribute('aria-label', paused ? 'Play automatic photo scrolling' : 'Pause automatic photo scrolling')
        viewport.setAttribute('aria-live', shouldPlay ? 'off' : 'polite')
    }

    function step(direction) {
        paused = true
        updatePlayback()
        if (direction < 0) carousel.scrollPrev(motion.matches)
        else carousel.scrollNext(motion.matches)
    }

    root.querySelector('[data-gallery-prev]').addEventListener('click', function () { step(-1) })
    root.querySelector('[data-gallery-next]').addEventListener('click', function () { step(1) })
    toggle.addEventListener('click', function () {
        paused = !paused
        if (!paused) focused = false // An explicit Play action opts into motion while the control is focused.
        updatePlayback()
    })
    viewport.addEventListener('mouseenter', function () { hovered = true; updatePlayback() })
    viewport.addEventListener('mouseleave', function () { hovered = false; updatePlayback() })
    root.addEventListener('focusin', function (event) {
        focused = event.target.matches(':focus-visible')
        updatePlayback()
    })
    root.addEventListener('focusout', function (event) {
        if (!root.contains(event.relatedTarget)) { focused = false; updatePlayback() }
    })
    viewport.addEventListener('keydown', function (event) {
        if (event.target !== viewport || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault()
        step(event.key === 'ArrowLeft' ? -1 : 1)
    })
    carousel.on('pointerDown', function () { dragging = true; focused = false; updatePlayback() })
    carousel.on('pointerUp', function () { dragging = false; updatePlayback() })
    carousel.on('reInit', updatePlayback)
    document.addEventListener('visibilitychange', updatePlayback)
    motion.addEventListener('change', function (event) {
        if (event.matches) paused = true
        updatePlayback()
    })
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            inView = entries[0].isIntersecting
            updatePlayback()
        }).observe(root)
    }
    updatePlayback()
})
