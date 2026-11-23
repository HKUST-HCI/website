(function () {
    'use strict'

    document.querySelectorAll('.life-gallery').forEach(function (gallery) {
        Array.from(gallery.children)
            .sort(function (first, second) {
                var firstDate = first.querySelector('.life-date').textContent.trim()
                var secondDate = second.querySelector('.life-date').textContent.trim()
                return Date.parse(secondDate) - Date.parse(firstDate)
            })
            .forEach(function (activity) {
                gallery.appendChild(activity)
            })
    })

    document.querySelectorAll('.life-carousel').forEach(function (carousel) {
        const track = carousel.querySelector('.life-slides')
        const slides = Array.from(track.querySelectorAll('img'))
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
        let index = 0, timer = null, hovered = false, focused = false, inView = false
        let pausedByUser = reducedMotion.matches
        let pointer = null

        slides.forEach(function (slide) {
            slide.draggable = false
            function markPortrait() {
                if (slide.naturalHeight > slide.naturalWidth) {
                    slide.classList.add('is-portrait')
                }
            }
            if (slide.complete) markPortrait()
            else slide.addEventListener('load', markPortrait, { once: true })
        })
        if (slides.length < 2) {
            if (slides[0]) slides[0].classList.add('is-active')
            return
        }

        carousel.setAttribute('role', 'region')
        carousel.setAttribute('aria-roledescription', 'carousel')
        carousel.setAttribute('tabindex', '0')

        const dotContainer = document.createElement('div')
        dotContainer.className = 'life-carousel-dots'
        const dots = slides.map(function (_, slideIndex) {
            const dot = document.createElement('button')
            dot.type = 'button'
            dot.setAttribute('aria-label', 'Show photo ' + (slideIndex + 1))
            dot.addEventListener('click', function () { show(slideIndex, true) })
            dotContainer.appendChild(dot)
            return dot
        })
        carousel.appendChild(dotContainer)

        const prev = document.createElement('button')
        prev.className = 'life-carousel-prev'
        prev.type = 'button'
        prev.setAttribute('aria-label', 'Previous photo')
        prev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"></path></svg>'
        const next = document.createElement('button')
        next.className = 'life-carousel-next'
        next.type = 'button'
        next.setAttribute('aria-label', 'Next photo')
        next.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6l6 6-6 6"></path></svg>'
        const play = document.createElement('button')
        play.className = 'life-carousel-play'
        play.type = 'button'
        const status = document.createElement('span')
        status.className = 'sr-only'
        status.setAttribute('aria-live', 'polite')
        carousel.append(prev, next, play, status)

        function stop() {
            window.clearTimeout(timer)
            timer = null
        }
        function canPlay() {
            const group = carousel.closest('details')
            return !pausedByUser && !reducedMotion.matches && !hovered && !focused
                && inView && !document.hidden && (!group || group.open)
        }
        function schedule() {
            stop()
            if (canPlay()) timer = window.setTimeout(function () { show(index + 1, false) }, Number(carousel.dataset.interval) || 5000)
        }
        function show(nextIndex, manual) {
            if (nextIndex < 0 || nextIndex >= slides.length) {
                track.classList.add('is-resetting')
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { track.classList.remove('is-resetting') })
                })
            }
            index = (nextIndex + slides.length) % slides.length
            track.style.transform = `translateX(${-index * 100}%)`
            slides.forEach(function (slide, i) {
                slide.classList.toggle('is-active', i === index)
                slide.setAttribute('aria-hidden', String(i !== index))
            })
            dots.forEach(function (dot, i) {
                dot.classList.toggle('is-active', i === index)
                if (i === index) dot.setAttribute('aria-current', 'true')
                else dot.removeAttribute('aria-current')
            })
            if (manual) status.textContent = `Photo ${index + 1} of ${slides.length}`
            schedule()
        }
        function updatePlayButton() {
            play.hidden = reducedMotion.matches
            play.style.display = reducedMotion.matches ? 'none' : ''
            play.setAttribute('aria-label', pausedByUser ? 'Play slideshow' : 'Pause slideshow')
            play.setAttribute('aria-pressed', String(!pausedByUser))
            play.innerHTML = pausedByUser
                ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="9,6 18,12 9,18"></polygon></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6v12M15 6v12"></path></svg>'
        }

        prev.addEventListener('click', function () { show(index - 1, true) })
        next.addEventListener('click', function () { show(index + 1, true) })
        play.addEventListener('click', function () {
            pausedByUser = !pausedByUser
            updatePlayButton()
            schedule()
        })
        carousel.addEventListener('mouseenter', function () { hovered = true; schedule() })
        carousel.addEventListener('mouseleave', function () { hovered = false; schedule() })
        carousel.addEventListener('focusin', function () { focused = true; schedule() })
        carousel.addEventListener('focusout', function (event) {
            focused = carousel.contains(event.relatedTarget)
            schedule()
        })
        carousel.addEventListener('keydown', function (event) {
            if (event.target.matches('input, textarea, [contenteditable]')) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                show(index + (event.key === 'ArrowRight' ? 1 : -1), true)
            }
        })
        track.addEventListener('pointerdown', function (event) {
            if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
            pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
            stop()
        })
        track.addEventListener('pointerup', function (event) {
            if (!pointer || pointer.id !== event.pointerId) return
            const dx = event.clientX - pointer.x
            const dy = event.clientY - pointer.y
            pointer = null
            if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2) show(index + (dx < 0 ? 1 : -1), true)
            else schedule()
        })
        track.addEventListener('pointercancel', function () {
            pointer = null
            schedule()
        })
        const observer = new IntersectionObserver(function (entries) {
            inView = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.25
            schedule()
        }, { threshold: 0.25 })
        observer.observe(carousel)
        document.addEventListener('visibilitychange', schedule)
        const group = carousel.closest('details')
        if (group) group.addEventListener('toggle', schedule)
        reducedMotion.addEventListener('change', function () {
            if (reducedMotion.matches) pausedByUser = true
            updatePlayButton()
            schedule()
        })
        updatePlayButton()
        show(0, false)
    })
}())
