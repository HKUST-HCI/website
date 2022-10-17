document.addEventListener('DOMContentLoaded', function () {
    const nav = document.getElementById('site-nav')
    document
        .getElementById('mobile-nav-button')
        .addEventListener('click', function () {
            nav.classList.toggle('hidden')
        })
})