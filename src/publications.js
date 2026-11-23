(function () {
    'use strict'

    const dialog = document.querySelector('.citation-dialog')
    const code = dialog.querySelector('.citation-code')
    const paper = dialog.querySelector('.citation-paper')
    const copy = dialog.querySelector('.citation-copy')
    const download = dialog.querySelector('.citation-download')
    const status = dialog.querySelector('.citation-status')
    let trigger = null
    let filename = ''
    let copyTimer = null

    document.querySelectorAll('[data-citation]').forEach(function (button) {
        button.addEventListener('click', function () {
            trigger = button
            const article = button.closest('article')
            code.textContent = document.getElementById(button.dataset.citation).content.textContent
            paper.textContent = article.querySelector('h3').textContent
            filename = article.id + '.bib'
            status.textContent = ''
            window.clearTimeout(copyTimer)
            copy.textContent = 'Copy'
            dialog.showModal()
        })
    })

    dialog.querySelector('.citation-close').addEventListener('click', function () { dialog.close() })
    dialog.addEventListener('close', function () { if (trigger) trigger.focus() })
    dialog.addEventListener('click', function (event) {
        if (event.target !== dialog) return
        const rect = dialog.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
    })

    copy.addEventListener('click', async function () {
        try {
            await navigator.clipboard.writeText(code.textContent)
            copy.textContent = 'Copied'
            status.textContent = 'Citation copied.'
            window.clearTimeout(copyTimer)
            copyTimer = window.setTimeout(function () { copy.textContent = 'Copy' }, 1500)
        } catch (_) {
            const range = document.createRange()
            range.selectNodeContents(code)
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            status.textContent = 'Select and copy the citation.'
        }
    })
    download.addEventListener('click', function () {
        const blob = new Blob([code.textContent + '\n'], { type: 'application/x-bibtex;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
    })
}())
