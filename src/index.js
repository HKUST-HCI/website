document.addEventListener('DOMContentLoaded', function() {
    (function () {
        let autoSlideTimeout = null;
        let sliderIndex = 0;
        const sliderPrev = document.getElementById('slider-control-prev')
        const sliderNext = document.getElementById('slider-control-next')
        const sliderLength = document.getElementById('slider-slides').children.length

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
})
