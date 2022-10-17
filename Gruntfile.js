// See https://gruntjs.com/configuring-tasks for config schema

const gruntConfig = {
    // pkg: grunt.file.readJSON('package.json'), // Not sure what this line is for
    copy: {
        static: {
            files: [
                {
                    expand: true,
                    cwd: 'src/',
                    src: ['{img,projects}/**/*', '**/*.{css,js}', '!tailwind.css'],
                    dest: 'build/',
                },
            ]
        }
    },
    exec: {
        tailwindcss: 'tailwindcss -i ./src/tailwind.css -o ./build/style.css --minify',
        mustache: 'node scripts/mustache.js',
    },
    watch: {
        configFiles: {
            files: ['Gruntfile.js'],
            options: {
              reload: true,
              atBegin: false,
            }
        },
        static: {
            files: [], // to be generated later
            tasks: ['newer:copy:static'],
            options: {
                atBegin: true,
            },
        },
        html: {
            files: ['src/**/*.mustache', 'src/data/*', 'scripts/mustache.js'],
            tasks: ['exec:mustache', 'exec:tailwindcss'],
            options: {
                atBegin: true,
            },
        },
        css: {
            files: ['src/tailwind.css', 'tailwind.config.js'],
            tasks: ['exec:tailwindcss'],
            options: {
                atBegin: false // HTML target already includes this task.
            }
        },
    },
}

gruntConfig.watch.static.files = gruntConfig.copy.static.files.reduce((acc, {cwd, src}) => ([
    ...acc,
    ...src.map(path => cwd + path),
]), [])

module.exports = function(grunt) {
    grunt.initConfig(gruntConfig)

    grunt.loadNpmTasks('grunt-contrib-copy') // copy
    grunt.loadNpmTasks('grunt-exec') // exec
    grunt.loadNpmTasks('grunt-contrib-watch') // watch
    grunt.loadNpmTasks('grunt-newer') // newer

    grunt.registerTask('default', [
        'newer:copy:static',
        'exec:mustache',
        'exec:tailwindcss',
    ])
}