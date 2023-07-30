module.exports = {
  extends: ['@relaycorp/eslint-config'],
  root: true,

  settings: {
    node: {
      convertPath: {
        'src/**/*.ts': ['^src/(.+?)\\.ts$', 'build/$1.js'],
      },
    },
  },
};
