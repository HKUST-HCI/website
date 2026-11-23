document.addEventListener('DOMContentLoaded', function() {
    (function () {
        let autoSlideTimeout = null;
        let sliderIndex = 0;
        const sliderPrev = document.getElementById('slider-control-prev')
        const sliderNext = document.getElementById('slider-control-next')
        const sliderSlides = document.getElementById('slider-slides')
        if (!sliderPrev || !sliderNext || !sliderSlides) return
        const sliderLength = sliderSlides.children.length

        function goto(newIndex) {
            newIndex = (newIndex + sliderLength) % sliderLength
            document.querySelector(`#slider-slides > :nth-child(${sliderIndex + 1})`).classList.add('opacity-0')
            sliderIndex = newIndex
            document.querySelector(`#slider-slides > :nth-child(${sliderIndex + 1})`).classList.remove('opacity-0')
            
            if (autoSlideTimeout) clearTimeout(autoSlideTimeout);
            autoSlideTimeout = setTimeout(function () {
                goto(sliderIndex + 1)
            }, 5000);
        }

        goto(0)

        sliderPrev.addEventListener('click', function () {
            goto(sliderIndex - 1)
        })
        sliderNext.addEventListener('click', function () {
            goto(sliderIndex + 1)
        })
    })()

    ;(function () {
        const main = document.querySelector('.home-main-column > main')
        const sidebar = document.querySelector('.home-sidebar')
        const desktop = window.matchMedia('(min-width: 768px)')
        if (!main || !sidebar) return

        let frame = null
        function syncSidebarHeight() {
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(function () {
                sidebar.style.height = desktop.matches ? `${main.getBoundingClientRect().height}px` : ''
                frame = null
            })
        }

        syncSidebarHeight()
        desktop.addEventListener('change', syncSidebarHeight)
        window.addEventListener('resize', syncSidebarHeight, { passive: true })
        if ('ResizeObserver' in window) {
            new ResizeObserver(syncSidebarHeight).observe(main)
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(syncSidebarHeight)
        }
    })()
})
