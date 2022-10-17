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
        tooltip.setAttribute('data-show', '')

        const { target } = e
        popperInstance.state.elements.reference = target
        const { name, position, url } = target.parentElement.dataset
        tooltipName.textContent = name
        tooltipPosition.textContent = position
        tooltipLink.href = url

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

    buttons.forEach(button => {
        button.addEventListener('focus', show)
        button.addEventListener('blur', hide)
    })
})