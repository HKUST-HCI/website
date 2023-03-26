document.addEventListener('DOMContentLoaded', function () {
    const buttons = document.querySelectorAll('.avatar button')
    const tooltip = document.getElementById('mobile-person-tooltip')
    const tooltipName = tooltip.getElementsByClassName('name')[0]
    const tooltipPosition = tooltip.getElementsByClassName('position')[0]
    const tooltipLink = tooltip.getElementsByTagName('a')[0]


    const popperInstance = Popper.createPopper(buttons[0], tooltip, {
        placement: 'bottom',
        modifiers: [
            {
                name: 'offset',
                options: {
                    offset: [0, 10],
                },
            },
            {
                name: 'flip',
                options: {
                    fallbackPlacements: ['top']
                }
            }
        ],
    })

    function show(e) {
        const { target } = e
        const person = target.parentElement.dataset.name
        tooltip.setAttribute('data-show', person)

        popperInstance.state.elements.reference = target
        const { name, position, url } = target.parentElement.dataset
        tooltipName.textContent = name
        tooltipPosition.textContent = position
        if (url) {
            tooltipLink.href = url
            tooltipLink.style.display = 'inline'
        } else {
            tooltipLink.style.display = 'none'
        }

        popperInstance.setOptions((options) => ({
            ...options,
            modifiers: [
                ...options.modifiers,
                { name: 'eventListeners', enabled: true },
            ],
        }));
        popperInstance.update()
    }

    function hide() {
        tooltip.removeAttribute('data-show');

        popperInstance.setOptions((options) => ({
            ...options,
            modifiers: [
                ...options.modifiers,
                { name: 'eventListeners', enabled: false },
            ],
        }));
    }

    /** @param e {MouseEvent} */
    function onClick(e) {
        const { target } = e
        if (!target.matches('.avatar button') && tooltip.dataset.show) {
            return hide()
        }

        const person = target.parentElement.dataset.name
        if (tooltip.dataset.show == person) {
            return hide()
        }
        show(e)
    }

    document.addEventListener('click', onClick)
})