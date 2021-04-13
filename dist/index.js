'use strict';

var fs = require('fs');
var path = require('path');
var walkdir = require('walkdir');
var picomatch = require('picomatch');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var walkdir__default = /*#__PURE__*/_interopDefaultLegacy(walkdir);
var picomatch__default = /*#__PURE__*/_interopDefaultLegacy(picomatch);

function isEmpty(x) {
    return x === undefined || x === '' || (Array.isArray(x) && x.length === 0);
}
function multiMap(v, fn) {
    if (Array.isArray(v)) {
        return v.map(fn);
    }
    return fn(v);
}
function realm(pluginOptions) {
    return {
        name: 'mongodb-realm',
        options: options => {
            const inputEntries = [];
            if (!isEmpty(options.input)) {
                console.warn('[mongodb-realm]: You cannot specify inputs since we mangle them for you.');
                return null;
            }
            const rootAbsolute = path__default['default'].resolve(pluginOptions.rootPath);
            const files = walkdir__default['default'].sync(pluginOptions.rootPath);
            if (pluginOptions.functions !== undefined) {
                const functionFilters = multiMap(pluginOptions.functions, f => path__default['default'].join(rootAbsolute, f));
                const functionFiles = files.filter(file => picomatch__default['default'].isMatch(file, functionFilters));
                inputEntries.push(...functionFiles.map(fnSource => [
                    `functions/${path__default['default']
                        .basename(fnSource)
                        .replace(/\.[^/.]+$/, '')}/source`,
                    fnSource,
                ]));
            }
            const input = inputEntries.reduce((acc, [k, v]) => {
                acc[k] = v;
                return acc;
            }, {});
            return Object.assign(Object.assign({}, options), { input });
        },
        // Going to apply a very simple transform.
        // Could this be better? Definitely.
        transform: code => {
            return code.replace('export default', 'exports =');
        },
        // MongoDB Realm has a seperate dynamic import system
        resolveDynamicImport: () => false,
        // Adding all the extra metadata (config.json) if required
        writeBundle: (options, bundle) => {
            for (const file of Object.values(bundle)) {
                if (file.type === 'chunk') {
                    const folder = path__default['default'].join(options.dir || 'dir', file.fileName.replace('/source.js', ''));
                    // Check if the config.json exists.
                    // If it does, leave it alone.
                    // If it doesn't, create the config file
                    const configFile = path__default['default'].join(folder, 'config.json');
                    if (!fs__default['default'].existsSync(configFile)) {
                        const config = { name: path__default['default'].basename(folder), private: true };
                        fs__default['default'].writeFileSync(configFile, JSON.stringify(config, null, 4));
                    }
                }
            }
        },
    };
}

module.exports = realm;
