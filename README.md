# mongodb-realm-rollup
Avoid the Realm boilerplate, let Rollup take care of it.

This Rollup plugin generates the config files for MongoDB Realm automatically, as well as mangles Javascript into a form that it'll accept.

## Installation
```bash
yarn add 'ssh://git@github.com:jarjee/mongodb-realm-rollup#main'
npm install 'ssh://git@github.com:jarjee/mongodb-realm-rollup#main'
```

## Getting started

### Just this plugin

```js
import realm from 'mongodb-realm-rollup';

export default {
  plugins: [
    realm({
      rootPath: 'src',
      functions: 'functions/**/*.js',
      httpServices: 'http-services/**/*.js'
    })
  ],
  output: {
    format: 'es',
    dir: 'dist/ChartysList'
  },
};

```

### I prefer more types (Typescript)
```js
import realm from 'mongodb-realm-rollup';
import typescript from '@rollup/plugin-typescript';

import pkg from './package.json';

const plugins = [
  realm({ rootPath: 'src', functions: 'functions/**/*.ts', httpServices: 'http-services/**/*.ts' }),
  typescript({ tsconfig: './tsconfig.json', sourceMap: false }),
];

export default {
  plugins,
  external: pkg.dependencies,
  output: {
    format: 'es',
    dir: 'dist/ChartysList'
  },
};
```
### But my stuff is spread over more folders
Both the `functions` and `httpServices` attributes accept arrays of [picomatch globs](https://github.com/micromatch/picomatch)

```js
import realm from 'mongodb-realm-rollup';

export default {
  plugins: [
    realm({
      rootPath: 'src',
      functions: ['functions/**/*.js', 'otherFunctions/**/*.js'],
      httpServices: ['http-services/**/*.js', 'other-folder/**/*.js']
    })
  ],
  output: {
    format: 'es',
    dir: 'dist/ChartysList'
  },
};

```


## Your first function

The code that mangles the functions is pretty simple, we just expect the functions/webhooks to be the default export. The name of the file is the MongoDB Realm function.

`Salutations.js`
```js
export default function Greet(x) {
  return `Greetings, ${x}`;
}
```

will become a Realm function called `Salutations`,
```js
exports = function Greet(x) {
    return "Greetings, " + x;
};
```

### Annotations

You can add annotations to the main export to change what settings get stored in the config file. The number of settings is currently limited, and only applies to functions.

We currently support:
| Annotation | Arguments | Feature |
| --- | --- | --- |
| Public | N/A | Exposes the function as a public function |
| Private | N/A | Marks the function as a private function. Applied by default. |
| System  | N/A | Marks the function to run as the system user |
| User    | UserId | Marks the function to run under a userId |
| LogArguments | boolean | Marks the function to record arguments. False by default. |

An example of a function with all the values defined:
```js
/**
 * @Private
 * @Public
 * @User {1282b31823718237as}
 * @System
 * @LogArguments {false}
 */
export default function Autobots(name: string) {
  return `Lets roll out, ${name}`;
}
```

