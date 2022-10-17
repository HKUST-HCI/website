const defaultTheme = require('tailwindcss/defaultTheme')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js,mustache}"
  ],
  theme: {
    extend: {
      listStyleType: {
        square: 'square',
        circle: 'circle',
      },
      fontFamily: {
        title: ['Montserrat', ...defaultTheme.fontFamily.sans],
      },
      aspectRatio: {
        '5/6': '5 / 6'
      },
      width: {
        '38': '9.5rem',
      }
    },
  },
  plugins: [],
}
